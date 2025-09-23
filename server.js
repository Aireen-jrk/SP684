// ---- Imports ----
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { getPool, sql } from "./db.js";

import { StockStatusService } from "./services/StockStatusService.js";

// เชื่อมต่อ DB ทันที + log
getPool()
  .then(() => console.log("[DB] connected"))
  .catch(err => console.error("[DB] connect fail:", err?.message || err));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- App base ----
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // เสิร์ฟไฟล์หน้าเว็บจากโฟลเดอร์ public

// สร้าง service instances
const stockService  = new StockStatusService();

// ---- Sanity check ----
app.get("/api/ping", (req, res) => res.json({ ok: true, now: new Date().toISOString() }));


// ---- 2) Average Demand จากคอลัมน์รายเดือน ----
app.get("/api/stock-status", async (req, res) => {
  try {
    const { months, excludeCurrent, countMode, branch } = req.query;
    const data = await stockService.getStockStatus({ months, excludeCurrent, countMode, branch });
    res.json(data);
  } catch (e) {
    console.error("/api/stock-status:", e);
    res.status(500).json({ error: e.message || "Failed" });
  }
});

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Open UI: http://localhost:${PORT}/stock-status.html`);
});