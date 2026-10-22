#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { composePrompt, variableNames } from "@/lib/prompts-core";

import { CliError, createClient, type Client } from "./client";
import {
  DEFAULT_URL,
  clearConfig,
  configPath,
  loadConfig,
  maskKey,
  saveConfig,
  stripTrailingSlash,
} from "./config";
import { changeCount, paint, paintChange, renderDiff, table, truncate, when } from "./format";
import { matchPrompt, parseRange, parseRef, parseVariables } from "./resolve";

// `pops` — the command-line client for Prompt Ops.
//
// It speaks to a running web app over the same HTTP API the dashboard uses, so
// there is one implementation of the rules and the CLI cannot drift from the
// product. Authentication is a workspace API key, which is why the key is
// scoped to one workspace and acts as an editor inside it.

const HELP = `pops — Prompt Ops from the terminal

Usage
  pops <command> [options]

Workflow
  whoami                        Show the key, its workspace, and who writes are attributed to
  workspaces                    List workspaces you can reach
  prompts [--workspace slug]    List prompts, newest first
  show <prompt>                 Show a prompt's current version and its variables
  new --title T --body B        Create a prompt  (--file reads the body from a file)
  edit <prompt> [--body B]      Append a new version  (--title, --tags, --note, --file)
  history <prompt> [v1..v2]     Version history, or a diff between two versions
  run <prompt> [-v k=v]         Send the prompt to the model and print the reply
  generate <prompt> [-v k=v]    Generate code and commit it  (-m "commit message")
  log <prompt>                  The generated-code commit log
  commit <prompt> [c2]          One commit: files and metadata  (--diff, --file path)

Authentication
  auth login --key pops_…       Store a key (and --url for a non-default host)
  auth status                   Show where the CLI points and which key it holds
  auth logout                   Forget the stored key

Options
  --workspace <slug|id>   Which workspace to act in
  -v, --var name=value    Fill a {{variable}}; repeat for several
  -m, --message <text>    Commit message for \`generate\`
  --file <path>           Read a prompt body from a file, or pick a file in \`commit\`
  --diff                  Show a diff against the previous version or commit
  --json                  Print the raw API response
  --url <url>             Override the app URL for this call
  --key <key>             Override the API key for this call
  -h, --help              This text

A prompt can be named by id, by a 6+ character id prefix, or by part of its
title. Generating and running reach a model, so they need the app in
development mode with a provider configured.

Create a key in the web app: workspace settings → API keys (owners only).`;

type Options = {
  workspace?: string;
  var: string[];
  message?: string;
  file?: string;
  diff: boolean;
  json: boolean;
  url?: string;
  key?: string;
  title?: string;
  body?: string;
  tags?: string;
  note?: string;
};

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      var: { type: "string", multiple: true, short: "v", default: [] },
      message: { type: "string", short: "m" },
      file: { type: "string" },
      diff: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      url: { type: "string" },
      key: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      tags: { type: "string" },
      note: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    // `--diff` with no value, and unknown flags, should explain themselves
    // rather than crash with a stack trace.
    strict: true,
  });

  const [command, ...rest] = positionals;
  if (values.help || !command || command === "help") {
    console.log(HELP);
    return 0;
  }

  const options = values as unknown as Options & { help: boolean };
  const client = () => createClient({ url: options.url, key: options.key });

  switch (command) {
    case "auth":
      return auth(rest, options);
    case "whoami":
      return whoami(client(), options);
    case "workspaces":
      return workspaces(client(), options);
    case "prompts":
      return prompts(client(), options);
    case "show":
      return show(client(), rest[0], options);
    case "new":
      return create(client(), options);
    case "edit":
      return edit(client(), rest[0], options);
    case "history":
      return history(client(), rest[0], rest[1], options);
    case "run":
      return run(client(), rest[0], options);
    case "generate":
      return generate(client(), rest[0], options);
    case "log":
      return log(client(), rest[0], options);
    case "commit":
      return commit(client(), rest[0], rest[1], options);
    default:
      throw new CliError(`Unknown command "${command}". Run \`pops help\` for the list.`);
  }
}

// --- authentication ---------------------------------------------------------

