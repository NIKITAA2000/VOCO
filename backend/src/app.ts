import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import inviteRoutes from "./routes/invites.js";

const app = express();

app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json());

// Routes
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/invite", inviteRoutes);

export default app;