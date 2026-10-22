import { z } from "zod";

export const DEMO_STORAGE_KEY = "promptops.demo.v1";

export const demoContentSchema = z.object({
  title: z.string().trim().min(1, "Give your prompt a title.").max(120),
  body: z.string().trim().min(1, "Write some prompt content.").max(20000),
  tags: z.string().trim().max(200),
});

const versionSchema = demoContentSchema.extend({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  note: z.string().max(240),
  author: z.string().min(1).max(160).optional(),
});

export const demoPromptSchema = z.object({
  id: z.string().min(1),
  versions: z.array(versionSchema).min(1),
});

export const demoStoreSchema = z.object({
  schemaVersion: z.literal(1),
  prompts: z.array(demoPromptSchema),
});

export type DemoContent = z.infer<typeof demoContentSchema>;
export type DemoVersion = z.infer<typeof versionSchema>;
export type DemoPrompt = z.infer<typeof demoPromptSchema>;

export function appendVersion(
  prompt: DemoPrompt,
  content: DemoContent,
  note = "Updated prompt",
  author?: string,
): DemoPrompt {
  return {
    ...prompt,
    versions: [
      ...prompt.versions,
      {
        ...demoContentSchema.parse(content),
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        note,
        ...(author ? { author } : {}),
      },
    ],
  };
}

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

export function composePrompt(body: string, values: Record<string, string>) {
  return body.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (placeholder, name: string) => values[name] || placeholder,
  );
}

export const demoSamples: DemoPrompt[] = [
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
