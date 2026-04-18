import app from "./app.js";
import { config } from "./config/index.js";
import { initDatabase } from "./lib/db.js";
import { startInviteCleanupJob } from "./lib/inviteCleanup.js";

async function start() {
  try {
    await initDatabase();
    startInviteCleanupJob();
    app.listen(config.port, () => {
      console.log(`🚀 VOCO backend running on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();