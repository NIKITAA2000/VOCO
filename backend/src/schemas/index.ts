import { z } from "zod";

export const profileAvatarOptions = [
  "._.",
  ":)",
  ":(",
  "=)",
  "=(",
  ";)",
  ":D",
  "XD",
  ":P",
  ":O",
  ":/",
  ":|",
  "^_^",
  "-_-",
  "o_O",
  "o_o",
  "O_O",
  "x_x",
  ">_<",
  ":3",
  "<3",
] as const;

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
  allowGuests: z.boolean().optional().default(true),
  requireApproval: z.boolean().optional().default(false),
});

export const updateRoomSchema = z
  .object({
    name: z
      .string()
      .min(1, "Название комнаты обязательно")
      .max(100, "Название — максимум 100 символов")
      .optional(),
    maxUsers: z.number().int().min(2).max(50).optional(),
    allowGuests: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.maxUsers !== undefined ||
      data.allowGuests !== undefined ||
      data.requireApproval !== undefined,
    { message: "Нужно указать хотя бы одно поле" },
  );

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

const attachmentSchema = z.object({
  url: z.string().min(1).max(500),
  name: z.string().min(1).max(255),
  kind: z.enum(["image", "video", "document"]),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1).max(160),
});

// Группа вложений: либо media (image+video), либо files (document). До 10 в сообщении.
// Смешивать группы в одном сообщении нельзя.
const attachmentsSchema = z
  .array(attachmentSchema)
  .min(1)
  .max(10, "В сообщении до 10 вложений")
  .refine(
    (arr) => {
      const hasMedia = arr.some((a) => a.kind === "image" || a.kind === "video");
      const hasDoc = arr.some((a) => a.kind === "document");
      return !(hasMedia && hasDoc);
    },
    { message: "Нельзя смешивать фото/видео и документы в одном сообщении" },
  );

export const saveChatMessageSchema = z
  .object({
    externalId: z.string().min(1).max(120),
    message: z.string().max(2000, "Сообщение — максимум 2000 символов").optional().default(""),
    authorIdentity: z.string().min(1).max(120),
    authorName: z.string().max(120).optional(),
    sentAt: z.number().int(),
    isGuest: z.boolean().optional().default(false),
    attachment: attachmentSchema.optional(),
    attachments: attachmentsSchema.optional(),
  })
  .refine(
    (data) =>
      data.message.trim().length > 0 ||
      data.attachment ||
      (data.attachments && data.attachments.length > 0),
    {
      message: "Сообщение или вложение обязательно",
    },
  );

export const pinMessageSchema = z
  .object({
    message: z.string().max(2000, "Сообщение — максимум 2000 символов").optional().default(""),
    authorIdentity: z.string().max(120).optional(),
    authorName: z.string().max(120).optional(),
    originalExternalId: z.string().max(120).optional(),
    originalTimestamp: z.number().int().optional(),
    attachment: attachmentSchema.optional(),
    attachments: attachmentsSchema.optional(),
  })
  .refine(
    (d) =>
      d.message.trim().length > 0 ||
      d.attachment ||
      (d.attachments && d.attachments.length > 0),
    {
      message: "Нужно сообщение или вложение",
    },
  );

export const joinGuestSchema = z.object({
  displayName: z
    .string()
    .min(1, "Имя обязательно")
    .max(50, "Имя — максимум 50 символов"),
});

export const updateProfileSchema = z
  .object({
    username: z
      .string()
      .min(3, "Имя пользователя — минимум 3 символа")
      .max(30, "Имя пользователя — максимум 30 символов")
      .regex(
        /^[a-zA-Zа-яА-ЯёЁ0-9_ ]+$/,
        "Только буквы, цифры, пробел и подчёркивание"
      )
      .optional(),
    email: z.string().email("Некорректный email").optional(),
    password: z.string().min(6, "Пароль — минимум 6 символов").optional(),
    avatarUrl: z.enum(profileAvatarOptions).nullable().optional(),
  })
  .refine(
    (data) =>
      data.username !== undefined ||
      data.email !== undefined ||
      data.password !== undefined ||
      data.avatarUrl !== undefined,
    { message: "Нужно указать хотя бы одно поле" }
  );

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type JoinGuestInput = z.infer<typeof joinGuestSchema>;
