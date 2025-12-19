// services/StatusService.js

// services/StatusService.js

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * คำนวณสถานะ Stock ตาม flowchart
 * @param {object} p
 * @param {number}  p.New_Item        - 1 = new item
 * @param {string}  p.Item_Group      - กลุ่มสินค้า
 * @param {number}  p.cntNonZero      - ความถี่ขาย 6 เดือน (qty > 0)
 * @param {Array}   p.sales6          - [{ month, qty }]
 * @param {number}  p.averageDemand   - Average Demand
 * @param {number}  p.onHandQty       - Stock คงเหลือ
 * @param {number}  p.backlog         - PO ค้าง
 * @param {number}  p.minQty          - MIN
 * @returns {"ปกติ" | "มากเกินไป" | "น้อยเกินไป"}
 */
export function determineStatus(p) {
  const isNewItem   = n(p.New_Item) === 1;
  const inItemGroup = String(p.Item_Group ?? "").trim() !== "";

  const frequency6 = n(p.cntNonZero);

  // 🔑 เดือนล่าสุด = ตัวสุดท้ายของ sales6
  const salesLast1 = Array.isArray(p.sales6) && p.sales6.length > 0
    ? n(p.sales6[p.sales6.length - 1].qty)
    : 0;

  const avg           = n(p.averageDemand);
  const onHand        = n(p.onHandQty);
  const outstandingPo = n(p.backlog);
  const minQty        = Math.max(0, Math.ceil(n(p.minQty)));

  /* ===============================
     1) ไม่ต้องสั่งซื้อ (ปกติ)
     =============================== */
  const noOrder =
    (
      (!isNewItem && frequency6 <= 1 && salesLast1 <= 0) || // สินค้าเก่า + แทบไม่ขาย
      inItemGroup ||                                       // อยู่ในกลุ่มที่ไม่ต้องสั่ง
      (avg === 0 && onHand === 0)                          // ไม่มี demand และไม่มี stock
    );

  if (noOrder) return "ปกติ";

  /* ===============================
     2) มากเกินไป
     =============================== */
  if (onHand + outstandingPo > minQty) {
    return "มากเกินไป";
  }

  /* ===============================
     3) น้อยเกินไป → ควรสั่งซื้อ
     =============================== */
  return "น้อยเกินไป";
}

