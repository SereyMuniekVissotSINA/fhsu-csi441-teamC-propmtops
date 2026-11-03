#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  type AgentChange,
  UNFILED,
  classifyLocalChanges,
  describeRestore,
  restoreSteps,
  runStats,
  snapshotSlug,
} from "@/lib/agent-runs";
import { composePrompt, variableNames } from "@/lib/prompts-core";

import { CliError, createClient, type Client } from "./client";
import { ask, confirm } from "./confirm";
import {
  DEFAULT_URL,
  clearConfig,
  configPath,
  loadConfig,
  maskKey,
  stripTrailingSlash,
  updateConfig,
} from "./config";
import { changeCount, paint, paintChange, renderDiff, table, truncate, when } from "./format";
import { matchKey, matchPrompt, parseRange, parseRef, parseVariables } from "./resolve";
import { askPassword, passwordSignIn } from "./session";
import {
  activeSnapshot,
  applyRestore,
  forgetSnapshot,
  linkSnapshot,
  localChanges,
  setWorkspace,
  storedWorkspace,
  suggestedName,
  summariseSnapshots,
  takeSnapshot,
} from "./snapshot";

// `pops` — the command-line client for Prompt Ops.
//
// It speaks to a running web app over the same HTTP API the dashboard uses, so
// there is one implementation of the rules and the CLI cannot drift from the
// product. Authentication is a workspace API key, which is why the key is
// scoped to one workspace and acts as an editor inside it.
//
// Key administration is the exception. A key can never mint another key, so the
// `keys` commands sign in as a person instead and present a session cookie —
// the same credential a browser holds, obtained the same way. Everything else
// goes out under the key.

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

Snapshots and agent runs
  A snapshot is a branch inside a workspace, so \`snapshot\` settles the
  workspace first, then names the branch and baselines this project's files.

  snapshot [name]               Choose a workspace, name a branch, baseline
  snapshot delete <name>        Forget the baseline, and the branch if unused
  snapshot archive <name>       Retire a branch, keeping its runs readable
  snapshot unarchive <name>     Bring a retired branch back
  snapshots [--archived]        This workspace's branches, and their drift
  status [--diff]               What has changed since the active baseline
  push --prompt "…"             Record the diff as a run  (--agent, --snapshot)
  restore <r7>                  Put a run's pre-run files back  (--yes)
  restore --watch --yes         Apply restores asked for on the website

Authentication
  auth login --email you@…      Sign in with your password, for the keys commands
  auth login --key pops_…       Store a key you already have
  auth status                   Show where the CLI points and what it holds
  auth logout                   Forget the stored key and session

API keys (workspace owners, after \`auth login --email\`)
  keys                          List the workspace's keys
  keys create [--name laptop]   Mint a key and print it once  (--save stores it)
  keys revoke <prefix|name>     Revoke a key, keeping it on the record

Options
  --workspace <slug|id>   Which workspace to act in
  --root <path>           Project directory for the run commands (default: cwd)
  --snapshot <name>       Act on this branch, without making it the active one
  --archived              Include retired branches in \`snapshots\`
  --prompt <text>         What the agent was asked for, recorded with the run
  --agent <name>          Which agent did the work  (default: this host name)
  --response <text>       The agent's own account of the run, kept for the record
  --yes                   Do not ask before overwriting files, or deleting a baseline
  --watch                 Keep applying restores as the website asks for them
  --email <address>       Sign in as this user
  --password <text>       Skip the password prompt (prefer POPS_PASSWORD)
  --name <text>           Name for a new key
  --save                  Store a freshly minted key as the one this CLI uses
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

A run is the other way round: the agent has already edited files here, and the
diff against a baseline is what gets recorded, so \`push\` reaches no model and
works against a deployed app.

  pops snapshot                      # pick the workspace, name the branch
  # …let the agent edit files…
  pops status --diff
  pops push --prompt "what you asked for"

The branch and its runs live in the workspace; the baseline — the copy of the
tree a push diffs against — stays in this project's .pops directory.

First run, from nothing:

  pops auth login --email owner@example.com
  pops keys create --name "my laptop" --save
  pops whoami

The key is shown once, when it is created, and is unrecoverable afterwards —
only its hash is stored. Mint a new one rather than hunting for an old one.`;

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
  email?: string;
  password?: string;
  name?: string;
  save: boolean;
  root?: string;
  snapshot?: string;
  archived: boolean;
  prompt?: string;
  agent?: string;
  response?: string;
  yes: boolean;
  watch: boolean;
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
      email: { type: "string" },
      password: { type: "string" },
      name: { type: "string" },
      save: { type: "boolean", default: false },
      root: { type: "string" },
      snapshot: { type: "string" },
      archived: { type: "boolean", default: false },
      prompt: { type: "string" },
      agent: { type: "string" },
      response: { type: "string" },
      yes: { type: "boolean", default: false },
      watch: { type: "boolean", default: false },
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
    case "keys":
      return keys(rest, options);
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
    // The snapshot commands touch only the filesystem, so they need no client
    // and work with the app down.
    case "snapshot":
      return snapshot(client(), rest, options);
    case "snapshots":
      return snapshots(client(), options);
    case "status":
      return status(options);
    case "push":
      return push(client(), options);
    case "restore":
      return restore(client(), rest[0], options);
    default:
      throw new CliError(`Unknown command "${command}". Run \`pops help\` for the list.`);
  }
}

