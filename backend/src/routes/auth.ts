import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { generateToken } from "../middleware/auth.js";
import { registerSchema, loginSchema } from "../schemas/index.js";
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
       RETURNING id, email, username, created_at AS "createdAt"`,
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
      "SELECT id, email, username, password FROM users WHERE email = $1",
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

export default router;