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

export const workspaceRoles = ["OWNER", "EDITOR", "VIEWER"] as const;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});

export const memberSchema = z.object({
  email: z.email("Enter the member's email address"),
  role: z.enum(workspaceRoles),
});

// Removing a member is a role of `null`, which the last-owner guard in
// `src/lib/authz.ts` understands.
export const updateMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(workspaceRoles).nullable(),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Give the key a name").max(60),
});

// Creating a prompt needs a workspace; editing one only appends a version.
export const createPromptSchema = promptSchema.extend({
  workspaceId: z.string().min(1, "Choose a workspace"),
});

export const updatePromptSchema = promptSchema.extend({
  note: z.string().trim().max(240).default("Updated prompt"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PromptInput = z.infer<typeof promptSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreatePromptInput = z.infer<typeof createPromptSchema>;
export type UpdatePromptInput = z.infer<typeof updatePromptSchema>;