// --- authentication ---------------------------------------------------------

async function auth(args: string[], options: Options): Promise<number> {
  const [action = "status"] = args;

  if (action === "login") return login(options);

  if (action === "logout") {
    console.log(clearConfig() ? "Key and session forgotten." : "Nothing stored to forget.");
    console.log(paint("  POPS_API_KEY in your environment, if set, still applies.", "dim"));
    return 0;
  }

  if (action === "status") {
    const config = loadConfig();
    console.log(`url      ${config.url}`);
    console.log(`key      ${config.key ? maskKey(config.key) : paint("none", "dim")}`);
    console.log(
      `session  ${
        config.session
          ? `signed in${config.email ? ` as ${config.email}` : ""}`
          : paint("none — `pops auth login --email you@example.com` to manage keys", "dim")
      }`,
    );
    console.log(paint(`file     ${configPath()}`, "dim"));
    // Say so when the environment is winning, otherwise the file above looks
    // like it is in charge when it is not.
    for (const name of ["POPS_URL", "POPS_API_KEY"] as const) {
      if (process.env[name]) console.log(paint(`env      ${name} is set and takes precedence`, "yellow"));
    }
    return 0;
  }

  throw new CliError(`Unknown auth command "${action}". Try login, logout, or status.`);
}

/**
 * Two ways in, because there are two credentials. `--key` stores one you
 * already hold; `--email` signs in so the `keys` commands can issue the first
 * one — a chicken-and-egg problem the web app used to be the only answer to.
 */
async function login(options: Options): Promise<number> {
  const url = stripTrailingSlash(options.url ?? loadConfig().url ?? DEFAULT_URL);

  if (options.email) {
    const email = options.email.trim();
    const given = options.password ?? process.env.POPS_PASSWORD?.trim();
    const password = given || (await askPassword(`Password for ${email}: `));
    if (!password) throw new CliError("No password given.");

    const session = await passwordSignIn({ url, email, password });
    const path = updateConfig({ url, session, email });
    console.log(`Signed in as ${email} on ${url}`);
    console.log(paint(`  ${path} (owner-readable only)`, "dim"));

    // Naming the workspaces they own turns the next command into a copy-paste
    // rather than a guess, and proves the cookie actually works.
    const me = await createClient({ url, session }).sessionRequest<WhoAmI>("/api/me");
    const owned = me.workspaces.filter((entry) => entry.role === "OWNER");
    for (const entry of me.workspaces) {
      console.log(`  ${entry.workspace.slug.padEnd(16)} ${entry.role.toLowerCase()}`);
    }
    console.log(
      owned.length > 0
        ? paint('\nMint a key with `pops keys create --name "my laptop" --save`.', "dim")
        : paint("\nYou do not own a workspace, so you cannot mint keys.", "yellow"),
    );
    return 0;
  }

  if (options.key) {
    if (!options.key.startsWith("pops_")) {
      throw new CliError("That does not look like a Prompt Ops key; they start with `pops_`.");
    }
    const path = updateConfig({ url, key: options.key });
    console.log(`Saved ${maskKey(options.key)} for ${url}`);
    console.log(paint(`  ${path} (owner-readable only)`, "dim"));
    console.log(paint("  Check it with `pops whoami`.", "dim"));
    return 0;
  }

  throw new CliError(
    "Sign in one of two ways:\n" +
      "  pops auth login --email you@example.com   password prompt, lets you manage keys\n" +
      "  pops auth login --key pops_…              a key you already have",
  );
}

// --- API keys ---------------------------------------------------------------

type KeyRecord = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

async function keys(args: string[], options: Options): Promise<number> {
  const [action = "list", ...rest] = args;
  const client = createClient({ url: options.url });

  try {
    switch (action) {
      case "list":
        return await keysList(client, options);
      case "create":
      case "new":
        return await keysCreate(client, options);
      case "revoke":
      case "delete":
        return await keysRevoke(client, rest[0], options);
      default:
        throw new CliError(`Unknown keys command "${action}". Try list, create, or revoke.`);
    }
  } catch (error) {
    // A cookie expires where a key does not, and "You must be signed in" on its
    // own looks like a bug when you signed in last week.
    if (error instanceof CliError && error.status === 401 && client.hasSession) {
      throw new CliError(
        "That session is no longer valid — sign in again:\n" +
          "  pops auth login --email you@example.com",
      );
    }
    throw error;
  }
}

