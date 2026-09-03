import { z } from "zod";

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const registerSchema = loginSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

export const promptSchema = z.object({
  title: z.string().min(1, "Title is required").max(120),
  body: z.string().min(1, "Body is required"),
  tags: z.string().default(""),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PromptInput = z.infer<typeof promptSchema>;
