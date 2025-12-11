import express from "express";
import { getPool } from "../../db.js";

const router = express.Router();

router.get("/test-stock-route", (req, res) => {
  res.send("StockStatusRoute WORKING");
});

/* ============================================================
   GET /api/stock-status?date=YYYY-MM-DD
============================================================ */
router.get("/stock-status", async (req, res) => {
  try {
    const pool = await getPool();
    const date = req.query.date;

    // --- A) ดึง snapshot ตามวันที่ ---
    if (date) {
      const q = await pool.request()
        .input("snapshotDate", date)
        .query(`
          SELECT jsonData
          FROM StockStatusSnapshot
          WHERE snapshotDate = @snapshotDate
        `);

      if (q.recordset.length === 0) {
        return res.json({ count: 0, rows: [] });
      }

      let allRows = [];
      q.recordset.forEach(r => {
        const snap = JSON.parse(r.jsonData);
        if (Array.isArray(snap.rows)) {
          allRows = allRows.concat(snap.rows);
        }
      });

      allRows.sort((a, b) => {
        const x = a.branchCode.trim().toUpperCase();
        const y = b.branchCode.trim().toUpperCase();
        return parseInt(x.substring(0,2)) - parseInt(y.substring(0,2));
      });
      
      return res.json({
        count: allRows.length,
        rows: allRows
      });
    }

    // --- B) ไม่มีวันที่ → ใช้ snapshot ล่าสุดทุก branch ---
    const latest = await pool.request().query(`
      SELECT s1.jsonData
      FROM StockStatusSnapshot s1
      JOIN (
        SELECT branchCode, MAX(snapshotDate) AS maxDate
        FROM StockStatusSnapshot
        GROUP BY branchCode
      ) s2
      ON s1.branchCode = s2.branchCode AND s1.snapshotDate = s2.maxDate
    `);

    let rows = [];
    latest.recordset.forEach(r => {
      const snap = JSON.parse(r.jsonData);
      if (Array.isArray(snap.rows)) {
        rows = rows.concat(snap.rows);
      }
    });

    rows.sort((a, b) => {
    const x = a.branchCode.trim().toUpperCase();
    const y = b.branchCode.trim().toUpperCase();
    return parseInt(x.substring(0,2)) - parseInt(y.substring(0,2));
  });


    return res.json({
      count: rows.length,
      rows
    });
  } catch (err) {
    console.error("API /stock-status error:", err);
    res.status(500).json({ error: "Cannot load snapshot" });
  }
});

export default router;


    // // ====== B) โหลด snapshot ล่าสุดของทุก branch ======
    // const latest = await pool.request().query(`
    //   SELECT s1.jsonData
    //   FROM StockStatusSnapshot s1
    //   JOIN (
    //     SELECT branchCode, MAX(snapshotDate) AS maxDate
    //     FROM StockStatusSnapshot
    //     GROUP BY branchCode
    //   ) s2
    //   ON s1.branchCode = s2.branchCode
    //  AND s1.snapshotDate = s2.maxDate
    // `);

    // let rows = [];

    // latest.recordset.forEach(r => {
    //   const snap = JSON.parse(r.jsonData);
    //   if (Array.isArray(snap.rows)) {
    //     rows = rows.concat(snap.rows);
    //   }
    // });






    // ============= B) Load latest snapshot (all branches) =============
    // const latest = await pool.request().query(`
    //   SELECT s1.branchCode, s1.jsonData
    //   FROM StockStatusSnapshot s1
    //   INNER JOIN (
    //       SELECT branchCode, MAX(snapshotDate) AS maxDate
    //       FROM StockStatusSnapshot
    //       GROUP BY branchCode
    //   ) s2
    //   ON s1.branchCode = s2.branchCode
    //  AND s1.snapshotDate = s2.maxDate
    // `);

    // if (latest.recordset.length === 0) {
    //   return res.json({ rows: [], count: 0 });
    // }

    // let combinedRows = [];

    // for (const rec of latest.recordset) {
    //   const snapshot = JSON.parse(rec.jsonData);
    //   if (snapshot.rows && Array.isArray(snapshot.rows)) {
    //     combinedRows = combinedRows.concat(snapshot.rows);
    //   }
    // }

    // return res.json({
    //   count: combinedRows.length,
    //   rows: combinedRows
    // });


