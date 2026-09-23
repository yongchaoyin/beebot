import { z } from "zod";
import { BOT_AVATAR_COLORS, BOT_AVATAR_SHAPES } from "../shared/agents/bot-avatar.js";

export const botSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(8000),
  avatarColor: z.enum(BOT_AVATAR_COLORS).optional(),
  avatarShape: z.enum(BOT_AVATAR_SHAPES).optional(),
}).strict();