function auth(args: string[], options: Options): number {
  const [action = "status"] = args;

  if (action === "login") {
    if (!options.key) {
      throw new CliError(
        "Pass the key: `pops auth login --key pops_…`\n" +
          "Create one in the web app: workspace settings → API keys (owners only).",
      );
    }
    if (!options.key.startsWith("pops_")) {
      throw new CliError("That does not look like a Prompt Ops key; they start with `pops_`.");
    }
    const url = stripTrailingSlash(options.url ?? loadConfig().url ?? DEFAULT_URL);
    const path = saveConfig({ url, key: options.key });
    console.log(`Saved ${maskKey(options.key)} for ${url}`);
    console.log(paint(`  ${path} (owner-readable only)`, "dim"));
    console.log(paint("  Check it with `pops whoami`.", "dim"));
    return 0;
  }

  if (action === "logout") {
    console.log(clearConfig() ? "Key forgotten." : "No stored key to forget.");
    console.log(paint("  POPS_API_KEY in your environment, if set, still applies.", "dim"));
    return 0;
  }

  if (action === "status") {
    const config = loadConfig();
    console.log(`url   ${config.url}`);
    console.log(`key   ${config.key ? maskKey(config.key) : paint("none", "dim")}`);
    console.log(paint(`file  ${configPath()}`, "dim"));
    // Say so when the environment is winning, otherwise the file above looks
    // like it is in charge when it is not.
    for (const name of ["POPS_URL", "POPS_API_KEY"] as const) {
      if (process.env[name]) console.log(paint(`env   ${name} is set and takes precedence`, "yellow"));
    }
    return 0;
  }

  throw new CliError(`Unknown auth command "${action}". Try login, logout, or status.`);
}

// --- reading ----------------------------------------------------------------

type WhoAmI = {
  authenticatedAs: string;
  user: { name: string | null; email: string } | null;
  key?: { name: string; prefix: string; lastUsedAt: string | null } | null;
  workspaces: { role: string; workspace: { id: string; name: string; slug: string } }[];
};

async function whoami(client: Client, options: Options): Promise<number> {
  const me = await client.request<WhoAmI>("/api/me");
  if (options.json) return print(me);

  console.log(`app        ${client.url}`);
  console.log(`auth       ${me.authenticatedAs === "apiKey" ? "API key" : "browser session"}`);
  if (me.key) {
    const used = me.key.lastUsedAt ? when(me.key.lastUsedAt) : "never before now";
    console.log(`key        ${me.key.name} (${me.key.prefix}…) · last used ${used}`);
  }
  console.log(
    `writes as  ${
      me.user
        ? `${me.user.name ?? "unnamed"} <${me.user.email}>`
        : paint("nobody — this key cannot create prompts", "yellow")
    }`,
  );
  for (const entry of me.workspaces) {
    console.log(`workspace  ${entry.workspace.name} (${entry.workspace.slug}) as ${entry.role}`);
  }
  return 0;
}

type Workspace = {
  id: string;
  name: string;
  slug: string;
  _count: { prompts: number };
  members: { role: string; user: { name: string | null; email: string } }[];
};

async function workspaces(client: Client, options: Options): Promise<number> {
  const list = await client.request<Workspace[]>("/api/workspaces");
  if (options.json) return print(list);
  if (list.length === 0) return say("No workspaces.");

  console.log(
    table([
      ["SLUG", "NAME", "PROMPTS", "MEMBERS"],
      ...list.map((workspace) => [
        workspace.slug,
        workspace.name,
        String(workspace._count.prompts),
        String(workspace.members.length),
      ]),
    ]),
  );
  return 0;
}

type PromptSummary = {
  id: string;
  title: string;
  updatedAt: string;
  workspace: { name: string; slug: string };
  versions: { body: string; tags: string }[];
  _count: { versions: number };
};

async function fetchPrompts(client: Client, options: Options): Promise<PromptSummary[]> {
  if (!options.workspace) return client.request<PromptSummary[]>("/api/prompts");

  // A slug is what a person reads off the dashboard; the API scopes by id.
  const list = await client.request<Workspace[]>("/api/workspaces");
  const workspace = list.find(
    (candidate) => candidate.slug === options.workspace || candidate.id === options.workspace,
  );
  if (!workspace) {
    const slugs = list.map((candidate) => candidate.slug).join(", ") || "none";
    throw new CliError(`No workspace "${options.workspace}". You can reach: ${slugs}.`);
  }
  return client.request<PromptSummary[]>(`/api/prompts?workspaceId=${workspace.id}`);
}

