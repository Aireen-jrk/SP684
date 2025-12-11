// export class MonthWindow {
//   constructor(allMonthCols) {
//     this.all = [...allMonthCols]; // เช่น ["Jan_67",...,"Jul_68"]
//   }

//   /**
//    * เลือกคอลัมน์เดือน N เดือนย้อนหลัง
//    * @param {number} months - จำนวนเดือนย้อนหลัง (3/6/12)
//    * @param {boolean} excludeCurrent - true = ตัดเดือนล่าสุดออก (ไม่รวมเดือนปัจจุบัน)
//    */
//   // คอลัมน์ 6 เดือนล่าสุดไม่รวมเดือนปัจจุบัน
//   pick(months = 6, excludeCurrent = true) {
//     if (!Array.isArray(this.all) || this.all.length === 0) return [];
//     if (excludeCurrent) {
//       const tail = this.all.slice(-(months + 1)); // เอา N+1 ตัวท้าย
//       return tail.slice(0, -1);                   // ตัดตัวท้ายสุด (เดือนปัจจุบัน)
//     }
//     return this.all.slice(-months);
//   }

//   /**
//    * นิพจน์ SUM แบบกัน overflow (BIGINT) และกัน NULL
//    */
//   buildSumExpr(cols) {
//     if (!cols.length) return "CAST(0 AS BIGINT)";
//     return cols.map(c => `CAST(ISNULL([${c}],0) AS BIGINT)`).join(" + ");
//   }

//   /**
//    * นิพจน์ตัวนับเดือน: // ผลรวมยอดขายย้อนหลัง
//    *  - mode = 'all'      → นับทุกเดือนที่เลือก (รวมศูนย์)
//    *  - mode = 'nonzero'  → นับเฉพาะเดือนที่ > 0
//    */
//   buildCountExpr(cols, mode = "nonzero") {
//     if (!cols.length) return "0";
//     if (mode === "all") return String(cols.length);
//     return cols
//       .map(c => `(CASE WHEN CAST(ISNULL([${c}],0) AS INT) > 0 THEN 1 ELSE 0 END)`)
//       .join(" + ");
//   }
// }

// backend/lib/MonthWindow.js
export class MonthWindow {
  constructor(allMonthCols) {
    // เช่น ["Jan_67", ... , "Jul_68", "AUG_68", "SEP_68"]
    this.all = [...allMonthCols];
  }

  /**
   * เลือกคอลัมน์เดือน N เดือนย้อนหลัง
   * @param {number} months - จำนวนเดือนย้อนหลัง (3/6/9/12)
   * @param {boolean} excludeCurrent - true = ตัดเดือนล่าสุดออก (ไม่รวมเดือนปัจจุบัน)
   */
  pick(months = 6, excludeCurrent = true) {
    if (!Array.isArray(this.all) || this.all.length === 0) return [];

    if (excludeCurrent) {
      // เอา N+1 ตัวท้าย แล้วตัดตัวสุดท้าย (เดือนปัจจุบัน)
      const tail = this.all.slice(-(months + 1));
      return tail.slice(0, -1);
    }

    // ไม่ตัดเดือนปัจจุบัน → เอา N ตัวท้ายเลย
    return this.all.slice(-months);
  }

  /**
   * นิพจน์ SUM ของคอลัมน์ที่เลือก
   * คืนเป็น string ไปใช้ใน SQL เช่น
   *  ISNULL(TRY_CONVERT(decimal(18,4), [Jan_68]),0) + ...
   */
  buildSumExpr(cols) {
    if (!cols.length) return "0.0";
    return cols
      .map(c => `ISNULL(TRY_CONVERT(decimal(18,4), [${c}]), 0)`)
      .join(" + ");
  }

  /**
   * นิพจน์ตัวนับเดือน
   *  - mode = 'all'      → นับทุกเดือนที่เลือก (รวมศูนย์)
   *  - mode = 'nonzero'  → นับเฉพาะเดือนที่ > 0
   */
  buildCountExpr(cols, mode = "nonzero") {
    if (!cols.length) return "0";
    if (mode === "all") return String(cols.length);

    // นับเฉพาะเดือนที่มียอดขาย > 0 โดยไม่ CAST เป็น int แล้ว
    return cols
      .map(
        c => `(CASE WHEN ISNULL(TRY_CONVERT(decimal(18,4), [${c}]), 0) > 0 THEN 1 ELSE 0 END)`
      )
      .join(" + ");
  }
}
