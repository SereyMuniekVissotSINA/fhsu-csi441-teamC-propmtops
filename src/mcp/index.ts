#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { composePrompt, variableNames } from "@/lib/prompts-core";

import { CliError, createClient, type Client } from "../cli/client";
import { matchPrompt } from "../cli/resolve";

// The `prompt-ops` MCP server — the prompt library, exposed to an editor agent.
//
// `.vscode/mcp.json` has pointed at this file since before it existed; the
// decisions it fixed are honoured here: stdio transport, credentials from
// `POPS_URL` and `POPS_API_KEY`, never from `.env`.
//
// It is a client of the running web app, not a second way into the database.
// Everything goes out over the same HTTP API the dashboard and the CLI use, so
// workspace scoping, the append-only rules and authorship all stay on the
// server where they are enforced. A Prisma client here would be a second
// implementation of the rules and would need database credentials in an
// editor's environment, which is exactly what the API key exists to avoid.
//
// Two things are deliberately absent:
//
//   - `run` and `generate`. They reach a model, cost money, and are
//     development-only by design. The caller here is already an agent with its
//     own model; letting it spend this project's tokens adds nothing.
//   - Anything administrative — members, keys, deleting a prompt. A workspace
//     key is an EDITOR and cannot do those, and `delete` is the one
//     irreversible operation in the product, so it is not something an agent
//     should reach for on its own.
//
// Creating and appending are both here, because the point of the server is that
// a prompt refined in an editor ends up in the library instead of in a chat log
// that is closed and lost.

const VERSION = "0.1.0";

// stdout is the JSON-RPC channel. A stray `console.log` corrupts the stream and
// the client reports a protocol error, so diagnostics go to stderr only.
const note = (message: string) => process.stderr.write(`[prompt-ops mcp] ${message}\n`);

type PromptSummary = {
  id: string;
  title: string;
  updatedAt: string;
  workspace: { name: string; slug: string };
  _count: { versions: number };
};

type PromptDetail = {
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

type Workspace = { id: string; name: string; slug: string };

/** Agents read JSON more reliably than they read a table. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/**
 * A failed tool call is reported as content with `isError`, not thrown: the
 * agent can read "API key has been revoked." and tell the user, where a
 * protocol-level exception only reads as "the tool broke".
 */
function failed(error: unknown) {
  const message =
    error instanceof CliError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text" as const, text: `error: ${message}` }], isError: true };
}

/**
 * Which workspace to act in. A key reaches exactly one, so naming none is
 * normal and unambiguous — but naming the wrong one should say so rather than
 * quietly acting somewhere else.
 */
async function resolveWorkspace(client: Client, workspace?: string): Promise<Workspace> {
  const list = await client.request<Workspace[]>("/api/workspaces");
  if (list.length === 0) throw new CliError("This key reaches no workspace.");

  if (!workspace) {
    if (list.length === 1) return list[0];
    const slugs = list.map((candidate) => candidate.slug).join(", ");
    throw new CliError(`Several workspaces are reachable (${slugs}). Name one.`);
  }

  const found = list.find((candidate) => candidate.slug === workspace || candidate.id === workspace);
  if (!found) {
    const slugs = list.map((candidate) => candidate.slug).join(", ") || "none";
    throw new CliError(`No workspace "${workspace}". This key reaches: ${slugs}.`);
  }
  return found;
}

async function fetchPrompts(client: Client, workspace?: string): Promise<PromptSummary[]> {
  if (!workspace) return client.request<PromptSummary[]>("/api/prompts");
  const found = await resolveWorkspace(client, workspace);
  return client.request<PromptSummary[]>(`/api/prompts?workspaceId=${found.id}`);
}

/**
 * Resolve what the agent named to exactly one prompt, the way the CLI does:
 * id, a 6+ character id prefix, or part of the title. Ambiguity is an error
 * with the candidates listed — an agent that picked one at random would edit
 * the wrong prompt and append a version that cannot be removed.
 */
async function locate(client: Client, prompt: string, workspace?: string): Promise<PromptDetail> {
  const list = await fetchPrompts(client, workspace);
  const match = matchPrompt(list, prompt);

  if (match.kind === "none") {
    throw new CliError(`No prompt matches "${prompt}". Call list_prompts to see what exists.`);
  }
  if (match.kind === "many") {
    const names = match.candidates.map((c) => `${c.id} (${c.title})`).join(", ");
    throw new CliError(`"${prompt}" matches several prompts: ${names}. Name one by id.`);
  }
  return client.request<PromptDetail>(`/api/prompts/${match.value.id}`);
}

const server = new McpServer(
  { name: "prompt-ops", version: VERSION },
  {
    instructions:
      "Prompt Ops is version control for prompts. Prompt history is append-only: " +
      "append_version adds a version and never edits one in place, so there is no " +
      "undo — read the prompt first and carry forward what you are not changing. " +
      "Name a prompt by id, by a 6+ character id prefix, or by part of its title.",
  },
);

server.registerTool(
  "list_prompts",
  {
    title: "List prompts",
    description:
      "List the prompts this key can reach, newest first: id, title, version count, workspace.",
    inputSchema: {
      workspace: z.string().optional().describe("Limit to one workspace, by slug or id."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ workspace }) => {
    try {
      const list = await fetchPrompts(createClient(), workspace);
      return json(
        list.map((prompt) => ({
          id: prompt.id,
          title: prompt.title,
          versions: prompt._count.versions,
          updatedAt: prompt.updatedAt,
          workspace: prompt.workspace.slug,
        })),
      );
    } catch (error) {
      return failed(error);
    }
  },
);

server.registerTool(
  "get_prompt",
  {
    title: "Read a prompt",
    description:
      "The current version of one prompt: body, tags, its {{variables}}, and its history.",
    inputSchema: {
      prompt: z.string().describe("Prompt id, a 6+ character id prefix, or part of its title."),
      workspace: z.string().optional().describe("Limit the search to one workspace."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ prompt, workspace }) => {
    try {
      const found = await locate(createClient(), prompt, workspace);
      const [latest] = found.versions;
      return json({
        id: found.id,
        title: found.title,
        workspace: found.workspace.slug,
        body: latest.body,
        tags: latest.tags,
        variables: variableNames(latest.body),
        versionCount: found.versions.length,
        // Oldest first, so index 0 is v1 — the numbering the app displays.
        history: [...found.versions].reverse().map((version, index) => ({
          version: index + 1,
          note: version.note,
          author: version.author?.name ?? null,
          createdAt: version.createdAt,
        })),
      });
    } catch (error) {
      return failed(error);
    }
  },
);

server.registerTool(
  "create_prompt",
  {
    title: "Create a prompt",
    description:
      "Save a new prompt to the library. Use this for an instruction worth reusing, " +
      "written as it should be reused: put {{variables}} where the specific values go, " +
      "rather than baking one request's details into the text. Call list_prompts first " +
      "— appending a version to a prompt that already covers this is better than adding " +
      "a near-duplicate.",
    inputSchema: {
      title: z.string().describe("Short name, as it will appear in the library."),
      body: z.string().describe("The prompt text. Use {{name}} for the parts that vary."),
      tags: z.string().optional().describe("Comma-separated, lowercase."),
      workspace: z
        .string()
        .optional()
        .describe("Which workspace, by slug or id. Omit unless the key reaches several."),
    },
    // Calling it twice creates two prompts: there is no key to collide on.
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  },
  async ({ title, body, tags, workspace }) => {
    try {
      const client = createClient();
      const target = await resolveWorkspace(client, workspace);

      const created = await client.request<PromptDetail>("/api/prompts", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: target.id,
          title,
          body,
          tags: tags ?? "",
        }),
      });

      return json({
        id: created.id,
        title: created.title,
        workspace: target.slug,
        variables: variableNames(body),
        version: 1,
      });
    } catch (error) {
      return failed(error);
    }
  },
);

