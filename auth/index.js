import express from "express";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import { query } from "./db.js"; // Ваш db.js (ESM) с export {query, pool}
import nunjucks from "nunjucks";
import crypto from "crypto";
import { createServer } from "http";
import { WebSocketServer } from "ws";

// ----- Инициализация Express -----
const app = express();

// ----- Настройка Nunjucks -----
nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});
app.set("view engine", "njk");

// ----- Middleware -----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

// ----- Middleware для авторизации (по cookie) -----
app.use(async (req, res, next) => {
  const token = req.cookies.authToken;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const session = await query("SELECT * FROM sessions WHERE token = $1", [token]);
    if (session.rows.length === 0) {
      req.user = null;
      return next();
    }
    const user = await query("SELECT id, username FROM users WHERE id = $1", [session.rows[0].user_id]);
    if (user.rows.length > 0) {
      req.user = user.rows[0];
      req.userId = user.rows[0].id;
    } else {
      req.user = null;
    }
    next();
  } catch (err) {
    console.error("Ошибка авторизации:", err.message);
    req.user = null;
    next();
  }
});

// ----- Главная страница -----
app.get("/", async (req, res) => {
  if (req.user) {
    try {
      const activeTimers = await query(
        "SELECT id, description, start_time FROM timers WHERE user_id = $1 AND end_time IS NULL",
        [req.userId]
      );
      const oldTimers = await query(
        "SELECT id, description, start_time, end_time FROM timers WHERE user_id = $1 AND end_time IS NOT NULL",
        [req.userId]
      );

      const formattedActive = activeTimers.rows.map((timer) => ({
        id: timer.id,
        description: timer.description,
        start: timer.start_time.toISOString(),
      }));
      const formattedOld = oldTimers.rows.map((timer) => ({
        id: timer.id,
        description: timer.description,
        start: timer.start_time.toISOString(),
        end: timer.end_time.toISOString(),
        duration: new Date(timer.end_time) - new Date(timer.start_time),
      }));

      res.render("index", {
        user: req.user,
        authError: null,
        activeTimers: formattedActive,
        oldTimers: formattedOld,
      });
    } catch (err) {
      console.error("Ошибка загрузки данных:", err.message);
      res.status(500).send("Internal server error");
    }
  } else {
    // Если не авторизован — показываем форму логина/регистрации
    res.render("index", {
      user: null,
      authError: req.query.authError === "true" ? "Invalid username or password" : null,
      activeTimers: [],
      oldTimers: [],
    });
  }
});

// ----- Регистрация пользователя -----
app.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  try {
    const check = await query("SELECT * FROM users WHERE username = $1", [username]);
    if (check.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    await query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [username, passwordHash]);
    res.redirect("/?authError=false");
  } catch (err) {
    console.error("Ошибка регистрации:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Авторизация пользователя -----
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await query("SELECT * FROM users WHERE username = $1", [username]);
    if (user.rows.length === 0) {
      return res.redirect("/?authError=true");
    }
    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) {
      return res.redirect("/?authError=true");
    }
    const token = crypto.randomBytes(64).toString("hex");
    await query("INSERT INTO sessions (user_id, token) VALUES ($1, $2)", [user.rows[0].id, token]);
    res.cookie("authToken", token, { httpOnly: true });
    res.redirect("/");
  } catch (err) {
    console.error("Ошибка авторизации:", err.message);
    res.status(500).send("Internal server error");
  }
});

// ----- Логаут -----
app.get("/logout", async (req, res) => {
  const token = req.cookies.authToken;
  if (token) {
    await query("DELETE FROM sessions WHERE token = $1", [token]);
  }
  res.clearCookie("authToken");
  res.redirect("/");
});

