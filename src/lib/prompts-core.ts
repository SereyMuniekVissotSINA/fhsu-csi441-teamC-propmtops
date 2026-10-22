// Pure prompt logic, shared by the dashboard, the `pops` CLI, the graph view
// and the database seed.
//
// This used to be `demo-prompts.ts`, back when the browser demo was the only
// surface that had prompts at all. The demo is gone, but these functions never
// depended on it: they are string and shape helpers with no browser, Prisma or
// environment access, which is exactly why a server route, a client component
// and a Node script can all import them.

/** The editable fields of a prompt — what a form collects. */
export type PromptContent = { title: string; body: string; tags: string };

/**
 * One saved revision. `createdAt` is an ISO string rather than a Date because
 * these records cross the server/client boundary, where Dates do not survive.
 */
export type PromptVersionRecord = PromptContent & {
  id: string;
  createdAt: string;
  note: string;
  author?: string;
};

/** A prompt and its history, oldest version first. */
export type PromptRecord = { id: string; versions: PromptVersionRecord[] };

/** The `{{variable}}` names in a body, in first-seen order, without duplicates. */
export function variableNames(body: string) {
  return [
    ...new Set(
      Array.from(
        body.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g),
        (match) => match[1],
      ),
    ),
  ];
}

/**
 * Fill `{{variable}}` placeholders from `values`.
 *
 * An unfilled or empty placeholder is left standing rather than replaced with
 * a blank, so a half-filled preview still shows what it is still waiting for.
 */
export function composePrompt(body: string, values: Record<string, string>) {
  return body.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (placeholder, name: string) => values[name] || placeholder,
  );
}

/**
 * Starter prompts for `prisma/seed.ts`, so a fresh database has a library with
 * real version history to look at instead of one empty workspace.
 */
export const samplePrompts: PromptRecord[] = [
  {
    id: "customer-support",
    versions: [
      {
        id: "support-v1",
        title: "Customer support assistant",
        tags: "support, customer experience",
        body: "You are a helpful support specialist for {{company}}.\n\nHelp {{customer_name}} with this question:\n{{question}}\n\nBe warm, concise, and specific. If you need more information, ask one clear follow-up question.",
        createdAt: "2026-09-01T10:00:00.000Z",
        note: "Initial version",
      },
    ],
  },
  {
    id: "code-review",
    versions: [
      {
        id: "review-v1",
        title: "Code review partner",
        tags: "engineering, review",
        body: "Review this {{language}} code:\n\n{{code}}\n\nIdentify correctness issues and suggest improvements.",
        createdAt: "2026-09-01T11:00:00.000Z",
        note: "Initial version",
      },
      {
        id: "review-v2",
        title: "Code review partner",
        tags: "engineering, review",
        body: "Act as a thoughtful senior engineer reviewing {{language}} code.\n\n{{code}}\n\nPrioritize correctness, security, and readability. For each finding, explain the impact and give a concrete fix. If there are no issues, say so.",
        createdAt: "2026-09-02T11:00:00.000Z",
        note: "Added review priorities and actionable fixes",
      },
    ],
  },
  {
    id: "meeting-notes",
    versions: [
      {
        id: "notes-v1",
        title: "Meeting notes to action items",
        tags: "productivity",
        body: "Summarize the following notes from {{team}}:\n\n{{notes}}\n\nReturn a brief summary, decisions made, and action items with owners. Mark unknown owners as unassigned.",
        createdAt: "2026-09-03T09:00:00.000Z",
        note: "Initial version",
      },
    ],
  },
];
