import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  jwt: {
    secret: process.env.JWT_SECRET || "fallback_secret_change_me",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  livekit: {
    apiKey: process.env.LIVEKIT_API_KEY || "",
    apiSecret: process.env.LIVEKIT_API_SECRET || "",
    url: process.env.LIVEKIT_URL || "ws://localhost:7880",
  },

  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  },
} as const;