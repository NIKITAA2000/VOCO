import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { generateToken, authenticate } from "../middleware/auth.js";
import { registerSchema, loginSchema } from "../schemas/index.js";

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
    if (db.findUserByEmail(email)) {
      res.status(409).json({ error: "Пользователь с таким email уже существует" });
      return;
    }
    if (db.findUserByUsername(username)) {
      res.status(409).json({ error: "Пользователь с таким username уже существует" });
      return;
    }

    // Hash password & create user
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = db.createUser({ email, username, password: hashedPassword });

    // Generate JWT
    const token = generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    res.status(201).json({
      message: "Регистрация успешна",
      user: { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt },
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
    const user = db.findUserByEmail(email);

    if (!user) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }

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
      user: { id: user.id, email: user.email, username: user.username },
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
    const user = db.findUserById(req.user!.userId);

    if (!user) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

export default router;