/**
 * Which workspace to administer. Only owners can reach these routes at all, so
 * a workspace the caller merely edits is not a candidate — offering it would
 * only produce a 403 one call later.
 */
async function ownedWorkspace(client: Client, options: Options) {
  const me = await client.sessionRequest<WhoAmI>("/api/me");
  const owned = me.workspaces.filter((entry) => entry.role === "OWNER");

  if (options.workspace) {
    const chosen = me.workspaces.find(
      (entry) =>
        entry.workspace.slug === options.workspace || entry.workspace.id === options.workspace,
    );
    if (!chosen) throw new CliError(`No workspace "${options.workspace}" that you can reach.`);
    if (chosen.role !== "OWNER") {
      throw new CliError(
        `You are ${chosen.role.toLowerCase()} in ${chosen.workspace.slug}; keys are owners only.`,
      );
    }
    return chosen.workspace;
  }

  if (owned.length === 0) {
    throw new CliError("You do not own a workspace, so there are no keys to manage.");
  }
  // Picking one of several silently would list or revoke keys in a workspace
  // the user was not thinking about.
  if (owned.length > 1) {
    const slugs = owned.map((entry) => entry.workspace.slug).join(", ");
    throw new CliError(`You own several workspaces. Pass --workspace <${slugs}>.`);
  }
  return owned[0].workspace;
}

async function keysList(client: Client, options: Options): Promise<number> {
  const workspace = await ownedWorkspace(client, options);
  const list = await client.sessionRequest<KeyRecord[]>(`/api/workspaces/${workspace.id}/keys`);
  if (options.json) return print(list);
  if (list.length === 0) {
    return say(`No keys in ${workspace.slug}. Create one with \`pops keys create\`.`);
  }

  const stored = loadConfig().key;
  console.log(
    table([
      ["KEY", "NAME", "CREATED", "LAST USED", "STATUS"],
      ...list.map((record) => [
        // Mark the one this CLI is holding, so revoking does not silently log
        // the user out of their own terminal.
        stored?.startsWith(record.prefix) ? paint(`${record.prefix}… *`, "cyan") : `${record.prefix}…`,
        truncate(record.name, 24),
        when(record.createdAt),
        record.lastUsedAt ? when(record.lastUsedAt) : paint("never", "dim"),
        record.revokedAt ? paint("revoked", "yellow") : paint("active", "green"),
      ]),
    ]),
  );
  if (list.some((record) => stored?.startsWith(record.prefix))) {
    console.log(paint("\n* the key this CLI is using", "dim"));
  }
  return 0;
}

