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

export const createInviteSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
  allowGuests: z.boolean().optional().default(true),
});

export const blockUserSchema = z.object({
  userId: z.string().uuid("Некорректный ID пользователя"),
  reason: z.string().max(500).optional(),
});

export const changeRoleSchema = z.object({
  role: z.enum(["MODERATOR", "PARTICIPANT"], {
    errorMap: () => ({ message: "Роль должна быть MODERATOR или PARTICIPANT" }),
  }),
});

export const joinGuestSchema = z.object({
  displayName: z
    .string()
    .min(1, "Имя обязательно")
    .max(50, "Имя — максимум 50 символов"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type JoinGuestInput = z.infer<typeof joinGuestSchema>;