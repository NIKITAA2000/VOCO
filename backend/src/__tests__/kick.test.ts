import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { initDatabase } from "../lib/db.js";

const testId = Date.now().toString(36);

const OWNER = {
  email: `kick_owner_${testId}@voco.test`,
  username: `kick_owner_${testId}`,
  password: "TestPass123",
};
const MOD = {
  email: `kick_mod_${testId}@voco.test`,
  username: `kick_mod_${testId}`,
  password: "TestPass123",
};
const PARTICIPANT = {
  email: `kick_part_${testId}@voco.test`,
  username: `kick_part_${testId}`,
  password: "TestPass123",
};
const TARGET = {
  email: `kick_target_${testId}@voco.test`,
  username: `kick_tgt_${testId}`,
  password: "TestPass123",
};

let ownerToken = "";
let modToken = "";
let participantToken = "";
let targetToken = "";

let modUserId = "";
let participantUserId = "";

let ownerSessionId = "";
let modSessionId = "";
let participantSessionId = "";
let targetSessionId = "";

let roomSlug = "";

beforeAll(async () => {
  await initDatabase();

  const r1 = await request(app).post("/api/auth/register").send(OWNER);
  ownerToken = r1.body.token;

  const r2 = await request(app).post("/api/auth/register").send(MOD);
  modToken = r2.body.token;
  modUserId = r2.body.user.id;

  const r3 = await request(app).post("/api/auth/register").send(PARTICIPANT);
  participantToken = r3.body.token;
  participantUserId = r3.body.user.id;

  const r4 = await request(app).post("/api/auth/register").send(TARGET);
  targetToken = r4.body.token;

  // Создаём комнату — владелец сразу внутри
  const r5 = await request(app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Kick Test Room" });
  roomSlug = r5.body.room.slug;
  ownerSessionId = r5.body.room.mySessionId;

  // Все остальные заходят
  const j1 = await request(app)
    .post(`/api/rooms/${roomSlug}/join`)
    .set("Authorization", `Bearer ${modToken}`);
  modSessionId = j1.body.sessionId;

  const j2 = await request(app)
    .post(`/api/rooms/${roomSlug}/join`)
    .set("Authorization", `Bearer ${participantToken}`);
  participantSessionId = j2.body.sessionId;

  const j3 = await request(app)
    .post(`/api/rooms/${roomSlug}/join`)
    .set("Authorization", `Bearer ${targetToken}`);
  targetSessionId = j3.body.sessionId;

  // Повышаем MOD до MODERATOR
  await request(app)
    .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ role: "MODERATOR" });
});

// ==========================================
// POST /api/rooms/:slug/kick
// ==========================================
describe("POST /api/rooms/:slug/kick", () => {
  it("OWNER кикает участника", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ sessionId: targetSessionId });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Участник исключён из комнаты");
  });

  it("кикнутый участник больше не в комнате", async () => {
    // Пробуем войти заново — TARGET должен успешно войти (кик ≠ бан)
    const rejoin = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${targetToken}`);
    expect(rejoin.status).toBe(200);
    targetSessionId = rejoin.body.sessionId; // обновляем sessionId после повторного входа
  });

  it("MODERATOR кикает участника", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ sessionId: targetSessionId, reason: "Нарушение правил" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Участник исключён из комнаты");

    // Возвращаем TARGET обратно для следующих тестов
    const rejoin = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${targetToken}`);
    targetSessionId = rejoin.body.sessionId;
  });

  it("MODERATOR не может кикнуть OWNER — 403", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ sessionId: ownerSessionId });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Модераторы не могут кикать");
  });

  it("MODERATOR не может кикнуть другого MODERATOR — 403", async () => {
    // Повышаем PARTICIPANT до MODERATOR
    await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${participantUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "MODERATOR" });

    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ sessionId: participantSessionId });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Модераторы не могут кикать");

    // Возвращаем обратно
    await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${participantUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "PARTICIPANT" });
  });

  it("PARTICIPANT не может кикать — 403", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${participantToken}`)
      .send({ sessionId: targetSessionId });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("прав");
  });

  it("без токена — 401", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .send({ sessionId: targetSessionId });

    expect(res.status).toBe(401);
  });

  it("нельзя кикнуть себя — 400", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ sessionId: ownerSessionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("себя");
  });

  it("несуществующий sessionId — 404", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ sessionId: "nonexistent-session-id" });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Участник не найден");
  });

  it("несуществующая комната — 404", async () => {
    const res = await request(app)
      .post("/api/rooms/no-such-room/kick")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ sessionId: targetSessionId });

    expect(res.status).toBe(404);
  });

  it("отсутствие sessionId — 400 (ошибка валидации)", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/kick`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ошибка валидации");
  });
});

// ==========================================
// POST /api/rooms/:slug/moderators/:userId/demote
// ==========================================
describe("POST /api/rooms/:slug/moderators/:userId/demote", () => {
  it("OWNER снимает MODERATOR", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/${modUserId}/demote`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Модератор снят");
  });

  it("после demote роль стала PARTICIPANT", async () => {
    // Переходим и обратно, чтобы получить актуальный токен с ролью
    const joinRes = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${modToken}`);

    expect(joinRes.status).toBe(200);
    expect(joinRes.body.role).toBe("PARTICIPANT");
  });

  it("повторный demote уже не-модератора — 400", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/${modUserId}/demote`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("не является модератором");
  });

  it("MODERATOR не может снимать — 403", async () => {
    // Сначала повышаем MOD обратно для этого теста
    await request(app)
      .patch(`/api/rooms/${roomSlug}/participants/${modUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "MODERATOR" });

    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/${participantUserId}/demote`)
      .set("Authorization", `Bearer ${modToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("владелец");
  });

  it("PARTICIPANT не может снимать — 403", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/${modUserId}/demote`)
      .set("Authorization", `Bearer ${participantToken}`);

    expect(res.status).toBe(403);
  });

  it("без токена — 401", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/${modUserId}/demote`);

    expect(res.status).toBe(401);
  });

  it("нельзя снять себя — 400", async () => {
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${ownerToken}`);
    const ownerId = meRes.body.user.id;

    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/${ownerId}/demote`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("себя");
  });

  it("несуществующий пользователь — 400", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/00000000-0000-0000-0000-000000000000/demote`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("не является модератором");
  });

  it("после demote следующий join не восстанавливает роль MODERATOR", async () => {
    // MOD сейчас MODERATOR (повышен в предыдущем тесте)
    // Снимаем его
    await request(app)
      .post(`/api/rooms/${roomSlug}/moderators/${modUserId}/demote`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // Выходит и заходит снова
    await request(app)
      .post(`/api/rooms/${roomSlug}/leave`)
      .set("Authorization", `Bearer ${modToken}`);

    const joinRes = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${modToken}`);

    expect(joinRes.status).toBe(200);
    expect(joinRes.body.role).toBe("PARTICIPANT");

    function decodeJwt(token: string): Record<string, any> {
      return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    }
    const payload = decodeJwt(joinRes.body.token);
    expect(payload.video.canPublishData).toBe(false);
  });
});
