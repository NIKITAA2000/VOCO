import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { initDatabase } from "../lib/db.js";

const testId = Date.now().toString(36);

const OWNER = {
  email: `inv_owner_${testId}@voco.test`,
  username: `inv_owner_${testId}`,
  password: "TestPass123",
};

const MEMBER = {
  email: `inv_member_${testId}@voco.test`,
  username: `inv_member_${testId}`,
  password: "TestPass456",
};

let ownerToken = "";
let memberToken = "";
let roomSlug = "";
let inviteCode = "";

beforeAll(async () => {
  await initDatabase();

  // Регистрируем владельца
  const r1 = await request(app).post("/api/auth/register").send(OWNER);
  ownerToken = r1.body.token;

  // Регистрируем участника
  const r2 = await request(app).post("/api/auth/register").send(MEMBER);
  memberToken = r2.body.token;

  // Создаём комнату
  const r3 = await request(app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Invite Test Room" });
  roomSlug = r3.body.room.slug;
});

// ==========================================
// POST /api/rooms/:slug/invite — создание
// ==========================================
describe("POST /api/rooms/:slug/invite", () => {
  it("владелец создаёт приглашение без ограничений", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.invite.code).toBeDefined();
    expect(res.body.invite.isActive).toBe(true);
    expect(res.body.invite.allowGuests).toBe(true);
    expect(res.body.invite.maxUses).toBeNull();
    expect(res.body.invite.expiresAt).toBeNull();

    inviteCode = res.body.invite.code;
  });

  it("владелец создаёт приглашение с maxUses и expiresAt", async () => {
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ maxUses: 5, expiresAt });

    expect(res.status).toBe(201);
    expect(res.body.invite.maxUses).toBe(5);
    expect(res.body.invite.expiresAt).toBeDefined();
  });

  it("не-владелец получает 403", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it("без токена получает 401", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .send({});

    expect(res.status).toBe(401);
  });

  it("несуществующая комната — 404", async () => {
    const res = await request(app)
      .post("/api/rooms/no-such-room/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});

    expect(res.status).toBe(404);
  });

  it("невалидный maxUses отклоняется", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ maxUses: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ошибка валидации");
  });
});

// ==========================================
// GET /api/rooms/:slug/invites — список
// ==========================================
describe("GET /api/rooms/:slug/invites", () => {
  it("владелец получает список приглашений", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}/invites`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invites).toBeInstanceOf(Array);
    expect(res.body.invites.length).toBeGreaterThanOrEqual(1);

    const inv = res.body.invites.find((i: any) => i.code === inviteCode);
    expect(inv).toBeDefined();
  });

  it("не-владелец получает 403", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}/invites`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(403);
  });

  it("без токена получает 401", async () => {
    const res = await request(app).get(`/api/rooms/${roomSlug}/invites`);

    expect(res.status).toBe(401);
  });
});

