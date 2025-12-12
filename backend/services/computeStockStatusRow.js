// backend/services/computeStockStatusRow.js
import jstatPkg from "jstat";
import { determineStatus } from "./StatusService.js";
// import {
//   SERVICE_LEVEL_CONFIG,
//   AVG_DEMAND_CONFIG,
//   MOVING_CONFIG,
// } from "../config/configStockStatus.js";   

/**
 * คำนวณ stock status จาก 1 row ที่มาจาก SQL
 * @param {object} r - แถวเดียวจาก result.recordset
 * @returns {object} - object ที่ส่งไปให้ frontend
 */
export function computeStockStatusRow(r) {
  const f = Number(r.cntNonZero ?? r.freq6 ?? 0);

  // --- Service level ตามความถี่การขาย ---
  let serviceLevel;
  if (f > 4) serviceLevel = 0.95;
  else if (f > 2 && f <= 4) serviceLevel = 0.93;
  else serviceLevel = 0.5;

//   if (f > SERVICE_LEVEL_CONFIG.HIGH_THRESHOLD) {
//   serviceLevel = SERVICE_LEVEL_CONFIG.HIGH;
// } else if (
//   f > SERVICE_LEVEL_CONFIG.MID_THRESHOLD &&
//   f <= SERVICE_LEVEL_CONFIG.HIGH_THRESHOLD
// ) {
//   serviceLevel = SERVICE_LEVEL_CONFIG.MID;
// } else {
//   serviceLevel = SERVICE_LEVEL_CONFIG.LOW;
// }

  const zRaw = jstatPkg.jStat.normal.inv(serviceLevel, 0, 1);
  const z = Math.round(zRaw * 100) / 100;

// อ่านยอดขาย 6 เดือนย้อนหลังจาก SQL
// --- FIX: parse sales6 correctly ---
let sales6Raw = r.sales6;

if (!sales6Raw || sales6Raw === "" || sales6Raw === null) {
  sales6Raw = "[]";  // fallback
}

// --- FIX: รองรับทั้ง string JSON และ array object ---
let sales6 = [];

if (Array.isArray(r.sales6)) {
  // กรณี SQL ส่ง array object มา
  sales6 = r.sales6.map(x => ({
    month: x.month,
    qty: Number(x.qty || 0)
  }));
} else {
  // กรณี SQL ส่ง string JSON
  try {
    const parsed = JSON.parse(r.sales6 || "[]");
    if (Array.isArray(parsed)) {
      sales6 = parsed.map(x => ({
        month: x.month,
        qty: Number(x.qty || 0)
      }));
    }
  } catch {
    sales6 = [];
  }
}

const seq6 = sales6.map(x => x.qty);
// ------------------------
// DEMAND JSON (9 เดือน)
// ------------------------
let sales9 = [];

try {
  let arr = r.demandJson;

  // SQL ส่ง string JSON
  if (typeof arr === "string") {
    arr = JSON.parse(arr);
  }

  if (Array.isArray(arr)) {
    sales9 = arr.map(x => ({
      month: x.monthEnd ?? x.month ?? null,
      qty: Number(x.demandQty ?? x.qty ?? 0),
    }));
  }
} catch (e) {
  sales9 = [];
}

const seq9 = sales9.map(x => x.qty);
  // --- Average Demand ตาม business rule ---
  const totalMonths = 6;
  const threshold = Math.floor((totalMonths * 3) / 4); 

  // const totalMonths = AVG_DEMAND_CONFIG.TOTAL_MONTHS;
  // const threshold =
  // AVG_DEMAND_CONFIG.TOTAL_MONTHS *
  // AVG_DEMAND_CONFIG.THRESHOLD_RATIO;

  const totalSales = seq6.reduce(
    (sum, v) => sum + (Number.isFinite(v) ? v : 0),
    0
  );
  const monthsWithSales = seq6.filter((v) => v > 0).length;

  let avgRaw = 0;
  let isNewItemDemandPattern = false;

  if (monthsWithSales === 0) {
    // กรณีไม่มีขายเลย 6 เดือน
    avgRaw = 0;
  } else if (monthsWithSales === totalMonths) {
    // กรณีที่ 1: มียอดขายครบ 6 เดือน
    avgRaw = totalSales / totalMonths;
  } else if (
    monthsWithSales < totalMonths &&
    monthsWithSales >= threshold // ไม่น้อยกว่า 3/4 ของ 6 เดือน
  ) {
    // กรณีที่ 2
    avgRaw = (totalSales / monthsWithSales) * (3 / 4);
  } else {
    // กรณีที่ 3 หรือ 4 → ดู 2 เดือนล่าสุด
    const last2 = seq6.slice(-2);
    const last2HaveSales =
      last2.length === 2 && (last2[0] > 0 || last2[1] > 0);
    const last2NoSales =
      last2.length === 2 && last2[0] === 0 && last2[1] === 0;

    if (last2NoSales) {
      // กรณีที่ 4: สองเดือนล่าสุดไม่มีขาย → เดือนถัดไปไม่คาดว่าจะสั่ง
      avgRaw = 0;
    } else if (last2HaveSales) {
      // กรณีที่ 3: ขายไม่ครบ 6 เดือน < 3/4 แต่สองเดือนล่าสุดมียอดขาย
      avgRaw = totalSales / monthsWithSales;
      isNewItemDemandPattern = true;
    } else {
      // fallback: pattern แปลก ๆ → เฉลี่ย 6 เดือน
      avgRaw = totalSales / totalMonths;
    }
  }

  const avg = Math.ceil(avgRaw);

  // --- stdev6: ใช้ 6 เดือนสุดท้าย ---
  let stdevRaw;
  if (seq6.length >= 2) {
    stdevRaw = jstatPkg.jStat.stdev(seq6, true); // population stdev
  } else { 
    stdevRaw = 0;
  }
  const stdevInt = Math.round(stdevRaw);

  // --- trend: ใช้ 6 เดือนสุดท้าย ---
  let sumRat = 0,
    cntRat = 0;
  for (let i = 1; i < seq6.length; i++) {
    const prev = seq6[i - 1];
    const curr = seq6[i];
    if (prev > 0) {
      sumRat += curr / prev;
      cntRat++;
    }
  }
  const growthAvg = cntRat > 0 ? sumRat / cntRat : 0;
  const trend = Math.round(growthAvg * 100) / 100;

  // --- Safety Stock & Min/ROP ---
  const ltDays = Math.max(
    0,
    Number(r.LT_PO ?? 0) +
      Number(r.LT_SP ?? 0) +
      Number(r.LT_DC ?? 0)
  );
  const ltFactor = Math.sqrt(ltDays / 30);
  const sumLT = ltDays / 30;

  const safetyStock = Math.round(Math.max(0, z * stdevInt * ltFactor));
  const reorderPoint = Math.round(Math.max(0, avg * sumLT));
  const minQty = Math.max(0, safetyStock + reorderPoint);

  const onHandQty = Math.round(Number(r.onHandQty ?? 0));
  const backlog = Math.round(Number(r.backlog ?? 0));
  const turnOver =
    avg > 0 ? Number(((onHandQty + backlog) / avg).toFixed(2)) : 0;

  // ====== DeadStock / Inactive ======
  const hasSalesLast6 = seq6.some((v) => v > 0);
  const hasSalesLast9 = seq9.some((v) => v > 0);

  const isDeadStock = !hasSalesLast9;
  const isInactive = !hasSalesLast6 && f <= 2;

  // ====== Fast / Slow moving ======
  let stockMoving = null;
  if (trend >= 1 && turnOver <= 2) {
    stockMoving = "Fast moving";
  } else if (turnOver >= 6) {
    stockMoving = "Slow moving";
  }

  // if (
  // trend >= MOVING_CONFIG.FAST_TREND_MIN &&
  // turnOver <= MOVING_CONFIG.FAST_TURNOVER_MAX
  // ) {
  //   stockMoving = "Fast moving";
  // } else if (turnOver >= MOVING_CONFIG.SLOW_TURNOVER_MIN) {
  //   stockMoving = "Slow moving";
  // }

  // --- New Item flag ---
  const isNewItem = isNewItemDemandPattern;
  const inItemGroup = String(r.Item_Group ?? "").trim() !== "";

  const status = determineStatus({
    isNewItem,
    inItemGroup,
    cntNonZero: Number(r.cntNonZero ?? 0),
    salesLast1: 0,
    avg,
    onHandQty,
    outstandingPo: backlog,
    minQty,
  });

  return {
    branchCode: r.branchCode,
    skuNumber: r.skuNumber,
    productName: r.productName,

    averageDemand: avg,
    stdev6: stdevInt,
    zScore: z,
    cntNonZero: f,
    serviceLevel,

    LT_PO: Number(r.LT_PO ?? 0),
    LT_SP: Number(r.LT_SP ?? 0),
    LT_DC: Number(r.LT_DC ?? 0),
    safetyStock,
    trend,
    minQty,
    onHandQty,
    backlog,
    turnOver,
    Item_Group: r.Item_Group ?? "",
    New_Item: isNewItem ? 1 : 0,

    status,
    brandName: r.brandName ?? null,

    accGroupId: r.accGroupId ?? null,
    accGroupName: r.accGroupName ?? null,

    sales6,   // ไว้โชว์ใน popover HTML

    stockMoving,
    isInactive,
    isDeadStock,
  };
}
