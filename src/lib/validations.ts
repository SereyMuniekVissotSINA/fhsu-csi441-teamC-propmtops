import { z } from "zod";

import {
  MAX_CATEGORY_CHARS,
  MAX_RUN_FILES,
  MAX_RUN_FILE_CHARS,
  MAX_RUN_TEXT_CHARS,
  MAX_TOOL_EVENTS_CHARS,
} from "@/lib/agent-runs";

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

// A code-generation run: the composed prompt to send, plus an optional commit
// message for the code it produces. The input cap matches the run routes.
export const generateCodeSchema = z.object({
  input: z.string().trim().min(1, "Nothing to send").max(16000),
  message: z.string().trim().max(240).default(""),
  promptVersionId: z.string().min(1).optional(),
});

// A `pops push`: one agent run, with both sides of every file it touched.
//
// `before`/`after` are nullable because that is what tells an added file from
// an empty one — null means the file was not on disk at that point. The caps
// come from `agent-runs.ts` so the CLI, the route and this schema agree on one
// set of limits; the server still classifies and re-normalizes what arrives,
// so nothing here is trusted as a verdict about what changed.
export const runFileSchema = z.object({
  path: z.string().min(1).max(200),
  before: z.string().max(MAX_RUN_FILE_CHARS).nullable(),
  after: z.string().max(MAX_RUN_FILE_CHARS).nullable(),
});

export const createRunSchema = z.object({
  workspaceId: z.string().min(1, "Choose a workspace"),
  // Blank is allowed and means uncategorised: a run pushed without a snapshot
  // name is still a run worth keeping.
  category: z.string().trim().max(MAX_CATEGORY_CHARS).default(""),
  baselineAt: z.iso.datetime().nullable().default(null),
  agent: z.string().trim().max(120).default(""),
  root: z.string().trim().max(400).default(""),
  prompt: z.string().max(MAX_RUN_TEXT_CHARS).default(""),
  response: z.string().max(MAX_RUN_TEXT_CHARS).default(""),
  toolEvents: z.string().max(MAX_TOOL_EVENTS_CHARS).default("[]"),
  files: z.array(runFileSchema).min(1, "Nothing changed, so there is no run to push").max(MAX_RUN_FILES),
});

// The three moves in the restore handshake: the website asks, the website
// withdraws, or the CLI reports that it has applied one.
export const restoreRunSchema = z.object({
  action: z.enum(["request", "cancel", "applied"]),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PromptInput = z.infer<typeof promptSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreatePromptInput = z.infer<typeof createPromptSchema>;
export type UpdatePromptInput = z.infer<typeof updatePromptSchema>;
export type GenerateCodeInput = z.infer<typeof generateCodeSchema>;
export type CreateRunInput = z.infer<typeof createRunSchema>;
export type RestoreRunInput = z.infer<typeof restoreRunSchema>;
