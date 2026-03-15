import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { initDatabase } from "../lib/db.js";

const testId = Date.now().toString(36);

const OWNER = {
  email: `mod_owner_${testId}@voco.test`,
  username: `mod_owner_${testId}`,
  password: "TestPass123",
};
const MOD_CANDIDATE = {
  email: `mod_mod_${testId}@voco.test`,
  username: `mod_mod_${testId}`,
  password: "TestPass123",
};
const PARTICIPANT = {
  email: `mod_part_${testId}@voco.test`,
  username: `mod_part_${testId}`,
  password: "TestPass123",
};
const TO_BLOCK = {
  email: `mod_block_${testId}@voco.test`,
  username: `mod_blk_${testId}`,
  password: "TestPass123",
};
const OUTSIDER = {
  email: `mod_out_${testId}@voco.test`,
  username: `mod_out_${testId}`,
  password: "TestPass123",
};

let ownerToken = "";
let modToken = "";
let participantToken = "";
let toBlockToken = "";
let _outsiderToken = "";

let modUserId = "";
let participantUserId = "";
let toBlockUserId = "";

let roomSlug = "";

// Декодируем JWT payload без верификации подписи
function decodeJwt(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

beforeAll(async () => {
  await initDatabase();

  // Регистрируем всех пользователей
  const r1 = await request(app).post("/api/auth/register").send(OWNER);
  ownerToken = r1.body.token;

  const r2 = await request(app).post("/api/auth/register").send(MOD_CANDIDATE);
  modToken = r2.body.token;
  modUserId = r2.body.user.id;

  const r3 = await request(app).post("/api/auth/register").send(PARTICIPANT);
  participantToken = r3.body.token;
  participantUserId = r3.body.user.id;

  const r4 = await request(app).post("/api/auth/register").send(TO_BLOCK);
  toBlockToken = r4.body.token;
  toBlockUserId = r4.body.user.id;

  const r5 = await request(app).post("/api/auth/register").send(OUTSIDER);
  _outsiderToken = r5.body.token;

  // Создаём комнату
  const r6 = await request(app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Moderation Test Room" });
  roomSlug = r6.body.room.slug;

  // Все заходят в комнату
  await request(app)
    .post(`/api/rooms/${roomSlug}/join`)
    .set("Authorization", `Bearer ${modToken}`);
  await request(app)
    .post(`/api/rooms/${roomSlug}/join`)
    .set("Authorization", `Bearer ${participantToken}`);
  await request(app)
    .post(`/api/rooms/${roomSlug}/join`)
    .set("Authorization", `Bearer ${toBlockToken}`);
});

// ==========================================
// PATCH /api/rooms/:slug/participants/:userId/role
// ==========================================
describe("PATCH /api/rooms/:slug/participants/:userId/role", () => {
  it("owner назначает модератора", async () => {
    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "MODERATOR" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Роль обновлена");
  });

  it("owner понижает модератора обратно до участника", async () => {
    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "PARTICIPANT" });

    expect(res.status).toBe(200);

    // Возвращаем роль модератора для дальнейших тестов
    await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "MODERATOR" });
  });

  it("owner не может изменить собственную роль", async () => {
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${ownerToken}`);
    const ownerId = meRes.body.user.id;

    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${ownerId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "PARTICIPANT" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("собственную роль");
  });

  it("модератор не может менять роли — 403", async () => {
    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${participantUserId}/role`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ role: "MODERATOR" });

    expect(res.status).toBe(403);
  });

  it("участник не может менять роли — 403", async () => {
    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
      .set("Authorization", `Bearer ${participantToken}`)
      .send({ role: "PARTICIPANT" });

    expect(res.status).toBe(403);
  });

  it("без токена — 401", async () => {
    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
      .send({ role: "PARTICIPANT" });

    expect(res.status).toBe(401);
  });

  it("невалидная роль — 400", async () => {
    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "SUPERADMIN" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ошибка валидации");
  });

  it("несуществующий участник — 404", async () => {
    const res = await request(app)
      .patch(
        `/api/rooms/${roomSlug}/participants/00000000-0000-0000-0000-000000000000/role`
      )
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "MODERATOR" });

    expect(res.status).toBe(404);
  });

  it("несуществующая комната — 404", async () => {
    const res = await request(app)
      .patch(`/api/rooms/no-such-room/participants/${modUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "MODERATOR" });

    expect(res.status).toBe(404);
  });
});

// ==========================================
// POST /api/rooms/:slug/block — блокировка
// ==========================================
describe("POST /api/rooms/:slug/block", () => {
  it("owner блокирует участника", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ userId: toBlockUserId, reason: "Нарушение правил" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Пользователь заблокирован");
  });

  it("модератор блокирует другого участника", async () => {
    // participantUserId блокируем модератором (потом разблокируем)
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ userId: participantUserId });

    expect(res.status).toBe(200);

    // Разблокируем чтобы не ломать дальнейшие тесты
    await request(app)
      .delete(`/api/rooms/${roomSlug}/block/${participantUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
  });

  it("участник не может блокировать — 403", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .set("Authorization", `Bearer ${participantToken}`)
      .send({ userId: toBlockUserId });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("прав");
  });

  it("без токена — 401", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .send({ userId: toBlockUserId });

    expect(res.status).toBe(401);
  });

  it("нельзя заблокировать владельца — 400", async () => {
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${ownerToken}`);
    const ownerId = meRes.body.user.id;

    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ userId: ownerId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("владельца");
  });

  it("нельзя заблокировать самого себя — 400", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ userId: (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${ownerToken}`)).body.user.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("себя");
  });

  it("невалидный userId — 400", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ userId: "not-a-uuid" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ошибка валидации");
  });

  it("несуществующая комната — 404", async () => {
    const res = await request(app)
      .post("/api/rooms/no-such-room/block")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ userId: toBlockUserId });

    expect(res.status).toBe(404);
  });
});

