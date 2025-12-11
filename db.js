// db.js
import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

// ============================
//  DB A: Main Database (ของโปรเจคคุณ)
// ============================
const mainConfig = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate:
      process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },

  // 👇 เพิ่มบรรทัดนี้
  requestTimeout: 0,
};

// ============================
//  DB B: External Database (ที่คุณเปิดใน DBeaver)
// ============================
// แนะนำให้ตั้งค่าในไฟล์ .env เช่น:
// EXTERNAL_DB_SERVER=192.168.1.10
// EXTERNAL_DB_DATABASE=MasterDB
// EXTERNAL_DB_USER=sa
// EXTERNAL_DB_PASSWORD=xxxxx
// ============================
const externalConfig = {
  server: process.env.EXTERNAL_DB_SERVER,
  port: Number(process.env.EXTERNAL_DB_PORT || 1433),
  database: process.env.EXTERNAL_DB_DATABASE,
  user: process.env.EXTERNAL_DB_USER,
  password: process.env.EXTERNAL_DB_PASSWORD,
  options: {
    encrypt: process.env.EXTERNAL_DB_ENCRYPT === "true",
    trustServerCertificate:
      process.env.EXTERNAL_DB_TRUST_SERVER_CERTIFICATE === "true",
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

// ============================
//  Connection Pools
// ============================
let mainPool;
let externalPool;

// ฟังก์ชันดึง Connection หลักเดิม
export async function getPool() {
  if (mainPool?.connected) return mainPool;
  mainPool = await sql.connect(mainConfig);
  return mainPool;
}

// ฟังก์ชันดึง Connection สำหรับ DB DBeaver
export async function getExternalPool() {
  if (externalPool?.connected) return externalPool;
  externalPool = await sql.connect(externalConfig);
  return externalPool;
}

export { sql };