async function keysCreate(client: Client, options: Options): Promise<number> {
  const workspace = await ownedWorkspace(client, options);
  // A name is required by the API; defaulting to the machine means a key can be
  // traced back to where it is installed without the user inventing a label.
  const name = (options.name ?? `cli on ${hostname()}`).slice(0, 60);

  const created = await client.sessionRequest<KeyRecord & { key: string }>(
    `/api/workspaces/${workspace.id}/keys`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
  if (options.json) return print(created);

  console.log(`Created ${paint(created.name, "bold")} in ${workspace.slug}`);
  console.log();
  console.log(`  ${paint(created.key, "cyan")}`);
  console.log();
  console.log(paint("This is the only time the key is shown — only its hash is stored.", "yellow"));

  if (options.save) {
    updateConfig({ url: client.url, key: created.key });
    console.log(`Saved as this CLI's key. Check it with \`pops whoami\`.`);
  } else {
    console.log(paint("Store it with `pops auth login --key …`, or re-run with --save.", "dim"));
  }
  return 0;
}

async function keysRevoke(
  client: Client,
  needle: string | undefined,
  options: Options,
): Promise<number> {
  if (!needle) throw new CliError("Which key? Pass its prefix, name, or id.");
  const workspace = await ownedWorkspace(client, options);
  const list = await client.sessionRequest<KeyRecord[]>(`/api/workspaces/${workspace.id}/keys`);

  const match = matchKey(list, needle);
  if (match.kind === "none") {
    throw new CliError(`No key matches "${needle}" in ${workspace.slug}. Run \`pops keys\`.`);
  }
  if (match.kind === "many") {
    const lines = match.candidates
      .map((candidate) => `  ${candidate.prefix}…  ${candidate.name}`)
      .join("\n");
    throw new CliError(`"${needle}" matches several keys:\n${lines}`);
  }

  const key = match.value;
  if (key.revokedAt) return say(`${key.prefix}… was already revoked ${when(key.revokedAt)}.`);

  await client.sessionRequest(`/api/workspaces/${workspace.id}/keys?keyId=${key.id}`, {
    method: "DELETE",
  });
  console.log(`Revoked ${paint(`${key.prefix}…`, "bold")} (${key.name}).`);
  // Revoked rather than deleted server-side, so the listing still shows it.
  console.log(paint("  It stays on the record, and stops working immediately.", "dim"));

  if (loadConfig().key?.startsWith(key.prefix)) {
    console.log(paint("That was this CLI's own key — mint another with `pops keys create --save`.", "yellow"));
  }
  return 0;
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

// --- snapshots and agent runs -----------------------------------------------
//
// The local half of the product: an agent edits files on this machine, and the
// diff against a baseline taken beforehand becomes a run on the website. The
// filesystem is the source of truth throughout — nothing here asks an agent
// what it changed.
//
// A snapshot is a branch, and a branch belongs to a workspace, so `pops
// snapshot` settles the workspace before it will name one. What the server
// keeps is the branch and its runs; the baseline — the copy of the tree a push
// diffs against — stays in `.pops/`, because it is only ever compared against
// this machine's files.

type RunFileSummary = {
  path: string;
  language: string;
  change: AgentChange;
  added: number;
  removed: number;
};

type RunSummary = {
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

type RunDetail = RunSummary & {
  response: string;
  files: (RunFileSummary & { before: string; after: string })[];
};

/** A branch as the server holds it. */
type ServerSnapshot = {
  id: string;
  name: string;
  slug: string;
  runs: number;
  baselinedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

/** Where the commands act: `--root`, or the directory the CLI was run from. */
function projectRoot(options: Options): string {
  return resolve(options.root ?? process.cwd());
}

async function snapshot(client: Client, args: string[], options: Options): Promise<number> {
  const [first, ...rest] = args;
  // `delete`, `rm`, `archive` and `unarchive` read as subcommands rather than
  // names. A snapshot genuinely called "delete" is still reachable as
  // `pops snapshot --snapshot delete`.
  if (first === "delete" || first === "rm") {
    return deleteSnapshot(client, rest[0] ?? options.snapshot, options);
  }
  if (first === "archive" || first === "unarchive") {
    return archiveSnapshot(client, first, rest[0] ?? options.snapshot, options);
  }
  return takeBaseline(client, first, options);
}

/**
 * Choose or create the workspace this project pushes to.
 *
 * A snapshot is a branch inside a workspace, so this comes first: there is
 * nothing for a branch to belong to until it is settled. Asked once and then
 * remembered in `.pops/index.json`, because a project does not change
 * workspaces often and being asked every time would be noise.
 */
async function chooseWorkspace(
  client: Client,
  root: string,
  options: Options,
): Promise<Workspace> {
  const list = await client.request<Workspace[]>("/api/workspaces");

  if (options.workspace) {
    const named = list.find(
      (candidate) => candidate.slug === options.workspace || candidate.id === options.workspace,
    );
    if (!named) {
      const slugs = list.map((candidate) => candidate.slug).join(", ") || "none";
      throw new CliError(`No workspace "${options.workspace}". You can reach: ${slugs}.`);
    }
    return named;
  }

  // What this project chose last time. A workspace that has since gone — or
  // that this key can no longer reach — falls through to being asked again
  // rather than failing.
  const stored = storedWorkspace(root);
  const remembered = stored ? list.find((candidate) => candidate.id === stored) : undefined;
  if (remembered) return remembered;

  if (list.length === 1) return list[0];
  if (list.length === 0) return createWorkspace(client, options);

  console.log("Which workspace should this project push to?");
  list.forEach((workspace, position) => {
    console.log(`  ${position + 1}) ${workspace.name} ${paint(`(${workspace.slug})`, "dim")}`);
  });
  console.log(`  ${paint("n) a new workspace", "dim")}`);

  const answer = await ask("Workspace", "1");
  if (/^n(ew)?$/i.test(answer.trim())) return createWorkspace(client, options);

  const chosen =
    list[Number(answer) - 1] ??
    list.find(
      (candidate) =>
        candidate.slug === answer.trim() ||
        candidate.name.toLowerCase() === answer.trim().toLowerCase(),
    );
  if (!chosen) throw new CliError(`"${answer}" is not one of the workspaces listed.`);
  return chosen;
}

/**
 * Create a workspace from the terminal.
 *
 * Session-only, and not an oversight: a key is scoped to the workspace it was
 * minted in, so it cannot mint another workspace any more than it can mint
 * another key. Signing in is the honest requirement, and saying so beats a
 * bare 401 from the route.
 */
async function createWorkspace(client: Client, options: Options): Promise<Workspace> {
  if (!client.hasSession) {
    throw new CliError(
      "Creating a workspace needs a signed-in user, not an API key.\n" +
        "Run `pops auth login --email you@example.com` first, or create it in the dashboard\n" +
        "and re-run this with --workspace <slug>.",
    );
  }

  const name = options.name ?? (await ask("New workspace name", "My workspace"));
  const workspace = await client.sessionRequest<{ id: string; name: string; slug: string }>(
    "/api/workspaces",
    { method: "POST", body: JSON.stringify({ name }) },
  );
  console.log(`Created workspace ${paint(workspace.name, "bold")} (${workspace.slug}).`);
  return workspace as Workspace;
}

/**
 * Name the branch, then baseline the tree.
 *
 * The workspace is settled first, then the branch is created on the server —
 * an upsert, so re-baselining an existing name is the same branch rather than
 * a second one — and only then is the copy of the tree taken. The name is
 * asked for at that point because it is the moment the developer knows what
 * the work is called; with no terminal to ask on the suggestion is accepted
 * silently, so a hook does not hang on a question nobody will answer.
 */
async function takeBaseline(
  client: Client,
  name: string | undefined,
  options: Options,
): Promise<number> {
  const root = projectRoot(options);
  const workspace = await chooseWorkspace(client, root, options);

  const existing = await client.request<{ snapshots: ServerSnapshot[] }>(
    `/api/snapshots?workspaceId=${workspace.id}`,
  );
  const chosen = name ?? options.snapshot ?? (await askSnapshotName(root, existing.snapshots));

  // Created before the baseline, so a name the server will not accept costs
  // nothing but the question, and so the branch exists even if the copy fails.
  const takenAt = new Date().toISOString();
  const registered = await client.request<ServerSnapshot>("/api/snapshots", {
    method: "POST",
    body: JSON.stringify({ workspaceId: workspace.id, name: chosen, baselinedAt: takenAt }),
  });

  const { baseline, snapshot, created } = takeSnapshot(root, registered.name);
  setWorkspace(root, workspace.id);
  linkSnapshot(root, snapshot.slug, registered.id);

  if (options.json) {
    return print({ workspace, snapshot: registered, files: Object.keys(baseline.files).length });
  }

  const count = Object.keys(baseline.files).length;
  console.log(
    `${created ? "Started" : "Re-baselined"} ${paint(registered.name, "bold")} in ${paint(
      workspace.name,
      "bold",
    )} from ${count} file${count === 1 ? "" : "s"}.`,
  );
  if (registered.runs > 0) {
    console.log(
      paint(
        `  ${registered.runs} run${registered.runs === 1 ? "" : "s"} already filed under it.`,
        "dim",
      ),
    );
  }
  if (baseline.skipped.length > 0) {
    console.log(
      paint(
        `  ${baseline.skipped.length} file${
          baseline.skipped.length === 1 ? "" : "s"
        } left untracked (binary or too large), and excluded from both sides of the diff.`,
        "dim",
      ),
    );
  }
  console.log(paint("Let the agent work, then `pops push --prompt \"what you asked for\"`.", "dim"));
  return 0;
}

/** Offer the branches the workspace already has, then ask for a name. */
async function askSnapshotName(root: string, existing: ServerSnapshot[]): Promise<string> {
  if (existing.length > 0) {
    console.log("Snapshots in this workspace:");
    for (const entry of existing.slice(0, 10)) {
      const runs = `${entry.runs} run${entry.runs === 1 ? "" : "s"}`;
      const baselined = entry.baselinedAt ? when(entry.baselinedAt) : "never baselined";
      console.log(`  ${entry.name} ${paint(`· ${runs} · ${baselined}`, "dim")}`);
    }
    console.log(paint("Name one of those to continue it, or anything else to start a branch.", "dim"));
  }
  return ask("Name this snapshot", suggestedName(root));
}

/**
 * The branches this workspace holds, and how far each local baseline has
 * drifted from the tree.
 *
 * The server knows the branches and their runs; only this machine knows the
 * drift, so the two are merged here. A branch nobody has baselined locally
 * still shows, because it is somewhere a push can go.
 */
async function snapshots(client: Client, options: Options): Promise<number> {
  const root = projectRoot(options);
  const { rows } = summariseSnapshots(root);
  const local = new Map(rows.map((row) => [row.slug, row]));

  let remote: ServerSnapshot[] = [];
  let unreachable = false;
  try {
    const workspace = await chooseWorkspace(client, root, options);
    const listed = await client.request<{ snapshots: ServerSnapshot[] }>(
      `/api/snapshots?workspaceId=${workspace.id}&archived=${options.archived ? "1" : "0"}`,
    );
    remote = listed.snapshots;
  } catch (error) {
    // Worth printing what is on disk anyway: the baselines are local, and a
    // developer asking what this project tracks should get an answer with the
    // app down.
    if (!(error instanceof CliError)) throw error;
    unreachable = true;
  }

  if (options.json) return print({ remote, local: rows });

  if (remote.length === 0 && rows.length === 0) {
    return say(`No snapshots for ${root}. Start one with \`pops snapshot\`.`);
  }

  const seen = new Set<string>();
  const lines: string[][] = [["", "NAME", "RUNS", "FILES", "CHANGED", "BASELINE"]];

  for (const entry of remote) {
    seen.add(entry.slug);
    const here = local.get(entry.slug);
    lines.push([
      here && here.slug === activeSnapshot(root)?.slug ? paint("*", "green") : " ",
      entry.archivedAt ? `${entry.name} ${paint("(archived)", "dim")}` : entry.name,
      String(entry.runs),
      here ? String(here.files) : paint("—", "dim"),
      here?.changed === undefined || here.changed === null
        ? paint(here ? "no baseline" : "not here", "dim")
        : String(here.changed),
      here?.takenAt ? when(here.takenAt) : paint("never", "dim"),
    ]);
  }

  // Baselines this machine has that the server does not know about: an index
  // written before snapshots belonged to a workspace, or one taken while the
  // app was down. The next `pops snapshot` under that name registers it.
  for (const row of rows) {
    if (seen.has(row.slug)) continue;
    lines.push([
      row.slug === activeSnapshot(root)?.slug ? paint("*", "green") : " ",
      `${row.name} ${paint(unreachable ? "" : "(local only)", "dim")}`.trimEnd(),
      paint("—", "dim"),
      String(row.files),
      row.changed === null ? paint("no baseline", "dim") : String(row.changed),
      row.takenAt ? when(row.takenAt) : paint("never", "dim"),
    ]);
  }

  console.log(table(lines));
  if (unreachable) {
    console.log(paint(`\nCould not reach ${client.url}, so this is what is on disk only.`, "yellow"));
  }
  return 0;
}

/** What has changed under the active baseline, without pushing anything. */
function status(options: Options): number {
  const root = projectRoot(options);
  const { snapshot, baseline, changes } = localChanges(root, options.snapshot);
  const files = classifyLocalChanges(changes);
  if (options.json) return print({ snapshot, baselineAt: baseline.takenAt, files });

  console.log(`${paint(snapshot.name, "bold")} · baseline ${when(baseline.takenAt)} · ${root}`);
  if (files.length === 0) {
    return say(paint("Nothing has changed since that baseline.", "dim"));
  }

  const stats = runStats(files);
  for (const file of files) {
    console.log(
      `  ${paintChange(file.change)} ${file.path} ${changeCount(file.added, file.removed)}`,
    );
    if (options.diff) console.log(renderDiff(file.before, file.after));
  }
  console.log(
    paint(
      `\n${stats.files} file${stats.files === 1 ? "" : "s"} · +${stats.added} −${stats.removed}`,
      "dim",
    ),
  );
  return 0;
}

/** Record the run: the diff against the baseline, filed under its branch. */
async function push(client: Client, options: Options): Promise<number> {
  const root = projectRoot(options);
  const { snapshot, baseline, changes } = localChanges(root, options.snapshot);
  if (changes.length === 0) {
    return say(
      `Nothing has changed in ${root} since the ${snapshot.name} baseline, so there is no run to push.`,
    );
  }

  const workspace = await chooseWorkspace(client, root, options);

  // A baseline taken before snapshots belonged to a workspace — or while the
  // app was unreachable — has no branch yet. Registering it here rather than
  // refusing keeps the push working: the name is what it was baselined under.
  const snapshotId =
    snapshot.snapshotId ??
    (
      await client.request<ServerSnapshot>("/api/snapshots", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          name: snapshot.name,
          baselinedAt: baseline.takenAt || null,
        }),
      })
    ).id;
  if (!snapshot.snapshotId) linkSnapshot(root, snapshot.slug, snapshotId);

  const run = await client.request<RunSummary>("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: workspace.id,
      snapshotId,
      // Sent beside the id so a server that has not been updated yet still
      // files the run under the right name.
      category: snapshot.name,
      baselineAt: baseline.takenAt || null,
      // Free text, and the host name is a reasonable default: it says which
      // machine the files are on, which is what a restore needs to know.
      agent: options.agent ?? `${hostname()}`,
      root,
      prompt: options.prompt ?? options.message ?? "",
      response: options.response ?? "",
      files: changes.map((file) => ({
        path: file.path,
        before: file.before,
        after: file.after,
      })),
    }),
  });

  setWorkspace(root, workspace.id);
  // The baseline moves to what was just recorded, so the next run measures
  // from here rather than re-pushing the same diff. A one-off `--snapshot`
  // stays one-off: it does not become the working branch.
  takeSnapshot(root, snapshot.name, { makeActive: !options.snapshot });

  if (options.json) return print(run);

  console.log(
    `${paint(`r${run.sequence}`, "cyan")} ${paint(run.summary, "bold")} ${paint(
      `in ${snapshot.name}`,
      "dim",
    )}`,
  );
  for (const file of run.files) {
    console.log(
      `  ${paintChange(file.change)} ${file.path} ${changeCount(file.added, file.removed)}`,
    );
  }
  console.log(
    paint(
      `\n${client.url}/dashboard/runs/${run.id}\nBaseline re-taken, so the next push is the next run.`,
      "dim",
    ),
  );
  return 0;
}

