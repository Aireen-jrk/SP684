import { determineStatus } from "./StatusService.js";
import jstatPkg from "jstat";
import { getPool } from "../db.js";
import { MonthWindow } from "../lib/MonthWindow.js";

export class StockStatusService {
    constructor() {
        // อัปเดตลิสต์นี้ตามจริงในฐานข้อมูลของคุณเสมอ (เติมเดือนใหม่ต่อท้าย)
        this.MONTH_COLS = [
            "Jan_67", "Feb_67", "Mar_67", "Apr_67", "May_67", "Jun_67",
            "Jul_67", "Aug_67", "Sep_67", "Oct_67", "Nov_67", "Dec_67",
            "Jan_68", "Feb_68", "Mar_68", "Apr_68", "May_68", "Jun_68", "Jul_68"
        ];
        this.window = new MonthWindow(this.MONTH_COLS);
    }

    /**
     * คำนวณตาราง Stock Status พร้อม averageDemand (ceil int)
     * @param {object} opts
     *  - months: 3|6|12 (default 6)
     *  - excludeCurrent: boolean (default true → ไม่นับเดือนปัจจุบัน)
     *  - countMode: 'all' | 'nonzero' (default 'nonzero')
     *  - branch: string (optional filter)
     */
    async getStockStatus(opts = {}) {
        // ===== พารามิเตอร์สำหรับ Average =====
        const months = [3, 6, 12].includes(Number(opts.months)) ? Number(opts.months) : 6;
        const excludeCurrent = (String(opts.excludeCurrent ?? "true").toLowerCase() !== "false");
        const branch = String(opts.branch || "").trim();

        // ===== คอลัมน์เดือน =====
        // ===== คอลัมน์เดือน =====
        const colsAvg = this.window.pick(months, excludeCurrent); // N เดือนล่าสุดสำหรับ "เฉลี่ย"
        const colsStdev6 = this.window.pick(6, true);                // 6 เดือนล่าสุด (ตัดเดือนปัจจุบัน) สำหรับ STDEV & Frequency

        if (!colsAvg.length || !colsStdev6.length) {
            return { monthsUsed: months, excludeCurrent, count: 0, rows: [] };
        }

        // เดือนปัจจุบัน = คอลัมน์สุดท้ายในตารางเดือน
        const currentMonthCol = this.MONTH_COLS[this.MONTH_COLS.length - 1];
        // ===== นิพจน์สำหรับ Average =====
        const sumExpr = this.window.buildSumExpr(colsAvg);
        const cntExpr = String(colsAvg.length); // เฉลี่ยด้วยจำนวนเดือนที่เลือกเสมอ

        // ===== STDEV (6 เดือน, Population) =====
        const valuesStdev6 = colsStdev6
            .map(c => `(CAST(ISNULL(t.[${c}],0) AS FLOAT))`)
            .join(",");
        const stdevExpr = `(SELECT STDEVP(x) FROM (VALUES ${valuesStdev6}) AS _m(x))`;

        // ===== Frequency (6 เดือน) =====
        const freqExpr = colsStdev6
            .map(c => `(CASE WHEN CAST(ISNULL(t.[${c}],0) AS INT) > 0 THEN 1 ELSE 0 END)`)
            .join(" + ");

        // ===== WHERE =====
        const whereParts = [`ISNULL(LTRIM(RTRIM(t.Item_Code)),'') <> ''`];
        // ถ้าต้องการโชว์เฉพาะที่ N เดือนรวม > 0
        // whereParts.push(`( (${sumExpr}) > 0 )`);
        if (branch) whereParts.push(`t.Branch_Code = @branch`);
        const where = `WHERE ${whereParts.join(" AND ")}`;

        const sqlText = `
    SELECT
      t.Branch_Code AS branchCode,
      t.Item_Code   AS skuNumber,
      t.Item_name   AS productName,

      ISNULL(t.LT_PO, 0) AS LT_PO,
      ISNULL(t.LT_Sup, 0) AS LT_SP,
      ISNULL(t.LT_DC, 0) AS LT_DC,

      ISNULL(t.[จำนวนคงเหลือ], 0) AS onHandQty,
      ISNULL(t.[PO_ค้าง], 0)       AS backlog,

      ISNULL(t.[${currentMonthCol}], 0) AS salesLast1,


      ISNULL (t.Item_Group, '')          AS Item_Group,  -- กลุ่มสินค้า
      ISNULL(t.New_Item, 0)          AS New_Item,    -- ธงสินค้าใหม่ (0/1 หรือ Y/N)

      (${sumExpr}) AS sumMonths,
      (${cntExpr}) AS cntMonths,
      CAST(ISNULL(CEILING(
        CAST((${sumExpr}) AS DECIMAL(18,4)) /
        NULLIF(CAST((${cntExpr}) AS DECIMAL(18,4)), 0)
      ), 0) AS INT) AS averageDemand,

      ${stdevExpr} AS stdev6,
      (${freqExpr}) AS frequency6
        FROM dbo.TestAll AS t
        ${where}
        ORDER BY t.Branch_Code, t.Item_Code;
    `;

        const pool = await getPool();
        const request = pool.request();
        if (branch && pool.sql?.VarChar) request.input("branch", pool.sql.VarChar(32), branch);

        const result = await request.query(sqlText);

        // ===== คำนวณ ServiceLevel จาก Frequency และ Safety Stock ต่อแถว =====
        const rows = result.recordset.map(r => {
            const f = Number(r.frequency6 ?? 0);
            // แบ่งชั้นตามไดอะแกรม:
            //  >4  => 0.95 ->5ขึ้น
            //  >2 && <4 => 0.93   ->3-4
            //  else => 0.50  ->0-2
            let serviceLevel;
            if (f > 4) serviceLevel = 0.95;
            else if (f > 2 && f <= 4) serviceLevel = 0.93;
            else serviceLevel = 0.50;

            // 1) Z ปัดทศนิยม 2 ตำแหน่ง
            const zRaw = jstatPkg.jStat.normal.inv(serviceLevel, 0, 1);
            const z = Math.round(zRaw * 100) / 100

            // 2) STDEV₆ ปัดเป็นจำนวนเต็ม
            const stdevRaw = Number(r.stdev6 ?? 0);
            const stdevInt = Math.round(stdevRaw);

            const ltDays = Math.max(0, Number(r.LT_PO ?? 0) + Number(r.LT_SP ?? 0) + Number(r.LT_DC ?? 0));
            const ltFactor = Math.sqrt(ltDays / 30);
            const sumLT = ltDays / 30;

            const safetyStock = Math.round(Math.max(0, z * stdevInt * ltFactor));
            const avg = Number(r.averageDemand ?? 0);
            const reorderPoint = Math.round(Math.max(0, avg * sumLT));
            const minQty = Math.max(0, safetyStock + reorderPoint);

            const onHandQty = Math.trunc(Number(r.onHandQty ?? 0)); // ตัดเป็น int
            const backlog = Math.trunc(Number(r.backlog ?? 0)); // ตัดเป็น int
            const turnOver = avg > 0 ? Number(((onHandQty + backlog) / avg).toFixed(2)) : 0;
            // แปลงค่าจากคอลัมน์จริง
            const isNewItem =
                Number(r.New_Item) === 1 ||
                String(r.New_Item ?? "").trim().toUpperCase() === "Y";
            const inItemGroup = String(r.Item_Group ?? "").trim() !== "";

            const status = determineStatus({
                isNewItem,
                inItemGroup,
                frequency6: Number(r.frequency6 ?? 0),
                salesLast1: Number(r.salesLast1 ?? 0), // เดือนปัจจุบันจาก SELECT
                avg: Number(r.averageDemand ?? 0),
                onHandQty: onHandQty,
                outstandingPo: backlog,
                minQty: minQty,
            });;
            return {
                branchCode: r.branchCode,
                skuNumber: r.skuNumber,
                productName: r.productName,

                averageDemand: r.averageDemand ?? 0,
                stdev6: stdevInt,     // ใช้ค่าที่ปัดเป็น int แล้ว
                zScore: z,            // Z ที่ปัด 2 ตำแหน่ง
                frequency6: f,
                serviceLevel,

                LT_PO: Number(r.LT_PO ?? 0),
                LT_SP: Number(r.LT_SP ?? 0),
                LT_DC: Number(r.LT_DC ?? 0),
                safetyStock,
                reorderPoint,
                minQty,
                onHandQty,
                backlog,
                turnOver,
                Item_Group: r.Item_Group,
                New_Item: r.New_Item,
                status
            };
        });

        return {
            monthsUsed: months,
            excludeCurrent,
            stdevMonths: 6,
            frequencyMonths: 6,
            count: rows.length,
            rows
        };
    }
}
