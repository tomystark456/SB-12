// db.js
import { config } from "dotenv";
import pg from "pg";

config(); // Загружаем .env

const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT, 10),
});

export async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } catch (err) {
    console.error("Ошибка выполнения запроса:", err);
    throw err;
  } finally {
    client.release();
  }
}

export { pool };