/**
 * Forget a branch.
 *
 * Two things carry the name: the baseline on this disk, and the branch in the
 * workspace. The baseline is always forgotten — it is this machine's copy. The
 * branch is deleted only when nothing is filed under it; a branch with runs is
 * the record of what an agent did to someone's files, and the route refuses,
 * which is what `archive` is for.
 */
async function deleteSnapshot(
  client: Client,
  named: string | undefined,
  options: Options,
): Promise<number> {
  const root = projectRoot(options);
  if (!named) {
    throw new CliError(
      "Which snapshot? Pass its name, as `pops snapshot delete \"auth refactor\"`.\n" +
        "`pops snapshots` lists the ones this project has.",
    );
  }

  // Looked up before anything is written, so a typo costs nothing.
  const { rows } = summariseSnapshots(root);
  const slug = snapshotSlug(named);
  const row = rows.find((candidate) => candidate.slug === slug);
  if (!row) {
    const known = rows.map((candidate) => candidate.name).join(", ") || "none yet";
    throw new CliError(`No snapshot "${named}" in ${root}.\n  This project has: ${known}.`);
  }

  const outstanding = row.changed ?? 0;
  console.log(
    `${paint(row.name, "bold")} · ${row.files} file${row.files === 1 ? "" : "s"} · baseline ${
      row.takenAt ? when(row.takenAt) : "never taken"
    }`,
  );
  if (outstanding > 0) {
    console.log(
      paint(
        `${outstanding} file${
          outstanding === 1 ? " has" : "s have"
        } changed since that baseline and ${
          outstanding === 1 ? "has" : "have"
        } not been pushed. Deleting it loses the before-contents, so those changes could no longer be recorded or undone.`,
        "yellow",
      ),
    );
  }

  if (!options.yes && !(await confirm(`Forget the ${row.name} baseline?`))) {
    return say("Left alone.");
  }

  // The branch first: if the server refuses because runs are filed under it,
  // the developer should hear that before the local copy is gone.
  let branch: string;
  if (row.snapshotId) {
    try {
      await client.request(`/api/snapshots/${row.snapshotId}`, { method: "DELETE" });
      branch = "and the branch it names in the workspace";
    } catch (error) {
      if (!(error instanceof CliError) || error.status !== 409) throw error;
      console.log(paint(error.message, "yellow"));
      console.log(
        paint(`Keeping the branch. \`pops snapshot archive "${row.name}"\` retires it.`, "dim"),
      );
      branch = "but the branch stays in the workspace, with its runs";
    }
  } else {
    branch = "which the workspace did not know about";
  }

  const { snapshot, hadBaseline, remaining } = forgetSnapshot(root, named);
  if (options.json) return print({ snapshot, hadBaseline, remaining });

  console.log(
    `Forgot the ${paint(snapshot.name, "bold")} baseline${
      hadBaseline ? "" : " (there was none on disk)"
    }, ${branch}.`,
  );
  console.log(
    paint(
      remaining.length === 0
        ? "This project tracks nothing now. `pops snapshot` starts again."
        : `Still here: ${remaining.map((entry) => entry.name).join(", ")}. ` +
          "None is active — name one with `pops snapshot <name>` before the next push.",
      "dim",
    ),
  );
  return 0;
}