async function prompts(client: Client, options: Options): Promise<number> {
  const list = await fetchPrompts(client, options);
  if (options.json) return print(list);
  if (list.length === 0) return say("No prompts yet. Create one with `pops new`.");

  console.log(
    table([
      ["ID", "TITLE", "VERSIONS", "UPDATED", "WORKSPACE"],
      ...list.map((prompt) => [
        prompt.id.slice(0, 8),
        truncate(prompt.title, 40),
        String(prompt._count.versions),
        when(prompt.updatedAt),
        prompt.workspace.slug,
      ]),
    ]),
  );
  return 0;
}

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

/** Resolve what the user typed to one prompt, then fetch it in full. */
async function locate(client: Client, needle: string | undefined, options: Options) {
  if (!needle) throw new CliError("Which prompt? Pass an id, id prefix, or part of its title.");

  const list = await fetchPrompts(client, options);
  const match = matchPrompt(list, needle);

  if (match.kind === "none") {
    throw new CliError(`No prompt matches "${needle}". Run \`pops prompts\` to see them.`);
  }
  if (match.kind === "many") {
    const lines = match.candidates
      .map((candidate) => `  ${candidate.id.slice(0, 8)}  ${candidate.title}`)
      .join("\n");
    throw new CliError(`"${needle}" matches several prompts:\n${lines}`);
  }

  return client.request<PromptDetail>(`/api/prompts/${match.value.id}`);
}

async function show(client: Client, needle: string | undefined, options: Options): Promise<number> {
  const prompt = await locate(client, needle, options);
  if (options.json) return print(prompt);

  const [latest] = prompt.versions;
  const variables = variableNames(latest.body);
  console.log(`${paint(prompt.title, "bold")}  ${paint(prompt.id, "dim")}`);
  console.log(
    paint(
      `${prompt.workspace.slug} · ${prompt.versions.length} version${
        prompt.versions.length === 1 ? "" : "s"
      } · updated ${when(latest.createdAt)}`,
      "dim",
    ),
  );
  if (latest.tags) console.log(paint(`tags: ${latest.tags}`, "dim"));
  if (variables.length > 0) {
    console.log(paint(`variables: ${variables.map((name) => `{{${name}}}`).join(" ")}`, "cyan"));
  }
  console.log();
  console.log(latest.body);
  return 0;
}

async function history(
  client: Client,
  needle: string | undefined,
  range: string | undefined,
  options: Options,
): Promise<number> {
  const prompt = await locate(client, needle, options);
  // Oldest first, so v1 is the first version — the numbering the web UI shows.
  const ordered = [...prompt.versions].reverse();
  if (options.json) return print(ordered);

  if (range) {
    const parsed = parseRange(range, "v");
    if (!parsed) {
      throw new CliError(`A range looks like \`v1..v${ordered.length}\`; got "${range}".`);
    }
    const [from, to] = parsed;
    const before = ordered[from - 1];
    const after = ordered[to - 1];
    if (!before || !after) {
      throw new CliError(`This prompt has v1..v${ordered.length}.`);
    }
    console.log(paint(`v${from} → v${to}  ${before.note} → ${after.note}`, "bold"));
    console.log(renderDiff(before.body, after.body));
    return 0;
  }

  console.log(
    table(
      ordered
        .map((version, index) => [
          paint(`v${index + 1}`, "cyan"),
          truncate(version.note || "—", 34),
          version.author?.name ?? "unknown",
          when(version.createdAt),
        ])
        .reverse(),
    ),
  );
  console.log(paint("\nCompare two with `pops history <prompt> v1..v2`.", "dim"));
  return 0;
}

// --- writing ----------------------------------------------------------------

function bodyFrom(options: Options): string | undefined {
  if (options.file) {
    try {
      return readFileSync(options.file, "utf8");
    } catch {
      throw new CliError(`Cannot read ${options.file}.`);
    }
  }
  return options.body;
}

