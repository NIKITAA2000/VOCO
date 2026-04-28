import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { generateToken } from "../middleware/auth.js";
import { registerSchema, loginSchema, updateProfileSchema } from "../schemas/index.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, username, password } = parsed.data;

    // Check if user exists
    const existing = await db.query(
      "SELECT id, email, username FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existing.rows.length > 0) {
      const field = existing.rows[0].email === email ? "email" : "username";
      res.status(409).json({
        error: `Пользователь с таким ${field} уже существует`,
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (email, username, password)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, avatar_url AS "avatarUrl", created_at AS "createdAt"`,
      [email, username, hashedPassword]
    );

    const user = result.rows[0];

    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.status(201).json({
      message: "Регистрация успешна",
      user,
      token,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = parsed.data;

    const result = await db.query(
      `SELECT id, email, username, password, avatar_url AS "avatarUrl"
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }

    const user = result.rows[0];

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.json({
      message: "Вход выполнен",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// GET /api/auth/me
router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT id, email, username, avatar_url AS "avatarUrl", created_at AS "createdAt"
       FROM users WHERE id = $1`,
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// PATCH /api/auth/me
router.patch("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { username, email, password, avatarUrl } = parsed.data;
    const userId = req.user!.userId;

    if (username !== undefined || email !== undefined) {
      const conflict = await db.query(
        `SELECT id, email, username FROM users
         WHERE id <> $1 AND (
           ($2::text IS NOT NULL AND email = $2) OR
           ($3::text IS NOT NULL AND username = $3)
         )`,
        [userId, email ?? null, username ?? null]
      );
      if (conflict.rows.length > 0) {
        const field = conflict.rows[0].email === email ? "email" : "username";
        res.status(409).json({
          error: `Пользователь с таким ${field} уже существует`,
        });
        return;
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (username !== undefined) {
      updates.push(`username = $${idx++}`);
      values.push(username);
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email);
    }
    if (password !== undefined) {
      const hashedPassword = await bcrypt.hash(password, 12);
      updates.push(`password = $${idx++}`);
      values.push(hashedPassword);
    }
    if (avatarUrl !== undefined) {
      updates.push(`avatar_url = $${idx++}`);
      values.push(avatarUrl);
    }

    values.push(userId);

    const result = await db.query(
      `UPDATE users SET ${updates.join(", ")}
       WHERE id = $${idx}
       RETURNING id, email, username, avatar_url AS "avatarUrl", created_at AS "createdAt"`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    const user = result.rows[0];
    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.json({ user, token });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;
