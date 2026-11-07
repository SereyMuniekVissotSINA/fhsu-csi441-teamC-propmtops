import type { AgentChange } from "@/lib/agent-runs";

// The shapes the app's API answers with.
//
// They live here rather than beside the commands that read them because two
// callers now share them: the one-shot commands in `index.ts` and the
// interactive shell. A second copy of `Workspace` is a second thing to forget
// when a route grows a field, and the shell exists precisely to show those
// fields.
//
// Only what the CLI actually reads is declared. These are not generated from
// Prisma on purpose: the CLI sees what a route chose to return, which is
// narrower than the model, and pretending otherwise would invent fields.

export type WhoAmI = {
  authenticatedAs: string;
  user: { name: string | null; email: string } | null;
  key?: { name: string; prefix: string; lastUsedAt: string | null } | null;
  workspaces: { role: string; workspace: { id: string; name: string; slug: string } }[];
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  _count: { prompts: number };
  members: { role: string; user: { name: string | null; email: string } }[];
};

export type PromptSummary = {
  id: string;
  title: string;
  updatedAt: string;
  workspace: { name: string; slug: string };
  versions: { body: string; tags: string }[];
  _count: { versions: number };
};

export type PromptDetail = {
  id: string;
  title: string;
  workspace: { name: string; slug: string };
  versions: {
    id: string;
    title: string;
    body: string;
    tags: string;
    note: string;
    createdAt: string;
    author: { name: string | null } | null;
  }[];
};

export type CommitFile = {
  path: string;
  hash: string;
  language: string;
  change: string;
  added: number;
  removed: number;
  content?: string;
};

export type Commit = {
  id: string;
  sequence: number;
  message: string;
  parentId: string | null;
  model: string;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  incomplete: boolean;
  createdAt: string;
  authorName: string | null;
  stats: { files: number; added: number; removed: number; changed: number };
  files: CommitFile[];
  input?: string;
  output?: string;
};

export type RunFileSummary = {
  path: string;
  language: string;
  change: AgentChange;
  added: number;
  removed: number;
};

export type RunSummary = {
  id: string;
  sequence: number;
  workspace?: { id: string; name: string; slug: string };
  snapshotId: string | null;
  category: string;
  categorySlug: string;
  agent: string;
  root: string;
  prompt: string;
  summary: string;
  stats: { files: number; added: number; removed: number };
  authorName: string | null;
  restoreRequestedAt: string | null;
  restoredAt: string | null;
  createdAt: string;
  files: RunFileSummary[];
};

export type RunDetail = RunSummary & {
  response: string;
  files: (RunFileSummary & { before: string; after: string })[];
};

/** A branch as the server holds it. */
export type ServerSnapshot = {
  id: string;
  name: string;
  slug: string;
  runs: number;
  baselinedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type KeyRecord = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