async function create(client: Client, options: Options): Promise<number> {
  const body = bodyFrom(options);
  if (!options.title || !body) {
    throw new CliError("A new prompt needs --title and either --body or --file.");
  }

  const list = await client.request<Workspace[]>("/api/workspaces");
  const workspace = options.workspace
    ? list.find((w) => w.slug === options.workspace || w.id === options.workspace)
    : list[0];
  if (!workspace) {
    throw new CliError(
      options.workspace
        ? `No workspace "${options.workspace}".`
        : "No workspace to create this in.",
    );
  }

  const created = await client.request<PromptDetail>("/api/prompts", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: workspace.id,
      title: options.title,
      body,
      tags: options.tags ?? "",
    }),
  });

  if (options.json) return print(created);
  console.log(`Created ${paint(created.title, "bold")} in ${workspace.slug}`);
  console.log(paint(`  ${created.id}`, "dim"));
  return 0;
}

async function edit(client: Client, needle: string | undefined, options: Options): Promise<number> {
  const prompt = await locate(client, needle, options);
  const [latest] = prompt.versions;
  const body = bodyFrom(options);

  if (!body && !options.title && options.tags === undefined) {
    throw new CliError("Nothing to change. Pass --body, --file, --title, or --tags.");
  }

  // Editing appends a version, so unspecified fields carry forward rather than
  // being blanked — the new version has to be complete on its own.
  const updated = await client.request<PromptDetail>(`/api/prompts/${prompt.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: options.title ?? latest.title,
      body: body ?? latest.body,
      tags: options.tags ?? latest.tags,
      note: options.note ?? "Updated from the CLI",
    }),
  });

  if (options.json) return print(updated);
  console.log(`Appended v${prompt.versions.length + 1} to ${paint(prompt.title, "bold")}`);
  return 0;
}

/** Fill `{{variables}}` from `-v`, refusing to send a half-filled prompt. */
function compose(body: string, options: Options): string {
  const values = parseVariables(options.var ?? []);
  const needed = variableNames(body);
  const missing = needed.filter((name) => !values[name]?.trim());
  if (missing.length > 0) {
    throw new CliError(
      `Fill every variable first: ${missing.map((name) => `-v ${name}=…`).join(" ")}`,
    );
  }
  return composePrompt(body, values);
}

type RunResult = {
  output: string;
  model: string;
  elapsedMs: number;
  incomplete: boolean;
  usage: { input_tokens: number; output_tokens: number } | null;
};

async function run(client: Client, needle: string | undefined, options: Options): Promise<number> {
  const prompt = await locate(client, needle, options);
  const input = compose(prompt.versions[0].body, options);

  const result = await client.request<RunResult>(`/api/prompts/${prompt.id}/run`, {
    method: "POST",
    body: JSON.stringify({ input }),
  });
  if (options.json) return print(result);

  console.log(
    paint(
      `${result.model} · ${(result.elapsedMs / 1000).toFixed(1)}s${
        result.usage
          ? ` · ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`
          : ""
      }`,
      "dim",
    ),
  );
  if (result.incomplete) {
    console.log(paint("Response hit the output limit and is incomplete.", "yellow"));
  }
  console.log();
  console.log(result.output || paint("No text returned.", "dim"));
  return 0;
}

type CommitFile = {
  path: string;
  hash: string;
  language: string;
  change: string;
  added: number;
  removed: number;
  content?: string;
};

type Commit = {
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

async function generate(
  client: Client,
  needle: string | undefined,
  options: Options,
): Promise<number> {
  const prompt = await locate(client, needle, options);
  const input = compose(prompt.versions[0].body, options);

  if (!options.json) {
    console.log(paint(`Generating from ${prompt.title}…`, "dim"));
  }

  const commit = await client.request<Commit>(`/api/prompts/${prompt.id}/generate`, {
    method: "POST",
    body: JSON.stringify({
      input,
      message: options.message ?? "",
      promptVersionId: prompt.versions[0].id,
    }),
  });
  if (options.json) return print(commit);

  printCommitHeader(commit);
  for (const file of commit.files) {
    console.log(
      `  ${paintChange(file.change)} ${file.path} ${changeCount(file.added, file.removed)}`,
    );
  }
  if (commit.files.length === 0) {
    console.log(paint("  No files in this response. See `pops commit … --json` for the raw reply.", "yellow"));
  }
  console.log(paint(`\nInspect it with \`pops commit ${needle} c${commit.sequence} --diff\`.`, "dim"));
  return 0;
}

