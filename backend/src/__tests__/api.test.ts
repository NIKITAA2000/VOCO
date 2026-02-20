import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { initDatabase, db } from "../lib/db.js";

// Unique test data to avoid conflicts with existing users
const testId = Date.now().toString(36);
const TEST_USER = {
  email: `test_${testId}@voco.test`,
  username: `testuser_${testId}`,
  password: "TestPass123",
};

const TEST_USER_2 = {
  email: `test2_${testId}@voco.test`,
  username: `testuser2_${testId}`,
  password: "TestPass456",
};

let authToken = "";
let authToken2 = "";
let roomSlug = "";

beforeAll(async () => {
  await initDatabase();
});

// ==========================================
// Health Check
// ==========================================
describe("GET /api/health", () => {
  it("возвращает статус ok", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
  });
});

// ==========================================
// Auth: Registration
// ==========================================
describe("POST /api/auth/register", () => {
  it("успешная регистрация нового пользователя", async () => {
    const res = await request(app).post("/api/auth/register").send(TEST_USER);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Регистрация успешна");
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.user.username).toBe(TEST_USER.username);
    expect(res.body.user).not.toHaveProperty("password");

    authToken = res.body.token;
  });

  it("регистрация второго пользователя", async () => {
    const res = await request(app).post("/api/auth/register").send(TEST_USER_2);

    expect(res.status).toBe(201);
    authToken2 = res.body.token;
  });

  it("отклоняет дублирующий email", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: TEST_USER.email,
      username: "unique_name_999",
      password: "SomePass123",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("email");
  });

  it("отклоняет дублирующий username", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "unique_email_999@voco.test",
      username: TEST_USER.username,
      password: "SomePass123",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("username");
  });

  it("отклоняет невалидный email", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      username: "validname",
      password: "ValidPass123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ошибка валидации");
  });

  it("отклоняет короткий пароль", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "short_pass@voco.test",
      username: "shortpass",
      password: "12345",
    });

    expect(res.status).toBe(400);
  });

  it("отклоняет кириллический username", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "cyrillic@voco.test",
      username: "Никита",
      password: "ValidPass123",
    });

    expect(res.status).toBe(400);
  });
});

// ==========================================
// Auth: Login
// ==========================================
describe("POST /api/auth/login", () => {
  it("успешный вход", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Вход выполнен");
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(TEST_USER.email);
  });

  it("отклоняет неверный пароль", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: TEST_USER.email,
      password: "WrongPassword",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Неверный");
  });

  it("отклоняет несуществующий email", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "nobody@voco.test",
      password: "SomePass123",
    });

    expect(res.status).toBe(401);
  });
});

// ==========================================
// Auth: Profile
// ==========================================
describe("GET /api/auth/me", () => {
  it("возвращает профиль авторизованного пользователя", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.user.username).toBe(TEST_USER.username);
    expect(res.body.user).not.toHaveProperty("password");
  });

  it("отклоняет запрос без токена", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
  });

  it("отклоняет невалидный токен", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer invalid_token_123");

    expect(res.status).toBe(401);
  });
});

// ==========================================
// Rooms: Create
// ==========================================
describe("POST /api/rooms", () => {
  it("создаёт комнату", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Тестовая комната" });

    expect(res.status).toBe(201);
    expect(res.body.room.name).toBe("Тестовая комната");
    expect(res.body.room.slug).toBeDefined();
    expect(res.body.room.isActive).toBe(true);

    roomSlug = res.body.room.slug;
  });

  it("отклоняет создание без токена", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .send({ name: "Без токена" });

    expect(res.status).toBe(401);
  });

  it("отклоняет пустое название", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "" });

    expect(res.status).toBe(400);
  });
});

// ==========================================
// Rooms: List
// ==========================================
describe("GET /api/rooms", () => {
  it("возвращает список комнат пользователя", async () => {
    const res = await request(app)
      .get("/api/rooms")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rooms).toBeInstanceOf(Array);
    expect(res.body.rooms.length).toBeGreaterThanOrEqual(1);

    const room = res.body.rooms.find((r: any) => r.slug === roomSlug);
    expect(room).toBeDefined();
    expect(room.name).toBe("Тестовая комната");
  });
});

// ==========================================
// Rooms: Get by slug
// ==========================================
describe("GET /api/rooms/:slug", () => {
  it("возвращает информацию о комнате", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.room.slug).toBe(roomSlug);
    expect(res.body.room.owner).toBeDefined();
    expect(res.body.room.participants).toBeInstanceOf(Array);
  });

  it("возвращает 404 для несуществующей комнаты", async () => {
    const res = await request(app)
      .get("/api/rooms/nonexistent")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});

// ==========================================
// Rooms: Join
// ==========================================
describe("POST /api/rooms/:slug/join", () => {
  it("присоединяется к комнате и получает LiveKit токен", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${authToken2}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.livekitUrl).toBeDefined();
    expect(res.body.room.slug).toBe(roomSlug);
  });

  it("повторный вход не создаёт дубликат", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${authToken2}`);

    expect(res.status).toBe(200);
  });

  it("отклоняет вход в несуществующую комнату", async () => {
    const res = await request(app)
      .post("/api/rooms/nonexistent/join")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});

// ==========================================
// Rooms: Leave
// ==========================================
describe("POST /api/rooms/:slug/leave", () => {
  it("покидает комнату", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/leave`)
      .set("Authorization", `Bearer ${authToken2}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("покинули");
  });
});

// ==========================================
// Rooms: Delete (close)
// ==========================================
describe("DELETE /api/rooms/:slug", () => {
  it("не позволяет не-владельцу закрыть комнату", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${authToken2}`);

    expect(res.status).toBe(403);
  });

  it("владелец закрывает комнату", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("закрыта");
  });

  it("нельзя войти в закрытую комнату", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/join`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("закрыта");
  });
});