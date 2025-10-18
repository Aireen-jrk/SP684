// services/ItemMovementService.js
import { getPool, sql } from "../db.js";

// ถ้าต้องการรวม BackOrder ในการคำนวณ Overstock ให้ปรับเป็น true
const USE_BACKORDER_IN_OVERSTOCK = false;

const ORDERABLE_COLS = {
  branchCode: "branchCode",
  skuNumber: "skuNumber",
  productName: "productName",
  averageDemand: "averageDemand",
  min: "minQty",            // map sort-key "min" -> column "minQty"
  minQty: "minQty",
  onHandQty: "onHandQty",
  backlog: "backlog",
  turnOver: "turnOver",
  status: "status"
  // หมายเหตุ: overStock ไม่ให้ server sort จะคุมจาก client
};

export class ItemMovementService {
  constructor() {}

  async getItemMovement(opts = {}) {
    const pool = await getPool();
    const request = pool.request();

    const months = Number(opts.months) || 6;
    const sortByKey = String(opts.sortBy || "").trim();
    const order = (String(opts.order || "asc").toLowerCase() === "desc") ? "DESC" : "ASC";

    const orderCol = ORDERABLE_COLS[sortByKey] || "branchCode"; // คอลัมน์ fallback

    // NOTE: ปรับชื่อ view/tables ให้ตรงกับฐานข้อมูลจริงของคุณ
    // v_ItemMovement ควรมีคอลัมน์: branchCode, skuNumber, productName,
    // averageDemand, onHandQty, backlog, safetyStock, reorderPoint, minQty, turnOver, status
    let sqlText = `
      SELECT
        branchCode,
        skuNumber,
        productName,
        averageDemand,
        onHandQty,
        backlog,
        safetyStock,
        reorderPoint,
        minQty,
        turnOver,
        status
      FROM v_ItemMovement
      WHERE 1=1
    `;

    // ตัวอย่าง: ถ้ามีการกรองเพิ่ม เช่น branch, q, date ฯลฯ สามารถเติมได้ที่นี่
    // if (opts.branch) { sqlText += ` AND branchCode = @branch`; request.input("branch", sql.VarChar, String(opts.branch)); }
    // if (opts.q)      { sqlText += ` AND (skuNumber LIKE @q OR productName LIKE @q)`; request.input("q", sql.VarChar, `%${String(opts.q)}%`); }
    // if (months)      { /* ถ้าจำเป็นต้องใช้กับ window ของ avg demand ให้ประกอบเงื่อนไขเพิ่ม */ }

    // หลีกเลี่ยงการ ORDER BY overStock ที่ server (ปล่อย client จัดการ)
    if (orderCol) {
      sqlText += ` ORDER BY ${orderCol} ${order}`;
    }

    const rs = await request.query(sqlText);

    const rows = (rs.recordset || []).map(r => {
      const minQty =
        Number.isFinite(+r.minQty)
          ? Number(r.minQty)
          : ((Number(r.safetyStock) || 0) + (Number(r.reorderPoint) || 0));

      const onHand = Number(r.onHandQty) || 0;
      const back   = Number(r.backlog)   || 0;

      const overStock = USE_BACKORDER_IN_OVERSTOCK
        ? (onHand + back) - minQty
        : onHand - minQty;

      return {
        branchCode: r.branchCode,
        skuNumber: r.skuNumber,
        productName: r.productName,
        averageDemand: Number(r.averageDemand) || 0,
        onHandQty: onHand,
        backlog: back,
        safetyStock: Number(r.safetyStock) || 0,
        reorderPoint: Number(r.reorderPoint) || 0,
        minQty,
        turnOver: Number(r.turnOver) || 0,
        status: r.status || "",
        overStock   // ส่งไปให้ client พร้อมใช้ (แต่ client ก็จะคำนวณได้เองถ้าขาด)
      };
    });

    // service คืน array; controller ค่อยห่อเป็น { rows }
    return rows;
  }
}