function printCommitHeader(commit: Commit): void {
  const tokens = commit.outputTokens
    ? ` · ${commit.inputTokens ?? 0} in / ${commit.outputTokens} out`
    : "";
  console.log(
    `${paint(`c${commit.sequence}`, "cyan")} ${paint(commit.message, "bold")}${
      commit.incomplete ? paint("  truncated", "yellow") : ""
    }`,
  );
  console.log(
    paint(
      `  ${commit.authorName ?? "unknown"} · ${when(commit.createdAt)} · ${commit.model} · ${(
        commit.elapsedMs / 1000
      ).toFixed(1)}s${tokens}`,
      "dim",
    ),
  );
}

async function log(client: Client, needle: string | undefined, options: Options): Promise<number> {
  const prompt = await locate(client, needle, options);
  const { commits } = await client.request<{ commits: Commit[] }>(
    `/api/prompts/${prompt.id}/commits`,
  );
  if (options.json) return print(commits);
  if (commits.length === 0) {
    return say(`No commits yet. Generate one with \`pops generate ${needle}\`.`);
  }

  for (const commit of commits) {
    const changed =
      commit.stats.changed < commit.stats.files ? ` · ${commit.stats.changed} changed` : "";
    console.log(
      `${paint(`c${commit.sequence}`, "cyan")} ${truncate(commit.message, 44).padEnd(46)}${
        commit.stats.files
      } file${commit.stats.files === 1 ? "" : "s"}${changed} ${changeCount(
        commit.stats.added,
        commit.stats.removed,
      )}`,
    );
    console.log(
      paint(`   ${commit.authorName ?? "unknown"} · ${when(commit.createdAt)}`, "dim"),
    );
  }
  return 0;
}

async function commit(
  client: Client,
  needle: string | undefined,
  ref: string | undefined,
  options: Options,
): Promise<number> {
  const prompt = await locate(client, needle, options);
  const { commits } = await client.request<{ commits: Commit[] }>(
    `/api/prompts/${prompt.id}/commits`,
  );
  if (commits.length === 0) return say("No commits yet.");

  const sequence = ref ? parseRef(ref, "c") : commits[0].sequence;
  const summary = sequence
    ? commits.find((candidate) => candidate.sequence === sequence)
    : commits.find((candidate) => candidate.id.startsWith(ref ?? ""));
  if (!summary) {
    throw new CliError(
      `No commit ${ref} on this prompt. It has c1..c${commits[0].sequence}.`,
    );
  }

  const detail = await client.request<Commit>(
    `/api/prompts/${prompt.id}/commits/${summary.id}`,
  );
  if (options.json) return print(detail);

  printCommitHeader(detail);

  const chosen = options.file
    ? detail.files.filter((file) => file.path === options.file)
    : detail.files;
  if (options.file && chosen.length === 0) {
    throw new CliError(
      `No file "${options.file}" in c${detail.sequence}. It has: ${detail.files
        .map((file) => file.path)
        .join(", ")}`,
    );
  }

  // A diff needs the parent's copy of each file; fetch it once, not per file.
  const parent =
    options.diff && detail.parentId
      ? await client.request<Commit>(`/api/prompts/${prompt.id}/commits/${detail.parentId}`)
      : null;

  for (const file of chosen) {
    console.log();
    console.log(
      `${paintChange(file.change)} ${paint(file.path, "bold")} ${changeCount(
        file.added,
        file.removed,
      )} ${paint(file.hash, "dim")}`,
    );

    if (!options.diff) {
      console.log(file.content ?? paint("  (no contents)", "dim"));
      continue;
    }

    const before = parent?.files.find((candidate) => candidate.path === file.path)?.content ?? "";
    console.log(renderDiff(before, file.content ?? ""));
  }

  if (options.diff && !detail.parentId) {
    console.log(paint("\nThis is the first commit, so every line is new.", "dim"));
  }
  return 0;
}

// --- plumbing ---------------------------------------------------------------

function print(value: unknown): number {
  console.log(JSON.stringify(value, null, 2));
  return 0;
}

function say(message: string): number {
  console.log(message);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof CliError) {
      console.error(paint(`error: ${error.message}`, "red"));
      process.exit(1);
    }
    // parseArgs rejects unknown flags with a readable message; anything else is
    // a bug worth seeing in full.
    if (error instanceof Error && error.name === "TypeError" && /option/i.test(error.message)) {
      console.error(paint(`error: ${error.message}`, "red"));
      console.error("Run `pops help` for the available options.");
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });
