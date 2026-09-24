import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import path from "node:path";
import fs from "node:fs";
import app from "../app.js";
import { initDatabase } from "../lib/db.js";

const testId = Date.now().toString(36);
const OWNER = {
  email: `sounds_owner_${testId}@voco.test`,
  username: `sndowner_${testId}`,
  password: "SoundsPass1",
};
const STRANGER = {
  email: `sounds_stranger_${testId}@voco.test`,
  username: `sndstranger_${testId}`,
  password: "SoundsPass2",
};

let ownerToken = "";
let strangerToken = "";
let roomSlug = "";

// Тестовое аудио — заголовок MP3 (ID3v2) + минимальный data-фрейм. Чтобы multer
// принял MIME `audio/mpeg`, файл расширения важнее содержимого для нашего
// fileFilter (он смотрит на mimetype), но supertest определяет mime по
// расширению .mp3.
const FIXTURE_MP3 = Buffer.from([
  0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const FIXTURE_PNG = Buffer.from([
  // 1x1 PNG — самый короткий валидный PNG для теста
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02,
  0xfe, 0xa3, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

beforeAll(async () => {
  await initDatabase();

  const reg1 = await request(app).post("/api/auth/register").send(OWNER);
  ownerToken = reg1.body.token;
  const reg2 = await request(app).post("/api/auth/register").send(STRANGER);
  strangerToken = reg2.body.token;

  const roomRes = await request(app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Звуковая" });
  roomSlug = roomRes.body.room.slug;
});

describe("Playlist CRUD", () => {
  let createdTrackId = "";

  it("owner может загрузить трек с иконкой", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/playlist`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("title", "Wave")
      .field("author", "Tester")
      .attach("audio", FIXTURE_MP3, { filename: "wave.mp3", contentType: "audio/mpeg" })
      .attach("icon", FIXTURE_PNG, { filename: "icon.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.track.title).toBe("Wave");
    expect(res.body.track.author).toBe("Tester");
    expect(res.body.track.audioUrl).toMatch(/^\/uploads\/audio\//);
    expect(res.body.track.iconUrl).toMatch(/^\/uploads\/audio\//);
    expect(res.body.track.position).toBe(0);
    createdTrackId = res.body.track.id;
  });

  it("трек без author тоже принимается", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/playlist`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("title", "Lo-fi")
      .attach("audio", FIXTURE_MP3, { filename: "lofi.mp3", contentType: "audio/mpeg" });

    expect(res.status).toBe(201);
    expect(res.body.track.author).toBeNull();
    expect(res.body.track.position).toBe(1);
  });

  it("отказывает чужому пользователю (403)", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/playlist`)
      .set("Authorization", `Bearer ${strangerToken}`)
      .field("title", "Стороннее")
      .attach("audio", FIXTURE_MP3, { filename: "x.mp3", contentType: "audio/mpeg" });

    expect(res.status).toBe(403);
  });

  it("отказывает на не-аудио MIME", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomSlug}/playlist`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("title", "Bad")
      .attach("audio", FIXTURE_PNG, { filename: "fake.png", contentType: "image/png" });

    expect(res.status).toBe(400);
  });

  it("PATCH переименовывает трек", async () => {
    const res = await request(app)
      .patch(`/api/rooms/${roomSlug}/playlist/${createdTrackId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Wave (rev)" });

    expect(res.status).toBe(200);
    expect(res.body.track.title).toBe("Wave (rev)");
  });

  it("GET /rooms/:slug возвращает плейлист и пустые sounds", async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.room.playlist)).toBe(true);
    expect(res.body.room.playlist.length).toBe(2);
    expect(res.body.room.sounds).toEqual({ fun: null, hand: null, join: null });
    expect(res.body.room.playlist[0].title).toBe("Wave (rev)");
  });

  it("reorder меняет порядок треков", async () => {
    const getRes = await request(app)
      .get(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const ids = getRes.body.room.playlist.map((t: any) => t.id);

    const res = await request(app)
      .put(`/api/rooms/${roomSlug}/playlist/reorder`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ orderedIds: [ids[1], ids[0]] });

    expect(res.status).toBe(200);
    const after = await request(app)
      .get(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(after.body.room.playlist.map((t: any) => t.id)).toEqual([ids[1], ids[0]]);
  });

  it("DELETE сносит трек", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/playlist/${createdTrackId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const after = await request(app)
      .get(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(after.body.room.playlist.length).toBe(1);
  });

  it("11-й трек упирается в лимит — 409", async () => {
    // Заполняем до лимита (1 уже есть). Закидываем 9 → итого 10.
    for (let i = 0; i < 9; i++) {
      const res = await request(app)
        .post(`/api/rooms/${roomSlug}/playlist`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .field("title", `T${i}`)
        .attach("audio", FIXTURE_MP3, {
          filename: `t${i}.mp3`,
          contentType: "audio/mpeg",
        });
      expect(res.status).toBe(201);
    }

    const overflow = await request(app)
      .post(`/api/rooms/${roomSlug}/playlist`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("title", "Overflow")
      .attach("audio", FIXTURE_MP3, {
        filename: "overflow.mp3",
        contentType: "audio/mpeg",
      });

    expect(overflow.status).toBe(409);
  });
});

describe("Room sounds (fun / hand / join)", () => {
  it("PUT /sounds/fun устанавливает url", async () => {
    const res = await request(app)
      .put(`/api/rooms/${roomSlug}/sounds/fun`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("audio", FIXTURE_MP3, { filename: "fun.mp3", contentType: "audio/mpeg" });

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/audio\//);

    const room = await request(app)
      .get(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(room.body.room.sounds.fun).toBe(res.body.url);
  });

  it("DELETE /sounds/fun сбрасывает в null", async () => {
    const res = await request(app)
      .delete(`/api/rooms/${roomSlug}/sounds/fun`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBeNull();

    const room = await request(app)
      .get(`/api/rooms/${roomSlug}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(room.body.room.sounds.fun).toBeNull();
  });

  it("PUT отказывает не-владельцу", async () => {
    const res = await request(app)
      .put(`/api/rooms/${roomSlug}/sounds/hand`)
      .set("Authorization", `Bearer ${strangerToken}`)
      .attach("audio", FIXTURE_MP3, { filename: "h.mp3", contentType: "audio/mpeg" });

    expect(res.status).toBe(403);
  });

  it("неизвестный тип → 400", async () => {
    const res = await request(app)
      .put(`/api/rooms/${roomSlug}/sounds/unknown`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("audio", FIXTURE_MP3, { filename: "x.mp3", contentType: "audio/mpeg" });

    expect(res.status).toBe(400);
  });
});

describe("Удаление комнаты сносит аудио-файлы", () => {
  it("DELETE закрытой комнаты физически удаляет файлы плейлиста", async () => {
    // Cоздаём отдельную комнату, заливаем 1 трек, закрываем и удаляем.
    const room = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Для удаления" });
    const slug = room.body.room.slug;

    const trackRes = await request(app)
      .post(`/api/rooms/${slug}/playlist`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("title", "ByeBye")
      .attach("audio", FIXTURE_MP3, { filename: "bye.mp3", contentType: "audio/mpeg" });

    expect(trackRes.status).toBe(201);
    const audioUrl: string = trackRes.body.track.audioUrl;
    const filename = path.basename(audioUrl);
    const fullPath = path.resolve(process.cwd(), "uploads", "audio", filename);
    expect(fs.existsSync(fullPath)).toBe(true);

    // Закрытие (комната активна → сначала становится неактивной)
    await request(app)
      .delete(`/api/rooms/${slug}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    // Удаление навсегда
    await request(app)
      .delete(`/api/rooms/${slug}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(fs.existsSync(fullPath)).toBe(false);
  });
});