// ----- Создание таймера (HTTP) -----
app.post("/api/timers", async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { description } = req.body;
  if (!description) {
    return res.status(400).json({ error: "Description is required" });
  }
  try {
    const now = new Date();
    const result = await query(
      "INSERT INTO timers (user_id, description, start_time) VALUES ($1, $2, $3) RETURNING id",
      [req.userId, description, now]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    console.error("Ошибка создания таймера:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Остановка таймера (HTTP) -----
app.post("/api/timers/:id/stop", async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { id } = req.params;
  try {
    const now = new Date();
    const result = await query("UPDATE timers SET end_time = $1 WHERE id = $2 AND user_id = $3 AND end_time IS NULL", [
      now,
      id,
      req.userId,
    ]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Timer not found or already stopped" });
    }
    res.status(200).json({ message: "Timer stopped successfully" });
  } catch (err) {
    console.error("Ошибка остановки таймера:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Получение таймеров (HTTP) -----
app.get("/api/timers", async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const isActive = req.query.isActive === "true";
  try {
    const timers = await query(
      isActive
        ? "SELECT id, description, start_time FROM timers WHERE user_id = $1 AND end_time IS NULL"
        : "SELECT id, description, start_time, end_time FROM timers WHERE user_id = $1 AND end_time IS NOT NULL",
      [req.userId]
    );
    const formatted = timers.rows.map((timer) => ({
      id: timer.id,
      description: timer.description,
      start: timer.start_time.toISOString(),
      end: timer.end_time ? timer.end_time.toISOString() : null,
      progress: timer.end_time ? null : Date.now() - new Date(timer.start_time),
      duration: timer.end_time ? new Date(timer.end_time) - new Date(timer.start_time) : null,
    }));
    res.status(200).json(formatted);
  } catch (err) {
    console.error("Ошибка получения таймеров:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Создаём общий HTTP-сервер и WebSocketServer -----
const server = createServer(app);
const wss = new WebSocketServer({ server });

// ----- Для хранения подключений: userId -> WebSocket -----
const clients = new Map();

// ----- Разбор cookies (при WebSocket) -----
function parseCookies(cookieHeader = "") {
  const list = {};
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const name = parts[0]?.trim();
    const val = parts[1] ? decodeURIComponent(parts[1].trim()) : "";
    list[name] = val;
  });
  return list;
}

// ----- Функция: отправка полного списка таймеров -----
async function sendAllTimers(userId) {
  if (!clients.has(userId)) return;
  const ws = clients.get(userId);

  const active = await query("SELECT id, description, start_time FROM timers WHERE user_id = $1 AND end_time IS NULL", [
    userId,
  ]);
  const old = await query(
    "SELECT id, description, start_time, end_time FROM timers WHERE user_id = $1 AND end_time IS NOT NULL",
    [userId]
  );

  const activeTimers = active.rows.map((t) => ({
    id: t.id,
    description: t.description,
    start: t.start_time.toISOString(),
  }));
  const oldTimers = old.rows.map((t) => ({
    id: t.id,
    description: t.description,
    start: t.start_time.toISOString(),
    end: t.end_time.toISOString(),
    duration: new Date(t.end_time) - new Date(t.start_time),
  }));

  ws.send(
    JSON.stringify({
      type: "all_timers",
      data: { activeTimers, oldTimers },
    })
  );
}

// ----- WebSocket: connection -----
wss.on("connection", async (ws, req) => {
  try {
    // Разбираем cookie authToken
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.authToken;
    if (!token) {
      ws.close(1008, "Authentication Failed (no token)");
      return;
    }
    // Ищем токен в sessions
    const session = await query("SELECT * FROM sessions WHERE token = $1", [token]);
    if (session.rows.length === 0) {
      ws.close(1008, "Authentication Failed (session not found)");
      return;
    }
    const userId = session.rows[0].user_id;

    // Проверяем, что пользователь реально есть
    const user = await query("SELECT id, username FROM users WHERE id = $1", [userId]);
    if (user.rows.length === 0) {
      ws.close(1008, "Authentication Failed (user not found)");
      return;
    }

    // Сохраняем (userId -> ws)
    clients.set(userId, ws);

    // Сразу отправляем полный список таймеров
    await sendAllTimers(userId);

    // Слушаем сообщения
    ws.on("message", async (msg) => {
      const { type, data } = JSON.parse(msg);
      if (type === "create_timer") {
        const desc = data.description || "No desc";
        await query("INSERT INTO timers (user_id, description, start_time) VALUES ($1, $2, $3)", [
          userId,
          desc,
          new Date(),
        ]);
        await sendAllTimers(userId);
      } else if (type === "stop_timer") {
        const timerId = data.id;
        await query("UPDATE timers SET end_time = $1 WHERE id = $2 AND user_id = $3 AND end_time IS NULL", [
          new Date(),
          timerId,
          userId,
        ]);
        await sendAllTimers(userId);
      }
    });

    ws.on("close", () => {
      clients.delete(userId);
    });
  } catch (err) {
    console.error("WebSocket error:", err.message);
    ws.close(1011, "Server Error");
  }
});

// ----- Запуск -----
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
