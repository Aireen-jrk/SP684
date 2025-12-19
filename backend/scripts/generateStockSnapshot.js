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
async function runSnapshotForBranch(branch, pool, service) {
  console.log(`\n➡️  [${branch}] START SNAPSHOT`);
  const t0 = Date.now();

  // =========================
  // 1) RUN SQL (RAW ONLY)
  // =========================
  console.log(`🟡 [${branch}] SQL start`);
  const tSql = Date.now();

  const raw = await service.getStockStatus({
    branch,
    rawOnly: true   // 🔥 สำคัญ: ไม่ compute ใน service
  });

  console.log(
    `🟢 [${branch}] SQL done | rows=${raw.rows.length} | ${(Date.now() - tSql) / 1000}s`
  );

  if (!raw.rows.length) {
    console.warn(`⚠️  [${branch}] NO DATA`);
    return;
  }

  // =========================
  // 2) COMPUTE (ONCE)
  // =========================
  console.log(`🧮 [${branch}] compute start`);
  const tCompute = Date.now();

  const computed = raw.rows.map(r =>
    computeStockStatusRow({
      ...r,
      monthsUsed: 6,
      stdevMonths: 6,
      excludeCurrent: true
    })
  );

  console.log(
    `🟢 [${branch}] compute done | rows=${computed.length} | ${(Date.now() - tCompute) / 1000}s`
  );

  // =========================
  // 3) SAVE SNAPSHOT
  // =========================
  console.log(`💾 [${branch}] save snapshot`);
  const tSave = Date.now();

  const snapshot = {
    snapshotDate: new Date().toISOString().slice(0, 10),
    branchCode: branch,
    rows: computed
  };

  await pool.request()
    .input("snapshotDate", snapshot.snapshotDate)
    .input("branchCode", branch)
    .input("jsonData", JSON.stringify(snapshot))
    .query(`
      INSERT INTO StockStatusSnapshot (snapshotDate, branchCode, jsonData)
      VALUES (@snapshotDate, @branchCode, @jsonData)
    `);

  console.log(
    `✅ [${branch}] SAVED | ${(Date.now() - tSave) / 1000}s`
  );

  console.log(
    `🏁 [${branch}] FINISHED | total ${(Date.now() - t0) / 1000}s`
  );
}

async function main() {
  console.log("⏳ GENERATE STOCK SNAPSHOT (REFRACTOR VERSION)");
  const pool = await getPool();
  const service = new StockStatusService();

  for (const branch of BRANCHES) {
    try {
      await runSnapshotForBranch(branch, pool, service);
    } catch (err) {
      console.error(`❌ [${branch}] ERROR`, err);
      // ไม่ throw เพื่อให้สาขาอื่นยังรันต่อ
    }
  }

  console.log("\n🎉 ALL BRANCHES DONE");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ FATAL ERROR", err);
  process.exit(1);
});