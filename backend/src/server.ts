import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";

const app = express();

// --- Middleware ---
app.use(
  cors({
    origin: config.cors.origin,
    credentials: true,
  })
);
app.use(express.json());

// --- Routes ---
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);

// --- 404 handler ---
app.use((_req, res) => {
  res.status(404).json({ error: "Маршрут не найден" });
});

// --- Start server ---
app.listen(config.port, () => {
  console.log(`
  Backend запущен
  http://localhost:${config.port}
  Режим: ${config.nodeEnv}
  `);
});

export default app;