// ==========================================
// POST /api/invite/:code/join — вход с auth
// ==========================================
describe("POST /api/invite/:code/join", () => {
  it("авторизованный пользователь входит по ссылке", async () => {
    const res = await request(app)
      .post(`/api/invite/${inviteCode}/join`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.livekitUrl).toBeDefined();
    expect(res.body.room.slug).toBe(roomSlug);
  });

  it("повторный вход не ломается и не дублирует участника", async () => {
    const res = await request(app)
      .post(`/api/invite/${inviteCode}/join`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it("без токена получает 401", async () => {
    const res = await request(app).post(`/api/invite/${inviteCode}/join`);

    expect(res.status).toBe(401);
  });

  it("несуществующий код — 404", async () => {
    const res = await request(app)
      .post("/api/invite/nonexistent/join")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(404);
  });
});

// ==========================================
// POST /api/invite/:code/join-guest — гостевой вход
// ==========================================
describe("POST /api/invite/:code/join-guest", () => {
  it("гость входит с displayName", async () => {
    const res = await request(app)
      .post(`/api/invite/${inviteCode}/join-guest`)
      .send({ displayName: "Гость Иванов" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.livekitUrl).toBeDefined();
    expect(res.body.guestIdentity).toMatch(/^guest_/);
    expect(res.body.room.slug).toBe(roomSlug);
  });

  it("каждый гость получает уникальный identity", async () => {
    const r1 = await request(app)
      .post(`/api/invite/${inviteCode}/join-guest`)
      .send({ displayName: "Гость 1" });

    const r2 = await request(app)
      .post(`/api/invite/${inviteCode}/join-guest`)
      .send({ displayName: "Гость 2" });

    expect(r1.body.guestIdentity).not.toBe(r2.body.guestIdentity);
  });

  it("без displayName получает 400", async () => {
    const res = await request(app)
      .post(`/api/invite/${inviteCode}/join-guest`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ошибка валидации");
  });

  it("пустой displayName получает 400", async () => {
    const res = await request(app)
      .post(`/api/invite/${inviteCode}/join-guest`)
      .send({ displayName: "" });

    expect(res.status).toBe(400);
  });

  it("несуществующий код — 404", async () => {
    const res = await request(app)
      .post("/api/invite/nonexistent/join-guest")
      .send({ displayName: "Гость" });

    expect(res.status).toBe(404);
  });
});

// ==========================================
// Лимит использований (maxUses: 1)
// ==========================================
describe("Лимит использований (maxUses: 1)", () => {
  let limitedCode = "";

  it("создаём ссылку с maxUses: 1", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ maxUses: 1 });

    expect(res.status).toBe(201);
    limitedCode = res.body.invite.code;
  });

  it("первый гость входит успешно", async () => {
    const res = await request(app)
      .post(`/api/invite/${limitedCode}/join-guest`)
      .send({ displayName: "Первый гость" });

    expect(res.status).toBe(200);
  });

  it("второй гость получает 400 — лимит исчерпан", async () => {
    const res = await request(app)
      .post(`/api/invite/${limitedCode}/join-guest`)
      .send({ displayName: "Второй гость" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Лимит");
  });

  it("авторизованный вход тоже заблокирован", async () => {
    const res = await request(app)
      .post(`/api/invite/${limitedCode}/join`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Лимит");
  });
});

// ==========================================
// Истечение срока
// ==========================================
describe("Истечение срока (expiresAt = now + 3.6s)", () => {
  let expiredCode = "";

  it(
    "создаём ссылку, которая истекает через 3.6 сек",
    async () => {
      const expiresAt = new Date(
        Date.now() + Math.round(0.001 * 3600 * 1000)
      ).toISOString();

      const res = await request(app)
        .post(`/api/rooms/${roomSlug}/invite`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ expiresAt });

      expect(res.status).toBe(201);
      expiredCode = res.body.invite.code;
    },
    10_000
  );

  it(
    "после истечения гостевой вход возвращает 400",
    async () => {
      await new Promise((r) => setTimeout(r, 5_000));

      const res = await request(app)
        .post(`/api/invite/${expiredCode}/join-guest`)
        .send({ displayName: "Поздний гость" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("истекла");
    },
    10_000
  );

  it(
    "после истечения авторизованный вход тоже возвращает 400",
    async () => {
      const res = await request(app)
        .post(`/api/invite/${expiredCode}/join`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("истекла");
    },
    10_000
  );
});

// ==========================================
// DELETE /api/rooms/:slug/invite/:code — деактивация
// ==========================================
describe("DELETE /api/rooms/:slug/invite/:code", () => {
  let deactivateCode = "";

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    deactivateCode = res.body.invite.code;
  });

  it("не-владелец не может деактивировать — 403", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/invite/${deactivateCode}`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(403);
  });

  it("без токена получает 401", async () => {
    const res = await request(app).delete(
      `/api/rooms/${roomSlug}/invite/${deactivateCode}`
    );

    expect(res.status).toBe(401);
  });

  it("владелец деактивирует ссылку", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/invite/${deactivateCode}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("деактивирована");
  });

  it("гостевой вход после деактивации — 400", async () => {
    const res = await request(app)
      .post(`/api/invite/${deactivateCode}/join-guest`)
      .send({ displayName: "Гость" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("деактивирована");
  });

  it("авторизованный вход после деактивации — 400", async () => {
    const res = await request(app)
      .post(`/api/invite/${deactivateCode}/join`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("деактивирована");
  });

  it("несуществующий код при деактивации — 404", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/invite/no-such-code`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });
});

// ==========================================
// Вход в закрытую комнату по приглашению
// ==========================================
describe("Вход в закрытую комнату по приглашению", () => {
  let closedRoomSlug = "";
  let closedRoomCode = "";

  beforeAll(async () => {
    // Создаём отдельную комнату для закрытия
    const r1 = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Room To Close" });
    closedRoomSlug = r1.body.room.slug;

    // Создаём инвайт
    const r2 = await request(app)
      .post(`/api/rooms/${closedRoomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    closedRoomCode = r2.body.invite.code;

    // Закрываем комнату
    await request(app)
      .delete(`/api/rooms/${closedRoomSlug}`)
      .set("Authorization", `Bearer ${ownerToken}`);
  });

  it("гостевой вход в закрытую комнату — 400", async () => {
    const res = await request(app)
      .post(`/api/invite/${closedRoomCode}/join-guest`)
      .send({ displayName: "Гость" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("закрыта");
  });

  it("авторизованный вход в закрытую комнату — 400", async () => {
    const res = await request(app)
      .post(`/api/invite/${closedRoomCode}/join`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("закрыта");
  });
});

// ==========================================
// Гости запрещены (allowGuests: false)
// ==========================================
describe("Гости запрещены (allowGuests: false)", () => {
  let noGuestsCode = "";

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ allowGuests: false });
    noGuestsCode = res.body.invite.code;
  });

  it("инвайт создан с allowGuests: false", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}/invites`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const inv = res.body.invites.find((i: any) => i.code === noGuestsCode);
    expect(inv).toBeDefined();
    expect(inv.allowGuests).toBe(false);
  });

  it("гостевой вход по ссылке без гостей — 403", async () => {
    const res = await request(app)
      .post(`/api/invite/${noGuestsCode}/join-guest`)
      .send({ displayName: "Запрещённый гость" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Гостевой вход");
  });

  it("авторизованный пользователь по этой ссылке всё равно может войти", async () => {
    const res = await request(app)
      .post(`/api/invite/${noGuestsCode}/join`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});