/**
 * Retire a branch, or bring it back.
 *
 * Archiving is how a finished line of work leaves the pickers and the chips
 * while its runs stay readable — the answer for a branch that cannot be
 * deleted because something is filed under it. The local baseline is left
 * alone: `pops snapshot delete` is for that.
 */
async function archiveSnapshot(
  client: Client,
  action: "archive" | "unarchive",
  named: string | undefined,
  options: Options,
): Promise<number> {
  const root = projectRoot(options);
  if (!named) throw new CliError(`Which snapshot? Pass its name to \`pops snapshot ${action}\`.`);

  const workspace = await chooseWorkspace(client, root, options);
  const { snapshots: listed } = await client.request<{ snapshots: ServerSnapshot[] }>(
    `/api/snapshots?workspaceId=${workspace.id}&archived=1`,
  );
  const slug = snapshotSlug(named);
  const target = listed.find((candidate) => candidate.slug === slug);
  if (!target) {
    const known = listed.map((candidate) => candidate.name).join(", ") || "none";
    throw new CliError(
      `No snapshot "${named}" in ${workspace.slug}.\n  That workspace has: ${known}.`,
    );
  }

  const updated = await client.request<ServerSnapshot>(`/api/snapshots/${target.id}`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  });
  if (options.json) return print(updated);

  console.log(
    action === "archive"
      ? `Archived ${paint(updated.name, "bold")}. Its ${updated.runs} run${
          updated.runs === 1 ? " stays" : "s stay"
        } readable; it is out of the pickers and the chips.`
      : `Brought ${paint(updated.name, "bold")} back.`,
  );
  console.log(paint("The baseline on this machine is untouched.", "dim"));
  return 0;
}

