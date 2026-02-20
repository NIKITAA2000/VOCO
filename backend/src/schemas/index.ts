import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Некорректный email"),
  username: z
    .string()
    .min(3, "Имя пользователя — минимум 3 символа")
    .max(30, "Имя пользователя — максимум 30 символов")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Только латинские буквы, цифры и подчёркивание"
    ),
  password: z.string().min(6, "Пароль — минимум 6 символов"),
});

export const loginSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(1, "Пароль обязателен"),
});

export const createRoomSchema = z.object({
  name: z
    .string()
    .min(1, "Название комнаты обязательно")
    .max(100, "Название — максимум 100 символов"),
  maxUsers: z.number().int().min(2).max(50).optional().default(10),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;