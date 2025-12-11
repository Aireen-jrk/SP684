// backend/scripts/generateStockSnapshot.js
import fs from "fs/promises";
import path from "path";
import { getPool } from "../../db.js";
import { StockStatusService } from "../services/StockStatusService.js";
import { computeStockStatusRow } from "../services/computeStockStatusRow.js";

const BRANCHES = [
  "00TR","01TJ","02TN","03TS","04TP","05AY","06RY","07RB","08NR","09UB",
  "10KK","11PL","12CM","13SR","14HY","15CB","16PK","17CR","18UD","19PC",
  "20SK","21BS","22BP","23NS","24TL","25SB"
];

async function main() {
  const pool = await getPool();
  const service = new StockStatusService();

  const today = new Date().toISOString().slice(0, 10);

  console.log(`⏳ Generating snapshot for all branches on ${today} ...`);
  await fs.mkdir("snapshot", { recursive: true });

  for (const branch of BRANCHES) {
    console.log(`➡ Processing branch: ${branch}`);

    const raw = await service.getStockStatus({
      months: 6,
      sortBy: "branchCode",
      order: "asc",
      branch
    });

    // 1) unique filter
    const uniqueRows = [];
    const seen = new Set();

    for (const row of raw.rows) {
      const key = `${row.branchCode}-${row.skuNumber}`;
      if (!seen.has(key)) {
        uniqueRows.push(row);
        seen.add(key);
      }
    }
console.log("DEBUG RAW sales6 =", uniqueRows[0].sales6);
console.log("TYPE =", typeof uniqueRows[0].sales6);

    // 2) compute
    const computed = uniqueRows.map(row =>
      computeStockStatusRow({
        ...row,
        monthsUsed: 6,
        stdevMonths: 6,
        excludeCurrent: true
      })
    );

    console.log("RAW ROW (first row):", uniqueRows[0]);
    console.log("COMPUTED (first row):", computed[0]);

    // 3) build snapshot object
    const snapshot = {
      snapshotDate: today,
      branchCode: branch,
      rows: computed
    };

    // 4) save to DB
    await pool.request()
      .input("snapshotDate", today)
      .input("branchCode", branch)
      .input("jsonData", JSON.stringify(snapshot))
      .query(`
        INSERT INTO StockStatusSnapshot (snapshotDate, branchCode, jsonData)
        VALUES (@snapshotDate, @branchCode, @jsonData)
      `);

    console.log(`✔ Saved to DB for branch ${branch}`);
  }
}

// ⭐⭐ IMPORTANT: ต้องมีปิด } และเรียก main()
main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
