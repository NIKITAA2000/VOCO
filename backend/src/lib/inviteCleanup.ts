import { db } from "./db.js";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export async function cleanupExpiredInvites(): Promise<number> {
  const result = await db.query(
    `DELETE FROM invite_links
     WHERE (expires_at IS NOT NULL AND expires_at < NOW())
        OR (max_uses IS NOT NULL AND uses_count >= max_uses)`
  );
  return result.rowCount ?? 0;
}

export function startInviteCleanupJob() {
  const run = async () => {
    try {
      const deleted = await cleanupExpiredInvites();
      if (deleted > 0) {
        console.log(`🧹 Удалено истёкших ссылок-приглашений: ${deleted}`);
      }
    } catch (error) {
      console.error("Invite cleanup error:", error);
    }
  };

  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