server.registerTool(
  "append_version",
  {
    title: "Append a prompt version",
    description:
      "Append a new version to a prompt. History is append-only: this never edits an " +
      "existing version and cannot be undone. Fields you leave out carry forward from " +
      "the current version, so a version is always complete on its own.",
    inputSchema: {
      prompt: z.string().describe("Prompt id, a 6+ character id prefix, or part of its title."),
      body: z.string().optional().describe("The new prompt text. Omit to keep the current one."),
      title: z.string().optional(),
      tags: z.string().optional().describe("Comma-separated."),
      note: z.string().optional().describe("Why this version exists; shown in the history."),
      workspace: z.string().optional(),
    },
    // Not read-only, not idempotent: calling it twice appends two versions.
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  },
  async ({ prompt, body, title, tags, note, workspace }) => {
    try {
      if (!body && !title && tags === undefined) {
        throw new CliError("Nothing to change. Pass body, title, or tags.");
      }
      const client = createClient();
      const found = await locate(client, prompt, workspace);
      const [latest] = found.versions;

      const updated = await client.request<PromptDetail>(`/api/prompts/${found.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title ?? latest.title,
          body: body ?? latest.body,
          tags: tags ?? latest.tags,
          note: note ?? "Updated from an editor agent",
        }),
      });

      return json({
        id: updated.id,
        title: updated.title,
        version: found.versions.length + 1,
        variables: variableNames(body ?? latest.body),
      });
    } catch (error) {
      return failed(error);
    }
  },
);

server.registerTool(
  "compose",
  {
    title: "Fill a prompt's variables",
    description:
      "Substitute {{variables}} in a prompt's current version and return the result. " +
      "Reads only — it neither stores anything nor sends the prompt to a model.",
    inputSchema: {
      prompt: z.string().describe("Prompt id, a 6+ character id prefix, or part of its title."),
      variables: z
        .record(z.string(), z.string())
        .optional()
        .describe('Values by name, e.g. {"tone": "formal"}.'),
      workspace: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ prompt, variables, workspace }) => {
    try {
      const found = await locate(createClient(), prompt, workspace);
      const body = found.versions[0].body;
      const values = variables ?? {};

      // Unfilled placeholders are left standing by `composePrompt`, so say
      // which ones they are rather than handing back text that looks finished.
      const missing = variableNames(body).filter((name) => !values[name]?.trim());
      const composed = composePrompt(body, values);
      return missing.length === 0
        ? text(composed)
        : text(
            `${composed}\n\n[prompt-ops] still unfilled: ${missing
              .map((name) => `{{${name}}}`)
              .join(" ")}`,
          );
    } catch (error) {
      return failed(error);
    }
  },
);

async function main(): Promise<void> {
  // Say where we point and whether a key was found, on stderr, because the
  // usual failure is an editor launching this with no environment at all.
  const client = createClient();
  note(`v${VERSION} → ${client.url}${client.hasKey ? "" : " (no API key: set POPS_API_KEY)"}`);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  note(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
