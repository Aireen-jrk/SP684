import { getPool, sql as mssql } from "../../db.js";
import { computeStockStatusRow } from "./computeStockStatusRow.js";


export class StockStatusService {
    async getStockStatus(opts = {}) {       
        const sqlText = `
;WITH
/* =============================================================
   1) NetSales รายเดือน
============================================================= */
sales_m AS (
  SELECT
    nsl.Location_Code AS branchCode,
    nsl.No AS skuNumber,
    nsl.Year AS yyyy,
    nsl.Month AS mm,
    SUM(TRY_CONVERT(float, nsl.Total_Quantity)) AS salesQty
  FROM dbo.NetSales nsl
  WHERE nsl.Location_Code = @branch
  GROUP BY nsl.Location_Code, nsl.No, nsl.Year, nsl.Month
),

/* =============================================================
   2) OB รายเดือน
============================================================= */
ob_m AS (
  SELECT
    ob.Branch AS branchCode,
    ob.Item_No AS skuNumber,
    ob.Year AS yyyy,
    ob.Month AS mm,
    SUM(TRY_CONVERT(float, ob.Quantity)) AS obQty
  FROM dbo.OB ob
  WHERE ob.Branch = @branch
  GROUP BY ob.Branch, ob.Item_No, ob.Year, ob.Month
),

/* =============================================================
   3) OC รายเดือน
============================================================= */
oc_m AS (
  SELECT
    oc.Branch AS branchCode,
    oc.Item_No AS skuNumber,
    oc.Year AS yyyy,
    oc.Month AS mm,
    SUM(TRY_CONVERT(float, oc.Quantity)) AS ocQty
  FROM dbo.OC oc
  WHERE oc.Branch = @branch
  GROUP BY oc.Branch, oc.Item_No, oc.Year, oc.Month
),

/* =============================================================
   4) OW รายเดือน
============================================================= */
ow_m AS (
  SELECT
    ow.Branch AS branchCode,
    ow.Item_No AS skuNumber,
    ow.Year AS yyyy,
    ow.Month AS mm,
    SUM(TRY_CONVERT(float, ow.Quantity)) AS owQty
  FROM dbo.OW ow
  WHERE ow.Branch = @branch
  GROUP BY ow.Branch, ow.Item_No, ow.Year, ow.Month
),

/* =============================================================
   4.5) OU รายเดือน
============================================================= */
ou_m AS (
  SELECT
    ou.Branch AS branchCode,
    ou.Item_No AS skuNumber,
    ou.Year AS yyyy,
    ou.Month AS mm,
    SUM(TRY_CONVERT(float, ou.Quantity)) AS ouQty
  FROM dbo.OU ou
  WHERE ou.Branch = @branch
    AND LEFT(ou.Item_No, 1) IN ('A','G','S','C','Y','E')
  GROUP BY ou.Branch, ou.Item_No, ou.Year, ou.Month
),

/* =============================================================
   5) รวม Monthly Demand (สูตรใหม่)
============================================================= */
monthly_demand AS (
  SELECT
    COALESCE(s.branchCode, ob.branchCode, oc.branchCode, ow.branchCode, ou.branchCode) AS branchCode,
    COALESCE(s.skuNumber, ob.skuNumber, oc.skuNumber, ow.skuNumber, ou.skuNumber) AS skuNumber,
    COALESCE(s.yyyy, ob.yyyy, oc.yyyy, ow.yyyy, ou.yyyy) AS yyyy,
    COALESCE(s.mm,   ob.mm,   oc.mm,   ow.mm,   ou.mm)   AS mm,

    ISNULL(s.salesQty,0) AS salesQty,
    ISNULL(ob.obQty,0)   AS obQty,
    ISNULL(oc.ocQty,0)   AS ocQty,
    ISNULL(ow.owQty,0)   AS owQty,
    ISNULL(ou.ouQty,0)   AS ouQty,

    ( ISNULL(s.salesQty,0)
    + ISNULL(oc.ocQty,0)
    - ISNULL(ow.owQty,0)
    - ISNULL(ou.ouQty,0)
    - ISNULL(ob.obQty,0) ) AS demandQty

  FROM sales_m s
  FULL OUTER JOIN ob_m ob
      ON ob.branchCode = s.branchCode AND ob.skuNumber = s.skuNumber
     AND ob.yyyy = s.yyyy AND ob.mm = s.mm
  FULL OUTER JOIN oc_m oc
      ON oc.branchCode = COALESCE(s.branchCode, ob.branchCode)
     AND oc.skuNumber  = COALESCE(s.skuNumber , ob.skuNumber)
     AND oc.yyyy = COALESCE(s.yyyy, ob.yyyy)
     AND oc.mm   = COALESCE(s.mm,   ob.mm)
  FULL OUTER JOIN ow_m ow
      ON ow.branchCode = COALESCE(s.branchCode, ob.branchCode, oc.branchCode)
     AND ow.skuNumber  = COALESCE(s.skuNumber , ob.skuNumber , oc.skuNumber)
     AND ow.yyyy = COALESCE(s.yyyy, ob.yyyy, oc.yyyy)
     AND ow.mm   = COALESCE(s.mm,   ob.mm,   oc.mm)
  FULL OUTER JOIN ou_m ou
      ON ou.branchCode = COALESCE(s.branchCode, ob.branchCode, oc.branchCode, ow.branchCode)
     AND ou.skuNumber  = COALESCE(s.skuNumber , ob.skuNumber , oc.skuNumber , ow.skuNumber)
     AND ou.yyyy = COALESCE(s.yyyy, ob.yyyy, oc.yyyy, ow.yyyy)
     AND ou.mm   = COALESCE(s.mm,   ob.mm,   oc.mm,   ow.mm)
),

/* =============================================================
   6) หาเดือนล่าสุด
============================================================= */
latest_month AS (
  SELECT MAX(DATEFROMPARTS(yyyy, mm, 1)) AS currentMonth
  FROM monthly_demand
),

/* =============================================================
   7) Demand JSON 9 เดือนย้อนหลัง
============================================================= */
demand_json AS (
  SELECT
    md.branchCode,
    md.skuNumber,
    (
      SELECT
        FORMAT(DATEFROMPARTS(m2.yyyy, m2.mm, 1), 'yyyy-MM') AS monthEnd,
        CAST(m2.demandQty AS DECIMAL(18,2)) AS demandQty
      FROM monthly_demand m2
      CROSS JOIN latest_month lm
      WHERE m2.branchCode = md.branchCode
        AND m2.skuNumber  = md.skuNumber
        AND DATEFROMPARTS(m2.yyyy, m2.mm, 1) 
             BETWEEN DATEADD(MONTH, -9, lm.currentMonth)
                 AND lm.currentMonth
      ORDER BY m2.yyyy, m2.mm
      FOR JSON PATH
    ) AS demandJson
  FROM monthly_demand md
  GROUP BY md.branchCode, md.skuNumber
),

/* =============================================================
   8) เลือก 6 เดือนย้อนหลัง ไม่รวมเดือนปัจจุบัน
============================================================= */
sales6_m AS (
    SELECT 
        md.branchCode,
        md.skuNumber,
        md.demandQty,
        DATEFROMPARTS(md.yyyy, md.mm, 1) AS monthDate
    FROM monthly_demand md
    CROSS JOIN latest_month lm
WHERE DATEFROMPARTS(md.yyyy, md.mm, 1)
      BETWEEN DATEADD(MONTH, -5, lm.currentMonth)
          AND lm.currentMonth
),

/* =============================================================
   9) sales6_json (ให้มีครอบทุก SKU)
============================================================= */
sales6_json AS (
  SELECT
    md.branchCode,
    md.skuNumber,
    (
      SELECT 
        FORMAT(s2.monthDate, 'yyyy-MM') AS [month],
        CAST(s2.demandQty AS DECIMAL(18,2)) AS [qty]
      FROM sales6_m s2
      WHERE s2.branchCode = md.branchCode
        AND s2.skuNumber = md.skuNumber
      ORDER BY s2.monthDate
      FOR JSON PATH
    ) AS sales6
  FROM monthly_demand md
  GROUP BY md.branchCode, md.skuNumber
),

/* =============================================================
   10) STDEV 6 เดือนย้อนหลัง
============================================================= */
stdev6_m AS (
    SELECT
        branchCode,
        skuNumber,
        STDEVP(CAST(demandQty AS float)) AS stdev6
    FROM sales6_m
    GROUP BY branchCode, skuNumber
),

/* =============================================================
   11) FREQ 6 เดือนย้อนหลัง (count qty>0)
============================================================= */
freq6_m AS (
    SELECT
        branchCode,
        skuNumber,
        SUM(CASE WHEN demandQty > 0 THEN 1 ELSE 0 END) AS freq6
    FROM sales6_m
    GROUP BY branchCode, skuNumber
),

/* =============================================================
   12) OnHand
============================================================= */
onhand_m AS (
  SELECT
    oh.Branch AS branchCode,
    oh.Item_No AS skuNumber,
    SUM(TRY_CONVERT(float, oh.OnHandQty)) AS onHandQty
  FROM dbo.OH_BIN oh
  WHERE oh.Branch = @branch
  GROUP BY oh.Branch, oh.Item_No
),

/* =============================================================
   13) PO Outstanding
============================================================= */
poout_m AS (
  SELECT
    po.Location_Code AS branchCode,
    po.No AS skuNumber,
    SUM(TRY_CONVERT(float, po.Outstanding_Quantity)) AS backlog
  FROM dbo.POOutstand po
  WHERE po.Location_Code = @branch
  GROUP BY po.Location_Code, po.No
),

/* =============================================================
   14) LT + ItemName (TestALL A,C,E,G,S,Y)
============================================================= */
info AS (
  SELECT
    LTRIM(RTRIM(t.Branch_Code)) AS branchCode,
    LTRIM(RTRIM(t.Item_Code))   AS skuNumber,
    MAX(LTRIM(RTRIM(t.Item_name))) AS productName,
    MAX(ISNULL(t.LT_PO,0)) AS LT_PO,
    MAX(ISNULL(t.LT_Sup,0)) AS LT_SP,
    MAX(ISNULL(t.LT_DC,0)) AS LT_DC
  FROM (
    SELECT Branch_Code, Item_Code, Item_name, LT_PO, LT_Sup, LT_DC FROM TestALLA
    UNION ALL SELECT Branch_Code, Item_Code, Item_name, LT_PO, LT_Sup, LT_DC FROM TestALLC
    UNION ALL SELECT Branch_Code, Item_Code, Item_name, LT_PO, LT_Sup, LT_DC FROM TestALLE
    UNION ALL SELECT Branch_Code, Item_Code, Item_name, LT_PO, LT_Sup, LT_DC FROM TestALLG
    UNION ALL SELECT Branch_Code, Item_Code, Item_name, LT_PO, LT_Sup, LT_DC FROM TestALLS
    UNION ALL SELECT Branch_Code, Item_Code, Item_name, LT_PO, LT_Sup, LT_DC FROM TestALLY
  ) t
  GROUP BY LTRIM(RTRIM(t.Branch_Code)), LTRIM(RTRIM(t.Item_Code))
),

/* =============================================================
   15) itemName fallback
============================================================= */
itemname_m AS (
  SELECT
    LTRIM(RTRIM(x.Branch_Code)) AS branchCode,
    LTRIM(RTRIM(x.Item_Code))   AS skuNumber,
    MAX(LTRIM(RTRIM(x.Item_name))) AS productName
  FROM (
    SELECT Branch_Code, Item_Code, Item_name FROM TestALLA
    UNION ALL SELECT Branch_Code, Item_Code, Item_name FROM TestALLC
    UNION ALL SELECT Branch_Code, Item_Code, Item_name FROM TestALLE
    UNION ALL SELECT Branch_Code, Item_Code, Item_name FROM TestALLG
    UNION ALL SELECT Branch_Code, Item_Code, Item_name FROM TestALLS
    UNION ALL SELECT Branch_Code, Item_Code, Item_name FROM TestALLY
  ) x
  GROUP BY LTRIM(RTRIM(x.Branch_Code)), LTRIM(RTRIM(x.Item_Code))
),

/* =============================================================
   16) Base Keys (ตัด sku ว่าง)
============================================================= */
base_keys AS (
  SELECT branchCode, skuNumber FROM monthly_demand WHERE skuNumber <> ''
)

SELECT
  bk.branchCode,
  bk.skuNumber,

  COALESCE(info.productName, itemname_m.productName, '') AS productName,
  NULL AS Item_Group,
  info.LT_PO,
  info.LT_SP,
  info.LT_DC,
  ISNULL(fq.freq6, 0) AS cntNonZero,
  ISNULL(dj.demandJson, '[]') AS demandJson,
  ISNULL(s6.sales6, '[]') AS sales6,
  ISNULL(st.stdev6,0) AS stdev6,
  ISNULL(fq.freq6,0) AS freq6,

  ISNULL(oh.onHandQty,0) AS onHandQty,
  ISNULL(po.backlog,0) AS backlog,

  /* =============================================================
     BRAND NAME
  ============================================================= */
  CASE
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'E' THEN ab.BRAND_NAME
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'S' THEN bs.Brand_Name
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'A' THEN ba.Brand_Name
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'C' THEN bc.Brand_Name
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'Y' THEN bp.Brand_Name
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'G' THEN bg.Brand_Name
    ELSE NULL
  END AS brandName,

  /* =============================================================
     GROUP ID
  ============================================================= */
  CASE
    WHEN LEN(LTRIM(RTRIM(bk.skuNumber))) >= 6
      THEN SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 5, 2)
    ELSE NULL
  END AS accGroupId,

  /* =============================================================
     GROUP NAME
  ============================================================= */
  CASE
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'E' THEN ag.GroupName
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'G' THEN gg.GroupName
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'A' THEN ga.GroupName
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'C' THEN gc.GroupName
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'Y' THEN gy.GroupName
    WHEN LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'S' THEN gs.GroupName
    ELSE NULL
  END AS accGroupName

FROM base_keys bk
LEFT JOIN info        ON info.branchCode = bk.branchCode AND info.skuNumber = bk.skuNumber
LEFT JOIN itemname_m  ON itemname_m.branchCode = bk.branchCode AND itemname_m.skuNumber = bk.skuNumber
LEFT JOIN demand_json dj   ON dj.branchCode = bk.branchCode AND dj.skuNumber = bk.skuNumber
LEFT JOIN stdev6_m st      ON st.branchCode = bk.branchCode AND st.skuNumber = bk.skuNumber
LEFT JOIN freq6_m fq       ON fq.branchCode = bk.branchCode AND fq.skuNumber = bk.skuNumber
LEFT JOIN onhand_m oh      ON oh.branchCode = bk.branchCode AND oh.skuNumber = bk.skuNumber
LEFT JOIN poout_m  po      ON po.branchCode = bk.branchCode AND po.skuNumber = bk.skuNumber
LEFT JOIN sales6_json s6   ON s6.branchCode = bk.branchCode AND s6.skuNumber = bk.skuNumber

-- BRAND joins
LEFT JOIN dbo.Accessory_BRAND AS ab
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'E'
 AND ab.BRAND_NO = TRY_CONVERT(int,
       SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 2, 3))

LEFT JOIN dbo.BRAND_Sealant AS bs
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'S'
 AND bs.Brand_No = TRY_CONVERT(int,
       SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 2, 2))

LEFT JOIN dbo.BRAND_Aluminium AS ba
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'A'
 AND ba.Brand_No = TRY_CONVERT(int,
       SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 2, 2))

LEFT JOIN dbo.BRAND_CLine AS bc
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'C'
 AND bc.Brand_No = TRY_CONVERT(int,
       SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 2, 2))

LEFT JOIN dbo.BRAND_Gypsum AS bp
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'Y'
 AND bp.Brand_No = TRY_CONVERT(int,
       SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 2, 2))

LEFT JOIN dbo.BRAND_Glass AS bg
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'G'
 AND bg.Brand_No = TRY_CONVERT(int,
       SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 2, 2))

-- GROUP joins
LEFT JOIN dbo.Accessory_GROUP AS ag
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'E'
 AND ag.Group_ID =
      RIGHT('0' + LTRIM(RTRIM(
        SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 5, 2)
      )), 2)

LEFT JOIN dbo.GROUP_Glass AS gg
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'G'
 AND gg.Group_ID =
      RIGHT('0' + LTRIM(RTRIM(
        SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 4, 2)
      )), 2)

LEFT JOIN dbo.GROUP_Aluminium AS ga
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'A'
 AND ga.Group_ID =
      RIGHT('0' + LTRIM(RTRIM(
        SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 4, 2)
      )), 2)

LEFT JOIN dbo.GROUP_CLine AS gc
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'C'
 AND gc.Group_ID =
      RIGHT('0' + LTRIM(RTRIM(
        SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 4, 2)
      )), 2)

LEFT JOIN dbo.GROUP_Gypsum AS gy
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'Y'
 AND gy.Group_ID =
      RIGHT('0' + LTRIM(RTRIM(
        SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 4, 2)
      )), 2)

LEFT JOIN dbo.GROUP_Sealant AS gs
  ON LEFT(LTRIM(RTRIM(bk.skuNumber)), 1) = 'S'
 AND gs.Group_ID =
      RIGHT('0' + LTRIM(RTRIM(
        SUBSTRING(LTRIM(RTRIM(bk.skuNumber)), 4, 2)
      )), 2)

WHERE (@branch IS NULL OR bk.branchCode = @branch);
        `;

        const pool = await getPool();
        const request = pool.request();

        const months = Number(opts.months || 6);        // เผื่อคืนค่าใน response ด้านล่าง
        const excludeCurrent = true;                    // ตอนนี้ SQL ไม่ได้ใช้ แต่ใส่คืนค่าให้ frontend
        const branch = String(opts.branch || "").trim();

        request.input('months', mssql.Int, months);
        request.input('branch', mssql.VarChar(32), branch || null);

        const result = await request.query(sqlText);
        const N = Number(opts.months || 6);

        
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
