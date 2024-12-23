import { query } from "./db.js";

(async () => {
  try {
    // Выполнение SQL для создания таблиц
    await query(`
      -- Создаем таблицу пользователей
      CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL
      );

      -- Создаем таблицу сессий
      CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          token VARCHAR(255) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Создаем таблицу таймеров
      CREATE TABLE IF NOT EXISTS timers (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          description TEXT NOT NULL,
          start_time TIMESTAMP NOT NULL,
          end_time TIMESTAMP
      );
    `);
    console.log("Миграции успешно применены!");
  } catch (err) {
    console.error("Ошибка миграции:", err.message);
  }
})();