/**
 * Undo a run on this machine.
 *
 * This is the only command that writes to the working directory, which is why
 * it prints the plan and asks first unless `--yes` was passed. `--watch` picks
 * up restores asked for on the website and applies them as they arrive — the
 * other side of the handshake the dashboard button starts.
 */
async function restore(
  client: Client,
  ref: string | undefined,
  options: Options,
): Promise<number> {
  if (options.watch) return watchRestores(client, options);

  const run = await resolveRun(client, ref, options);
  return applyRun(client, run, options);
}

/** Resolve `r7`, an id, or an id prefix to one run the caller can reach. */
async function resolveRun(
  client: Client,
  ref: string | undefined,
  options: Options,
): Promise<RunDetail> {
  if (!ref) {
    throw new CliError(
      "Which run? Pass `r7` or a run id, or use `--watch` to apply restores asked for on the website.",
    );
  }

  const sequence = parseRef(ref, "r");
  const workspace = await chooseWorkspace(client, projectRoot(options), options);
  const { runs } = await client.request<{ runs: RunSummary[] }>(
    `/api/runs?workspaceId=${workspace.id}`,
  );
  const match = sequence
    ? runs.find((candidate) => candidate.sequence === sequence)
    : runs.find((candidate) => candidate.id === ref || candidate.id.startsWith(ref));
  if (!match) {
    const newest = runs[0] ? `The newest is r${runs[0].sequence}.` : "There are no runs yet.";
    throw new CliError(`No run ${ref} in reach. ${newest}`);
  }
  return client.request<RunDetail>(`/api/runs/${match.id}`);
}

