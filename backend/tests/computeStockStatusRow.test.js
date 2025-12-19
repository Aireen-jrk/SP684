// backend/tests/computeStockStatusRow.test.js
import { computeStockStatusRow } from "../services/computeStockStatusRow.js";

//
// Helper: สร้าง sales6 (ข้อมูลจริงที่หน้าเว็บใช้)
//
function makeSales6(qtys) {
  return qtys.map((q, i) => ({
    month: `2025-0${i + 1}-28`,
    qty: q,
  }));
}

describe("computeStockStatusRow – using real frontend data structure", () => {

  // -------------------------------------------------------------------
  // CASE 1: มียอดขายครบ 6 เดือน → avg = sum/6
  // -------------------------------------------------------------------
  test("Case 1: ขายครบ 6 เดือน → avg = sum/6", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([10,10,10,10,10,10]),
      demandJson: "[]",
      cntNonZero: 6,
      LT_PO: 10, LT_SP: 5, LT_DC: 5,
      onHandQty: 0, backlog: 0,
      Item_Group: "",
    });

    expect(row.averageDemand).toBe(10);
    expect(row.New_Item).toBe(0);
  });

  // -------------------------------------------------------------------
  // CASE 2: ขาย 4 เดือน → avg = (sum/4)*3/4
  // -------------------------------------------------------------------
  test("Case 2: ขาย 4 เดือน → (sum/4)*0.75", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([10,38,44,16,0,0]),
      demandJson: "[]",
      cntNonZero: 4,
      LT_PO: 10, LT_SP: 5, LT_DC: 5,
      onHandQty: 0, backlog: 0,
      Item_Group: "",
    });

    // sum = 20 → avgRaw = (20/4)*0.75 = 3.75 → ceil → 4
    expect(row.averageDemand).toBe(27);
  });

  // -------------------------------------------------------------------
  // CASE 3: new item → เดือนใดเดือนหนึ่งในสองเดือนล่าสุดขาย
  // -------------------------------------------------------------------
  test("Case 3: ขาย < 3/4 แต่มีขายในสองเดือนล่าสุด → new item", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([0,4,4,4,0,4]),
      demandJson: "[]",
      cntNonZero: 1,
      LT_PO: 10, LT_SP: 5, LT_DC: 5,
      onHandQty: 0, backlog: 0,
      Item_Group: "",
    });

    // totalSales = 8, monthsWithSales = 2 → avgRaw = 8/2 = 4
    expect(row.averageDemand).toBe(4);
    expect(row.New_Item).toBe(1);
  });

  // -------------------------------------------------------------------
  // CASE 4: สองเดือนล่าสุดไม่มีขาย → avg = 0
  // -------------------------------------------------------------------
  test("Case 4: สองเดือนล่าสุดไม่ขายเลย → avg = 0", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([10,38,44,16,0,0]),
      demandJson: "[]",
      cntNonZero: 2,
      LT_PO: 10, LT_SP: 5, LT_DC: 5,
      onHandQty: 0, backlog: 0,
      Item_Group: "",
    });

    expect(row.averageDemand).toBe(0);
  });

  // -------------------------------------------------------------------
  // SERVICE LEVEL
  // -------------------------------------------------------------------
  test("Service level mapping", () => {
    expect(computeStockStatusRow({ sales6: [], demandJson:"[]", cntNonZero: 5 }).serviceLevel).toBe(0.95);
    expect(computeStockStatusRow({ sales6: [], demandJson:"[]", cntNonZero: 3 }).serviceLevel).toBe(0.93);
    expect(computeStockStatusRow({ sales6: [], demandJson:"[]", cntNonZero: 1 }).serviceLevel).toBe(0.5);
  });

  // -------------------------------------------------------------------
  // STDEV
  // -------------------------------------------------------------------
  test("stdev basic", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([0,10,0,10,0,10]),
      demandJson:"[]",
      cntNonZero: 3,
      LT_PO: 0, LT_SP: 0, LT_DC: 0,
      onHandQty: 0, backlog: 0,
      Item_Group: "",
    });

    expect(row.stdev6).toBe(5);
  });

  // -------------------------------------------------------------------
  // TREND
  // -------------------------------------------------------------------
  test("trend calculation", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([4,14,9,11,0,0]),
      demandJson:"[]",
      cntNonZero: 5,
      LT_PO: 0, LT_SP: 0, LT_DC: 0,
      onHandQty: 0, backlog: 0,
      Item_Group: "",
    });

    expect(row.trend).toBe(1.34);
  });

  // -------------------------------------------------------------------
  // INACTIVE / DEADSTOCK
  // -------------------------------------------------------------------
  test("inactive case", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([0,0,0,0,0,0]),
      demandJson:"[]",
      cntNonZero: 2,
      LT_PO: 0, LT_SP: 0, LT_DC: 0,
      onHandQty: 0, backlog: 0,
      Item_Group: "",
    });

    expect(row.isInactive).toBe(true);
  });

test("deadstock case", () => {
  const row = computeStockStatusRow({
    demandJson: JSON.stringify([
      { monthEnd: "2025-01-01", demandQty: 0 },
      { monthEnd: "2025-02-01", demandQty: 0 },
      { monthEnd: "2025-03-01", demandQty: 0 },
      { monthEnd: "2025-04-01", demandQty: 0 },
      { monthEnd: "2025-05-01", demandQty: 1 },  // มีขายเดือนเดียว
      { monthEnd: "2025-06-01", demandQty: 0 },
      { monthEnd: "2025-07-01", demandQty: 0 },
      { monthEnd: "2025-08-01", demandQty: 0 },
      { monthEnd: "2025-09-01", demandQty: 0 },
    ]),
    sales6: JSON.stringify([]),
    cntNonZero: 0,
    LT_PO: 0, LT_SP: 0, LT_DC: 0,
    onHandQty: 0, backlog: 0,
    Item_Group: "",
  });

  expect(row.isDeadStock).toBe(false); // ← ถูกต้องตามนิยาม
});


  // -------------------------------------------------------------------
  // MOVING SPEED
  // -------------------------------------------------------------------
  test("fast moving", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([5,5,5,5,10,10]),
      demandJson:"[]",
      cntNonZero: 6,
      LT_PO: 0, LT_SP: 0, LT_DC: 0,
      onHandQty: 10, backlog: 0,
      Item_Group: "",
    });

    expect(row.stockMoving).toBe("Fast moving");
  });

  test("slow moving", () => {
    const row = computeStockStatusRow({
      sales6: makeSales6([1,1,1,1,1,1]),
      demandJson:"[]",
      cntNonZero: 6,
      LT_PO: 0, LT_SP: 0, LT_DC: 0,
      onHandQty: 60, backlog: 0,
      Item_Group: "",
    });

    expect(row.stockMoving).toBe("Slow moving");
  });
});