// ==========================================
// GET /api/rooms/:slug/blocked — список заблокированных
// ==========================================
describe("GET /api/rooms/:slug/blocked", () => {
  it("owner видит список заблокированных", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}/blocked`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBeInstanceOf(Array);
    expect(res.body.blocked.length).toBeGreaterThanOrEqual(1);

    const entry = res.body.blocked.find(
      (b: any) => b.user.id === toBlockUserId
    );
    expect(entry).toBeDefined();
    expect(entry.reason).toBe("Нарушение правил");
    expect(entry.blockedBy.username).toBeDefined();
  });

  it("модератор видит список заблокированных", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}/blocked`)
      .set("Authorization", `Bearer ${modToken}`);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBeInstanceOf(Array);
  });

  it("участник не видит список — 403", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}/blocked`)
      .set("Authorization", `Bearer ${participantToken}`);

    expect(res.status).toBe(403);
  });

  it("без токена — 401", async () => {
    const res = await request(app).get(`/api/rooms/${roomSlug}/blocked`);

    expect(res.status).toBe(401);
  });
});

// ==========================================
// Вход заблокированного пользователя
// ==========================================
describe("Вход заблокированного пользователя", () => {
  it("заблокированный не может войти через slug — 403", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${toBlockToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Вы заблокированы в этой комнате");
  });

  it("заблокированный не может войти через инвайт — 403", async () => {
    // Создаём инвайт
    const invRes = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    const code = invRes.body.invite.code;

    const res = await request(app)
      .post(`/api/invite/${code}/join`)
      .set("Authorization", `Bearer ${toBlockToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Вы заблокированы в этой комнате");
  });
});

// ==========================================
// DELETE /api/rooms/:slug/block/:userId — разблокировка
// ==========================================
describe("DELETE /api/rooms/:slug/block/:userId", () => {
  it("owner разблокирует пользователя", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/block/${toBlockUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Пользователь разблокирован");
  });

  it("после разблокировки пользователь может войти", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${toBlockToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it("повторная разблокировка — 404", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/block/${toBlockUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });

  it("участник не может разблокировать — 403", async () => {
    // Сначала блокируем
    await request(app)
      .post(`/api/rooms/${roomSlug}/block`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ userId: toBlockUserId });

    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/block/${toBlockUserId}`)
      .set("Authorization", `Bearer ${participantToken}`);

    expect(res.status).toBe(403);

    // Разблокируем обратно
    await request(app)
      .delete(`/api/rooms/${roomSlug}/block/${toBlockUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
  });

  it("без токена — 401", async () => {
    const res = await request(app).delete(
      `/api/rooms/${roomSlug}/block/${toBlockUserId}`
    );

    expect(res.status).toBe(401);
  });
});

// ==========================================
// LiveKit гранты в зависимости от роли
// ==========================================
describe("LiveKit гранты по роли", () => {
  it("OWNER получает canPublishData: true", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const payload = decodeJwt(res.body.token);
    expect(payload.video.canPublishData).toBe(true);
  });

  it("MODERATOR получает canPublishData: true", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${modToken}`);

    expect(res.status).toBe(200);
    const payload = decodeJwt(res.body.token);
    expect(payload.video.canPublishData).toBe(true);
  });

  it("PARTICIPANT получает canPublishData: false", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${participantToken}`);

    expect(res.status).toBe(200);
    const payload = decodeJwt(res.body.token);
    expect(payload.video.canPublishData).toBe(false);
  });

  it("после повышения до MODERATOR следующий join даёт canPublishData: true", async () => {
    // Создаём нового участника
    const newUser = {
      email: `mod_grant_${testId}@voco.test`,
      username: `mod_grant_${testId}`,
      password: "TestPass123",
    };
    const regRes = await request(app).post("/api/auth/register").send(newUser);
    const newToken = regRes.body.token;
    const newUserId = regRes.body.user.id;

    // Входит как PARTICIPANT
    const joinRes1 = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${newToken}`);
    expect(decodeJwt(joinRes1.body.token).video.canPublishData).toBe(false);

    // Owner повышает до MODERATOR
    await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${newUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "MODERATOR" });

    // Выходит и заходит снова
    await request(app)
      .post(`/api/rooms/${roomSlug}/leave`)
      .set("Authorization", `Bearer ${newToken}`);

    const joinRes2 = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${newToken}`);
    expect(res200(joinRes2)).toBe(true);
    expect(decodeJwt(joinRes2.body.token).video.canPublishData).toBe(true);
  });

  it("OWNER и MODERATOR получают canPublish: true и canSubscribe: true", async () => {
    const ownerRes = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const modRes = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${modToken}`);

    for (const res of [ownerRes, modRes]) {
      const payload = decodeJwt(res.body.token);
      expect(payload.video.canPublish).toBe(true);
      expect(payload.video.canSubscribe).toBe(true);
    }
  });

  it("PARTICIPANT тоже получает canPublish: true и canSubscribe: true", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${participantToken}`);

    const payload = decodeJwt(res.body.token);
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(true);
  });
});

function res200(res: any): boolean {
  return res.status === 200;
}
