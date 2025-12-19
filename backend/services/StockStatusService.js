import { getPool, sql as mssql } from "../../db.js";
import { computeStockStatusRow } from "./computeStockStatusRow.js";


export class StockStatusService {
    async getStockStatus(opts = {}) {       
        const sqlText = `

;WITH
/* ============================================================
   1) ITEM MASTER
============================================================ */
item_master AS (
    SELECT
        LTRIM(RTRIM(Item_No))       AS skuNumber,
        LTRIM(RTRIM([Description])) AS productName,
        LTRIM(RTRIM(Base_Unit))     AS baseUnit
    FROM SupplySenseProject.dbo.ItemMaster
    WHERE Item_No IS NOT NULL
      AND LTRIM(RTRIM(Item_No)) <> ''
      AND RIGHT(Item_No,6) <> '000000'
      AND LEFT(LTRIM(RTRIM(Item_No)),1) NOT IN ('Z','P','R')  
),

/* ============================================================
   2) BASE KEYS (ทุก SKU × 1 สาขา)
============================================================ */
base_keys AS (
    SELECT
        @branch AS branchCode,
        im.skuNumber,
        im.productName,
        im.baseUnit
    FROM item_master im
),

/* ============================================================
   3) ALL SOURCES (movement – เฉพาะสาขานี้)
============================================================ */
all_sources AS (
    SELECT Location_Code AS branchCode, No AS skuNumber,
           Year AS yyyy, Month AS mm,
           TRY_CONVERT(float, Total_Quantity) AS salesQty,
           0 AS ocQty, 0 AS owQty, 0 AS ouQty, 0 AS obQty
    FROM NetSales
    WHERE Location_Code = @branch

    UNION ALL
    SELECT Branch, Item_No, Year, Month,
           0, TRY_CONVERT(float, Quantity), 0, 0, 0
    FROM OC
    WHERE Branch = @branch

    UNION ALL
    SELECT Branch, Item_No, Year, Month,
           0, 0, TRY_CONVERT(float, Quantity), 0, 0
    FROM OW
    WHERE Branch = @branch

    UNION ALL
    SELECT Branch, Item_No, Year, Month,
           0, 0, 0, TRY_CONVERT(float, Quantity), 0
    FROM OU
    WHERE Branch = @branch

    UNION ALL
    SELECT Branch, Item_No, Year, Month,
           0, 0, 0, 0, TRY_CONVERT(float, Quantity)
    FROM OB
    WHERE Branch = @branch
),

/* ============================================================
   4) MONTHLY DEMAND
============================================================ */
monthly_demand AS (
    SELECT
        branchCode,
        skuNumber,
        yyyy,
        mm,
        SUM(salesQty + ocQty - owQty - ouQty - obQty) AS demandQty
    FROM all_sources
    GROUP BY branchCode, skuNumber, yyyy, mm
),

/* ============================================================
   5) CURRENT MONTH
============================================================ */
latest_month AS (
    SELECT MAX(DATEFROMPARTS(yyyy, mm, 1)) AS currentMonth
    FROM monthly_demand
),

/* ============================================================
   6) DEMAND 6 MONTHS (BASE DATA)
============================================================ */
demand_9m AS (
    SELECT
        md.branchCode,
        md.skuNumber,
        DATEFROMPARTS(md.yyyy, md.mm, 1) AS monthDate,
        md.demandQty
    FROM monthly_demand md
    CROSS JOIN latest_month lm
    WHERE DATEFROMPARTS(md.yyyy, md.mm, 1)
          BETWEEN DATEADD(MONTH, -8, lm.currentMonth)
              AND lm.currentMonth
),

/* ============================================================
   7) DEMAND JSON
============================================================ */
demand_json AS (
    SELECT
        branchCode,
        skuNumber,
        CONCAT(
          '[',
          STRING_AGG(
            CONCAT(
              '{"month":"', FORMAT(monthDate,'yyyy-MM'),
              '","qty":', CAST(CAST(demandQty AS DECIMAL(18,2)) AS VARCHAR(40)),
              '}'
            ),
            ','
          ) WITHIN GROUP (ORDER BY monthDate),
          ']'
        ) AS demandJson
    FROM demand_9m
    GROUP BY branchCode, skuNumber
),


demand_6m AS (
    SELECT
        md.branchCode,
        md.skuNumber,
        DATEFROMPARTS(md.yyyy, md.mm, 1) AS monthDate,
        md.demandQty
    FROM monthly_demand md
    CROSS JOIN latest_month lm
    WHERE DATEFROMPARTS(md.yyyy, md.mm, 1)
          BETWEEN DATEADD(MONTH, -5, lm.currentMonth)
              AND lm.currentMonth
),

   sales6_json AS (
    SELECT
        branchCode,
        skuNumber,
        CONCAT(
          '[',
          STRING_AGG(
            CONCAT(
              '{"month":"', FORMAT(monthDate,'yyyy-MM'),
              '","qty":', CAST(CAST(demandQty AS DECIMAL(18,2)) AS VARCHAR(40)),
              '}'
            ),
            ','
          ) WITHIN GROUP (ORDER BY monthDate),
          ']'
        ) AS sales6
    FROM demand_6m
    GROUP BY branchCode, skuNumber
),



/* ============================================================

============================================================ */


freq9_m AS (
    SELECT
        branchCode,
        skuNumber,
        SUM(CASE WHEN demandQty > 0 THEN 1 ELSE 0 END) AS freq9
    FROM demand_9m
    GROUP BY branchCode, skuNumber
),

/* ============================================================
   10) ONHAND / PO
============================================================ */
onhand_m AS (
    SELECT Branch AS branchCode, Item_No AS skuNumber,
           SUM(TRY_CONVERT(float, OnHandQty)) AS onHandQty
    FROM OH_BIN
    WHERE Branch = @branch
    GROUP BY Branch, Item_No
),

poout_m AS (
    SELECT Location_Code AS branchCode, No AS skuNumber,
           SUM(TRY_CONVERT(float, Outstanding_Quantity)) AS backlog
    FROM POOutstand
    WHERE Location_Code = @branch
    GROUP BY Location_Code, No
),

/* ============================================================
   11) LEAD TIME
============================================================ */
lt_raw AS (
    SELECT Branch_Code, Item_Code, LT_PO, LT_Sup, LT_DC FROM TestALLA
    UNION ALL SELECT Branch_Code, Item_Code, LT_PO, LT_Sup, LT_DC FROM TestALLC
    UNION ALL SELECT Branch_Code, Item_Code, LT_PO, LT_Sup, LT_DC FROM TestALLE
    UNION ALL SELECT Branch_Code, Item_Code, LT_PO, LT_Sup, LT_DC FROM TestALLG
    UNION ALL SELECT Branch_Code, Item_Code, LT_PO, LT_Sup, LT_DC FROM TestALLS
    UNION ALL SELECT Branch_Code, Item_Code, LT_PO, LT_Sup, LT_DC FROM TestALLY
),

lt_m AS (
    SELECT
        LTRIM(RTRIM(Branch_Code)) AS branchCode,
        LTRIM(RTRIM(Item_Code))   AS skuNumber,
        MAX(ISNULL(LT_PO,0))  AS LT_PO,
        MAX(ISNULL(LT_Sup,0)) AS LT_SP,
        MAX(ISNULL(LT_DC,0))  AS LT_DC
    FROM lt_raw
    WHERE LTRIM(RTRIM(Branch_Code)) = @branch
    GROUP BY LTRIM(RTRIM(Branch_Code)), LTRIM(RTRIM(Item_Code))
)

/* ============================================================
   FINAL RESULT
============================================================ */
SELECT
    bk.branchCode,
    bk.skuNumber,
    bk.productName,
    bk.baseUnit,

    ISNULL(lt.LT_PO,0) AS LT_PO,
    ISNULL(lt.LT_SP,0) AS LT_SP,
    ISNULL(lt.LT_DC,0) AS LT_DC,

    ISNULL(fq.freq9,0)       AS cntNonZero,
    ISNULL(dj.demandJson,'[]') AS demandJson,
   ISNULL(s6.sales6,'[]')     AS sales6,
    -- ISNULL(st.stdev6,0)        AS stdev6,

    ISNULL(oh.onHandQty,0) AS onHandQty,
    ISNULL(po.backlog,0)   AS backlog,

        -- BRAND NAME
        CASE
            WHEN LEFT(bk.skuNumber,1) = 'E' THEN ab.BRAND_NAME
            WHEN LEFT(bk.skuNumber,1) = 'S' THEN bs.Brand_Name
            WHEN LEFT(bk.skuNumber,1) = 'A' THEN ba.Brand_Name
            WHEN LEFT(bk.skuNumber,1) = 'C' THEN bc.Brand_Name
            WHEN LEFT(bk.skuNumber,1) = 'Y' THEN bp.Brand_Name
            WHEN LEFT(bk.skuNumber,1) = 'G' THEN bg.Brand_Name
            ELSE NULL
        END AS brandName,

        -- GROUP NAME
        CASE
            WHEN LEFT(bk.skuNumber,1) = 'E' THEN ag.GroupName
            WHEN LEFT(bk.skuNumber,1) = 'G' THEN gg.GroupName
            WHEN LEFT(bk.skuNumber,1) = 'A' THEN ga.GroupName
            WHEN LEFT(bk.skuNumber,1) = 'C' THEN gc.GroupName
            WHEN LEFT(bk.skuNumber,1) = 'Y' THEN gy.GroupName
            WHEN LEFT(bk.skuNumber,1) = 'S' THEN gs.GroupName
            ELSE NULL
        END AS accGroupName

    FROM base_keys bk
LEFT JOIN demand_json dj
  ON dj.branchCode = bk.branchCode
 AND dj.skuNumber  = bk.skuNumber

 LEFT JOIN sales6_json s6
  ON s6.branchCode = bk.branchCode
 AND s6.skuNumber  = bk.skuNumber

 /* ============================================================

LEFT JOIN stdev6_m st
  ON st.branchCode = bk.branchCode
 AND st.skuNumber  = bk.skuNumber
 ============================================================ */
LEFT JOIN freq9_m fq
  ON fq.branchCode = bk.branchCode
 AND fq.skuNumber  = bk.skuNumber

LEFT JOIN onhand_m oh
  ON oh.branchCode = bk.branchCode
 AND oh.skuNumber  = bk.skuNumber

LEFT JOIN poout_m po
  ON po.branchCode = bk.branchCode
 AND po.skuNumber  = bk.skuNumber

LEFT JOIN lt_m lt
  ON lt.branchCode = bk.branchCode
 AND lt.skuNumber  = bk.skuNumber

    -- BRAND joins
    LEFT JOIN dbo.Accessory_BRAND ab
      ON LEFT(bk.skuNumber,1)='E'
     AND ab.BRAND_NO = TRY_CONVERT(int, SUBSTRING(bk.skuNumber,2,3))

    LEFT JOIN dbo.BRAND_Sealant bs
      ON LEFT(bk.skuNumber,1)='S'
     AND bs.Brand_No = TRY_CONVERT(int, SUBSTRING(bk.skuNumber,2,2))

    LEFT JOIN dbo.BRAND_Aluminium ba
      ON LEFT(bk.skuNumber,1)='A'
     AND ba.Brand_No = TRY_CONVERT(int, SUBSTRING(bk.skuNumber,2,2))

    LEFT JOIN dbo.BRAND_CLine bc
      ON LEFT(bk.skuNumber,1)='C'
     AND bc.Brand_No = TRY_CONVERT(int, SUBSTRING(bk.skuNumber,2,2))

    LEFT JOIN dbo.BRAND_Gypsum bp
      ON LEFT(bk.skuNumber,1)='Y'
     AND bp.Brand_No = TRY_CONVERT(int, SUBSTRING(bk.skuNumber,2,2))

    LEFT JOIN dbo.BRAND_Glass bg
      ON LEFT(bk.skuNumber,1)='G'
     AND bg.Brand_No = TRY_CONVERT(int, SUBSTRING(bk.skuNumber,2,2))

    -- GROUP joins
    LEFT JOIN dbo.GROUP_Aluminium ga
      ON LEFT(bk.skuNumber,1)='A'
     AND ga.Group_ID = RIGHT('0'+SUBSTRING(bk.skuNumber,4,2),2)

    LEFT JOIN dbo.GROUP_Glass gg
      ON LEFT(bk.skuNumber,1)='G'
     AND gg.Group_ID = RIGHT('0'+SUBSTRING(bk.skuNumber,4,2),2)

    LEFT JOIN dbo.GROUP_CLine gc
      ON LEFT(bk.skuNumber,1)='C'
     AND gc.Group_ID = RIGHT('0'+SUBSTRING(bk.skuNumber,4,2),2)

    LEFT JOIN dbo.GROUP_Gypsum gy
      ON LEFT(bk.skuNumber,1)='Y'
     AND gy.Group_ID = RIGHT('0'+SUBSTRING(bk.skuNumber,4,2),2)

    LEFT JOIN dbo.GROUP_Sealant gs
      ON LEFT(bk.skuNumber,1)='S'
     AND gs.Group_ID = RIGHT('0'+SUBSTRING(bk.skuNumber,4,2),2)

    LEFT JOIN dbo.Accessory_GROUP ag
      ON LEFT(bk.skuNumber,1)='E'
     AND ag.Group_ID = RIGHT('0'+SUBSTRING(bk.skuNumber,5,2),2)

ORDER BY bk.skuNumber;
        `;

 const pool = await getPool();
        const request = pool.request();

        const months = Number(opts.months || 6);        // เผื่อคืนค่าใน response ด้านล่าง
        const excludeCurrent = true;                    // ตอนนี้ SQL ไม่ได้ใช้ แต่ใส่คืนค่าให้ frontend
        const branch = String(opts.branch || "").trim();
        const monthsBack = Number(opts.monthsBack || 9);

        request.input('monthsBack', mssql.Int, monthsBack);
        request.input('branch', mssql.VarChar(32), branch || null);

        const result = await request.query(sqlText);
        const N = Number(opts.months || 6);

        // group demand by branch+sku
        const map = new Map();
// หลัง query
        if (opts.rawOnly) {
          return {
            rows: result.recordset,
            count: result.recordset.length
          };
        }

        
const rows = result.recordset.map(r => computeStockStatusRow(r));

        // sorting
        const sortKeyMap = {
            branchCode: 'branchCode',
            skuNumber: 'skuNumber',
            productName: 'productName',
            averageDemand: 'averageDemand',
            safetyStock: 'safetyStock',
            trend: 'trend',
            min: 'minQty',
            minQty: 'minQty',
            onhand: 'onHandQty',
            onHandQty: 'onHandQty',
            backorder: 'backlog',
            backlog: 'backlog',
            turnover: 'turnOver',
            turnOver: 'turnOver',
            brand: 'brandName',
            brandName: 'brandName',
            accGroupId: 'accGroupId',
            accGroupName: 'accGroupName',
        };

        const sortByParam = String(opts.sortBy || '').trim();
        const orderParam = String(opts.order || 'asc').toLowerCase();

        const sortKey = sortKeyMap[sortByParam] || null;
        const sortDir = (orderParam === 'desc') ? -1 : 1;

        function cmp(a, b) {
            const ax = a ?? null;
            const bx = b ?? null;
            if (ax === null && bx === null) return 0;
            if (ax === null) return 1;
            if (bx === null) return -1;
            if (typeof ax === 'number' && typeof bx === 'number') {
                if (Number.isNaN(ax) && Number.isNaN(bx)) return 0;
                if (Number.isNaN(ax)) return 1;
                if (Number.isNaN(bx)) return -1;
                return ax < bx ? -1 : (ax > bx ? 1 : 0);
            }
            return String(ax).localeCompare(String(bx), undefined, { sensitivity: 'accent', numeric: true });
        }

        if (sortKey) rows.sort((r1, r2) => sortDir * cmp(r1[sortKey], r2[sortKey]));

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