/** Show the plan, ask, write, and tell the website it was done. */
async function applyRun(client: Client, run: RunDetail, options: Options): Promise<number> {
  const root = projectRoot(options);
  const steps = restoreSteps(run.files);

  // The run records where it was pushed from. Restoring somewhere else is
  // legitimate — a second clone, a different machine — but it is worth saying
  // out loud, because the files about to be overwritten are not the ones the
  // run was measured against.
  if (run.root && run.root !== root) {
    console.log(paint(`This run was pushed from ${run.root}.`, "yellow"));
  }

  console.log(
    `${paint(`r${run.sequence}`, "cyan")} ${run.summary} ${paint(
      `· ${run.category || UNFILED} · ${when(run.createdAt)}`,
      "dim",
    )}`,
  );
  console.log(`Undoing it in ${paint(root, "bold")}: ${describeRestore(steps)}.`);
  for (const step of steps) {
    console.log(
      step.action === "delete"
        ? `  ${paint("D", "red")} ${step.path}`
        : `  ${paint("W", "yellow")} ${step.path}`,
    );
  }
  console.log(
    paint("Anything changed in those files since the run is lost. The run stays in the log.", "dim"),
  );

  if (!options.yes && !(await confirm("Write these files?"))) {
    return say("Left alone.");
  }

  const applied = applyRestore(root, steps);
  const failed = applied.filter((step) => step.action === "skipped");
  for (const step of failed) {
    console.log(paint(`  skipped ${step.path}: ${step.note ?? "unknown reason"}`, "yellow"));
  }

  // Reported even when some files were skipped: the request has been dealt
  // with, and leaving it pending would have the website ask again forever.
  await client.request(`/api/runs/${run.id}/restore`, {
    method: "POST",
    body: JSON.stringify({ action: "applied" }),
  });

  const done = applied.length - failed.length;
  console.log(
    `Restored ${done} of ${applied.length} file${applied.length === 1 ? "" : "s"} for r${
      run.sequence
    }.`,
  );
  return failed.length > 0 ? 1 : 0;
}

/**
 * Apply restores as the website asks for them.
 *
 * Polling rather than anything cleverer: the app has no outbound channel to a
 * laptop, and a request that waits ten seconds is a request nobody notices
 * waiting. There is no terminal to confirm on in the usual case — this is left
 * running in a spare pane — so `--yes` is required up front rather than
 * assumed per run.
 */
async function watchRestores(client: Client, options: Options): Promise<number> {
  if (!options.yes) {
    throw new CliError(
      "`--watch` applies restores without asking each time, so it needs `--yes`.\n" +
        "Run it in the project you want restores applied to.",
    );
  }

  const root = projectRoot(options);
  const workspace = await chooseWorkspace(client, projectRoot(options), options);
  console.log(
    `Watching ${client.url} for ${workspace.slug} restores to apply in ${paint(root, "bold")}.`,
  );
  console.log(paint("Ctrl-C to stop.", "dim"));

  for (;;) {
    const { runs } = await client.request<{ runs: RunSummary[] }>(
      `/api/runs?pendingRestore=1&workspaceId=${workspace.id}`,
    );
    for (const summary of runs) {
      const run = await client.request<RunDetail>(`/api/runs/${summary.id}`);
      console.log();
      await applyRun(client, run, { ...options, yes: true });
    }
    await new Promise((done) => setTimeout(done, WATCH_INTERVAL_MS));
  }
}

// Long enough not to hammer the app from a pane left open all afternoon, short
// enough that clicking Restore on the website feels answered.
const WATCH_INTERVAL_MS = 10_000;

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
