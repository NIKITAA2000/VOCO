import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import inviteRoutes from "./routes/invites.js";
import uploadRoutes, { UPLOAD_DIR } from "./routes/uploads.js";

const app = express();

app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json());

// Routes
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Раздаём загруженные файлы. В проде nginx может проксировать этот префикс
// прямо к Docker-volume, но dev-сервер тоже умеет.
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1d", index: false }));

app.use("/api/auth", authRoutes);
// Аплоад прикручен поверх /api/rooms — путь /api/rooms/:slug/uploads.
// Регистрируем ДО roomRoutes, чтобы uploadAuth (поддерживает LiveKit JWT
// для гостей) обрабатывал запрос раньше, чем roomRoutes' authenticate
// (который понимает только наш Bearer и отбивает гостей 401-м).
app.use("/api/rooms", uploadRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/invite", inviteRoutes);

export default app;