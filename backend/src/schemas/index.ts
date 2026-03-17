import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Некорректный email"),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Только латиница, цифры и _"),
  password: z.string().min(6, "Минимум 6 символов"),
});

export const loginSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(1, "Пароль обязателен"),
});

export const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
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
  role: z.enum(["MODERATOR", "PARTICIPANT"]),
});

// Схема для входа в комнату по slug (для авторизованных)
export const joinRoomSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
});

// НОВАЯ УНИВЕРСАЛЬНАЯ СХЕМА ДЛЯ ИНВАЙТОВ
export const joinInviteSchema = z.object({
  displayName: z.string().min(1, "Имя обязательно").max(50, "Максимум 50 символов"),
});

export const kickUserSchema = z.object({
  sessionId: z.string().min(1, "session_id обязателен"),
  reason: z.string().max(500).optional(),
});

// Типы
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type JoinInviteInput = z.infer<typeof joinInviteSchema>; // Новый тип
export type KickUserInput = z.infer<typeof kickUserSchema>;
export type BlockUserInput = z.infer<typeof blockUserSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;