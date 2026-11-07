import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";

import { UNFILED } from "@/lib/agent-runs";
import { variableNames } from "@/lib/prompts-core";

import { CliError, createClient, type Client } from "./client";
import { configPath, loadConfig, maskKey } from "./config";
import {
  box,
  changeCount,
  type Column,
  fields,
  paint,
  paintChange,
  records,
  truncate,
  when,
} from "./format";
import { matchPrompt } from "./resolve";
import { activeSnapshot, storedWorkspace, summariseSnapshots } from "./snapshot";
import type {
  Commit,
  KeyRecord,
  PromptDetail,
  PromptSummary,
  RunDetail,
  RunSummary,
  ServerSnapshot,
  WhoAmI,
  Workspace,
} from "./types";

// `pops` with nothing to do — the interactive shell.
//
// It is shaped like a database client, because that is the job: a workspace
// holds prompts, every prompt holds an append-only run of versions, and every
// version can hold commits of generated code. Reading that is browsing a
// catalogue, and `psql` settled how browsing a catalogue should feel long ago —
// a connection you can see, backslash commands that each describe one thing,
// and an expanded display for the records too wide to read as a row.
//
// So the mapping is deliberate: a workspace is the database you connect to with
// `\c`, `\l` lists them, the `\d` family describes prompts, versions, commits,
// snapshots and runs, and `\x` turns a row on its side.
//
// Anything without a leading backslash is handed to the ordinary `pops`
// dispatcher, unchanged. The shell adds no commands of its own and reimplements
// none: `run`, `generate`, `push` and the rest behave exactly as they do from a
// script, which is why the shell cannot drift away from them. What it adds is
// the connection — the workspace it is pointed at is passed to every command
// that takes one, so you type `prompts` rather than `prompts --workspace csi441`
// twenty times in a row.

/**
 * Runs one `pops` command line, the way `main` does. Injected rather than
 * imported so the shell stays off the command module's import cycle.
 */
export type Dispatch = (argv: string[]) => Promise<number>;

export type ShellOptions = {
  dispatch: Dispatch;
  /** The `pops help` text, printed by `\h`. */
  help: string;
  /** `--url` / `--key` typed on the way in: re-applied to every command. */
  overrides: { url?: string; key?: string };
  /** `--workspace`, if the user already knows where they want to be. */
  workspace?: string;
  /** `--root`, for the snapshot commands that read this project's files. */
  root?: string;
};

// `workspace` arrives as a slug to look for and becomes the record that was
// found, so the option is dropped rather than widened.
type Shell = Omit<ShellOptions, "workspace"> & {
  client: Client;
  root: string;
  /** The key the client was built with, watched so `auth login` takes effect. */
  credential: string | undefined;
  me: WhoAmI | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  role: string | null;
  /** The last prompt listing, kept for tab completion rather than for reading. */
  prompts: PromptSummary[];
  expanded: boolean;
  timing: boolean;
};

const TITLE = "Prompt OPS";

// --- the loop ---------------------------------------------------------------

export async function startShell(options: ShellOptions): Promise<number> {
  const shell: Shell = {
    ...options,
    client: createClient(options.overrides),
    root: resolve(options.root ?? process.cwd()),
    credential: loadConfig().key,
    me: null,
    workspaces: [],
    workspace: null,
    role: null,
    prompts: [],
    expanded: false,
    timing: false,
  };

  // Name the window, so a pane left open among six others says what it is.
  if (process.stdout.isTTY) process.stdout.write(`\u001b]0;${TITLE}\u0007`);
  console.log(banner(shell));
  await connect(shell, options.workspace);
  console.log(
    paint("Type \\? for the backslash commands, \\h for the pops reference, \\q to quit.", "dim"),
  );

  const reader = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    // readline keeps history newest-first; the file is written oldest-first,
    // the way a shell history file reads.
    history: readHistory().reverse(),
    historySize: 500,
    removeHistoryDuplicates: true,
    completer: (line: string) => complete(shell, line),
  });

  // A half-typed quoted string spans lines, which is how a prompt body with
  // paragraphs in it gets typed at all.
  const read = lineSource(reader);
  const buffer: string[] = [];
  try {
    for (;;) {
      const input = await read(prompting(shell, buffer.length > 0));
      if (input.kind === "eof") break;
      if (input.kind === "cancel") {
        buffer.length = 0;
        continue;
      }

      const whole = [...buffer, input.text].join("\n");
      const parsed = tokenize(whole);
      if (parsed.open) {
        buffer.push(input.text);
        continue;
      }
      buffer.length = 0;
      if (parsed.tokens.length === 0) continue;

      const started = performance.now();
      let quit = false;
      try {
        quit = await execute(shell, parsed.tokens);
      } catch (error) {
        report(error);
      }
      if (shell.timing) {
        console.log(paint(`Time: ${(performance.now() - started).toFixed(3)} ms`, "dim"));
      }
      if (quit) break;
    }
  } finally {
    writeHistory(reader);
    reader.close();
  }

  return 0;
}

function banner(shell: Shell): string {
  const config = loadConfig();
  const lines = [
    `${paint(TITLE, "bold")} ${paint(version(), "dim")} — prompts, their versions, and the code they generated`,
    paint(`Connected to ${shell.client.url}`, "dim"),
  ];
  // Startable with no credential on purpose: `auth login` is a command you can
  // type at this prompt, and `\?` and `\h` are worth reading before you have one.
  if (!shell.client.hasKey) {
    lines.push(
      paint(
        "No API key yet, so nothing can be read. Sign in from here:\n" +
          "  auth login --email you@example.com\n" +
          '  keys create --name "my laptop" --save',
        "yellow",
      ),
    );
  } else if (config.key) {
    lines.push(paint(`Key ${maskKey(config.key)}`, "dim"));
  }
  return lines.join("\n");
}

/**
 * `csi441=#` when you own the workspace, `csi441=>` when you do not — the
 * distinction psql draws between a superuser and everyone else, and one that
 * matters here too: owners mint keys and move members, editors cannot.
 */
function prompting(shell: Shell, continued: boolean): string {
  const left = shell.workspace?.slug ?? "pops";
  // Unpainted on purpose: readline measures the prompt to place the cursor, and
  // it counts escape codes as characters.
  return `${left}${continued ? "-" : "="}${shell.role === "OWNER" ? "#" : ">"} `;
}

type Input = { kind: "line"; text: string } | { kind: "cancel" } | { kind: "eof" };

/**
 * A line at a time, or the two ways a terminal says "not a line": ^C abandons
 * what is typed and ^D ends the session, as in psql.
 *
 * The listeners are attached once and what they catch is queued, rather than
 * subscribing afresh for each line. readline goes on delivering lines while a
 * command is still running — someone types the next one, or pastes five at
 * once — and a listener attached per line would be absent exactly then, so
 * those lines would vanish without a trace.
 */
function lineSource(reader: Interface): (prompt: string) => Promise<Input> {
  const queue: Input[] = [];
  let waiting: ((input: Input) => void) | null = null;

  const offer = (input: Input) => {
    if (waiting) {
      const resume = waiting;
      waiting = null;
      resume(input);
      return;
    }
    queue.push(input);
  };

  reader.on("line", (text: string) => offer({ kind: "line", text }));
  reader.on("SIGINT", () => {
    // Clear the typed line the way ^U does, so the next prompt starts empty.
    reader.write(null, { ctrl: true, name: "u" });
    process.stdout.write("\n");
    offer({ kind: "cancel" });
  });
  reader.on("close", () => {
    process.stdout.write("\n");
    offer({ kind: "eof" });
  });

  return (prompt: string) => {
    const queued = queue.shift();
    if (queued) {
      // Typed ahead, so it was never echoed under a prompt of its own. Writing
      // it out keeps the transcript readable.
      if (queued.kind === "line") process.stdout.write(`${prompt}${queued.text}\n`);
      return Promise.resolve(queued);
    }
    reader.setPrompt(prompt);
    reader.prompt();
    return new Promise<Input>((done) => {
      waiting = done;
    });
  };
}

/** True when the shell should stop. */
async function execute(shell: Shell, tokens: string[]): Promise<boolean> {
  if (tokens[0].startsWith("\\")) return meta(shell, tokens);

  // A shell inside the shell would nest two readlines on one stdin, and the
  // outer one would never see another keystroke.
  if (tokens[0] === "shell" || tokens[0] === "console") {
    console.log(`Already in the ${TITLE} shell. \\q leaves it.`);
    return false;
  }
  if (tokens[0] === "exit" || tokens[0] === "quit") return true;

  await shell.dispatch(command(shell, tokens));

  // `auth login` and `keys create --save` rewrite the credential under us; a
  // client built before that would keep using the old one for the backslash
  // commands, which reads as the login not having worked.
  const credential = loadConfig().key;
  if (credential !== shell.credential) {
    shell.credential = credential;
    shell.client = createClient(shell.overrides);
    shell.me = null;
    shell.workspaces = [];
    await connect(shell, shell.workspace?.slug);
  }
  return false;
}

/**
 * The argv a typed command actually runs with.
 *
 * The connection is the point of the shell: the workspace you are in is passed
 * down, and so are the overrides it was started with, so a command behaves the
 * same inside as it would outside. Anything the user typed wins — this only
 * fills in what was left out.
 */
function command(shell: Shell, tokens: string[]): string[] {
  const argv = [...tokens];
  const given = (flag: string) =>
    tokens.some((token) => token === flag || token.startsWith(`${flag}=`));

  if (shell.workspace && !given("--workspace")) argv.push("--workspace", shell.workspace.slug);
  if (shell.overrides.url && !given("--url")) argv.push("--url", shell.overrides.url);
  if (shell.overrides.key && !given("--key")) argv.push("--key", shell.overrides.key);
  if (shell.root !== process.cwd() && !given("--root")) argv.push("--root", shell.root);
  return argv;
}

function report(error: unknown): void {
  if (error instanceof CliError) {
    console.error(paint(`error: ${error.message}`, "red"));
    return;
  }
  // parseArgs on an unknown flag: readable already, and `\h` has the list.
  if (error instanceof Error && error.name === "TypeError" && /option/i.test(error.message)) {
    console.error(paint(`error: ${error.message}`, "red"));
    return;
  }
  console.error(error);
}

// --- backslash commands -----------------------------------------------------

type MetaSpec = { group: string; name: string; args?: string; blurb: string };

const META: MetaSpec[] = [
  { group: "General", name: "\\q", blurb: "quit (so does ^D)" },
  { group: "General", name: "\\?", blurb: "this list" },
  { group: "General", name: "\\h", blurb: "the pops command reference" },
  { group: "General", name: "\\timing", args: "[on|off]", blurb: "time every command" },
  { group: "Connection", name: "\\c", args: "[workspace]", blurb: "connect to a workspace" },
  { group: "Connection", name: "\\conninfo", blurb: "app, credential, workspace, role" },
  { group: "Catalogue", name: "\\l", args: "[+]", blurb: "workspaces (+ their ids)" },
  { group: "Catalogue", name: "\\du", blurb: "members of this workspace, and their roles" },
  { group: "Catalogue", name: "\\dk", blurb: "API keys of this workspace (owners only)" },
  { group: "Catalogue", name: "\\dp", args: "[+] [pattern]", blurb: "prompts (+ their tags)" },
  { group: "Catalogue", name: "\\ds", args: "[+]", blurb: "snapshots and local drift (+ archived)" },
  { group: "Catalogue", name: "\\dr", args: "[rN]", blurb: "agent runs, or one run's files" },
  { group: "Describe", name: "\\d", args: "<prompt>", blurb: "describe a prompt in full" },
  { group: "Describe", name: "\\dv", args: "<prompt> [vN]", blurb: "version history, or one version" },
  { group: "Describe", name: "\\dc", args: "<prompt> [cN]", blurb: "code commits, or one commit" },
  { group: "Describe", name: "\\sv", args: "<prompt> [vN]", blurb: "print a version's body" },
  { group: "Display", name: "\\x", args: "[on|off]", blurb: "expanded output, one field per line" },
];

async function meta(shell: Shell, tokens: string[]): Promise<boolean> {
  // `\dt+` in psql means "the same, with more". Same here: the plus is part of
  // the name as typed, and an argument to the handler.
  const plus = tokens[0].endsWith("+") || tokens[1] === "+";
  const name = tokens[0].replace(/\+$/, "");
  const args = tokens.slice(1).filter((token) => token !== "+");

  switch (name) {
    case "\\q":
    case "\\quit":
      return true;
    case "\\?":
    case "\\help":
      console.log(help());
      return false;
    case "\\h":
      console.log(shell.help);
      return false;
    case "\\x":
      shell.expanded = toggle(shell.expanded, args[0]);
      console.log(`Expanded display is ${shell.expanded ? "on" : "off"}.`);
      return false;
    case "\\timing":
      shell.timing = toggle(shell.timing, args[0]);
      console.log(`Timing is ${shell.timing ? "on" : "off"}.`);
      return false;
    case "\\c":
    case "\\connect":
      await reconnect(shell, args[0]);
      return false;
    case "\\conninfo":
      await conninfo(shell);
      return false;
    case "\\l":
    case "\\list":
      await listWorkspaces(shell, plus);
      return false;
    case "\\du":
      await listMembers(shell);
      return false;
    case "\\dk":
      await listKeys(shell);
      return false;
    // Bare `\d` lists the relations, as in psql; with a name it describes one.
    case "\\d":
      if (args.length === 0) await listPrompts(shell, plus, undefined);
      else await describePrompt(shell, args[0]);
      return false;
    case "\\dp":
      await listPrompts(shell, plus, args[0]);
      return false;
    case "\\dv":
      await describeVersions(shell, args[0], args[1]);
      return false;
    case "\\sv":
      await printVersion(shell, args[0], args[1]);
      return false;
    case "\\dc":
      await describeCommits(shell, args[0], args[1]);
      return false;
    case "\\ds":
      await listSnapshots(shell, plus);
      return false;
    case "\\dr":
      await listRuns(shell, args[0]);
      return false;
    default:
      console.error(paint(`invalid command ${name}`, "red"));
      console.error(
        paint("Try \\? for the list, or type a pops command without a backslash.", "dim"),
      );
      return false;
  }
}

function help(): string {
  const lines: string[] = [];
  for (const group of [...new Set(META.map((entry) => entry.group))]) {
    const rows = META.filter((entry) => entry.group === group);
    const width = Math.max(
      ...rows.map((entry) => `${entry.name} ${entry.args ?? ""}`.trimEnd().length),
    );
    lines.push(paint(group, "bold"));
    for (const entry of rows) {
      const left = `${entry.name} ${entry.args ?? ""}`.trimEnd();
      lines.push(`  ${left.padEnd(width)}  ${paint(entry.blurb, "dim")}`);
    }
    lines.push("");
  }
  lines.push(
    paint(
      "A prompt is named by id, by a 6+ character id prefix, or by part of its title;\n" +
        "quote a title with spaces. A line without a leading backslash runs as a pops\n" +
        "command in the connected workspace — prompts, run <prompt> -v k=v, status, push.",
      "dim",
    ),
  );
  return lines.join("\n");
}

function toggle(current: boolean, word: string | undefined): boolean {
  if (word === undefined) return !current;
  if (/^(on|true|1|yes)$/i.test(word)) return true;
  if (/^(off|false|0|no)$/i.test(word)) return false;
  throw new CliError(`Say \`on\` or \`off\`, not "${word}".`);
}

// --- connection -------------------------------------------------------------

/**
 * Settle which workspace the shell is pointed at.
 *
 * In order: what was asked for, what this project pushes to, or the only one
 * there is. A key reaches exactly one workspace, so in the common case nothing
 * is asked. Failing to reach the app is not fatal — `\?` and `\h` still work,
 * and `auth login` can be typed at the prompt — so it warns and carries on.
 */
async function connect(shell: Shell, wanted?: string): Promise<void> {
  if (!shell.client.hasKey) return;

  try {
    await identify(shell);
    const list = await catalogue(shell);
    const remembered = storedWorkspace(shell.root);
    const chosen =
      (wanted ? find(list, wanted) : undefined) ??
      (remembered ? list.find((entry) => entry.id === remembered) : undefined) ??
      (list.length === 1 ? list[0] : undefined);

    if (wanted && !chosen) throw new CliError(`No workspace "${wanted}" in reach.`);
    if (!chosen) {
      console.log(paint("Several workspaces in reach — \\l lists them, \\c picks one.", "yellow"));
      return;
    }

    enter(shell, chosen);
    console.log(
      paint(
        `Workspace "${chosen.slug}" (${chosen.name}) as ${shell.role?.toLowerCase() ?? "member"}.`,
        "dim",
      ),
    );
  } catch (error) {
    report(error);
    console.error(paint("Not connected to a workspace. Fix the above, then \\c.", "dim"));
  }
}

function enter(shell: Shell, workspace: Workspace): void {
  shell.workspace = workspace;
  shell.role =
    shell.me?.workspaces.find((entry) => entry.workspace.id === workspace.id)?.role ?? null;
  // A listing belongs to the workspace that was open when it was taken, so
  // completion does not go on offering prompts from somewhere else.
  shell.prompts = [];
}

async function reconnect(shell: Shell, wanted: string | undefined): Promise<void> {
  if (!wanted) {
    console.log(
      shell.workspace
        ? `You are connected to workspace "${shell.workspace.slug}".`
        : "Not connected to a workspace. \\l lists them, \\c <slug> connects.",
    );
    return;
  }

  const list = await catalogue(shell, { refresh: true });
  const chosen = find(list, wanted);
  if (!chosen) {
    const slugs = list.map((entry) => entry.slug).join(", ") || "none";
    throw new CliError(`No workspace "${wanted}". You can reach: ${slugs}.`);
  }

  enter(shell, chosen);
  console.log(
    `You are now connected to workspace "${paint(chosen.slug, "bold")}" (${chosen.name}) as ` +
      `${shell.role?.toLowerCase() ?? "member"}.`,
  );
}

async function conninfo(shell: Shell): Promise<void> {
  const me = await identify(shell);
  const rows: string[][] = [
    ["app", shell.client.url],
    ["credential", me.key ? `API key "${me.key.name}" (${me.key.prefix}…)` : "browser session"],
    [
      "writes as",
      me.user
        ? `${me.user.name ?? "unnamed"} <${me.user.email}>`
        : paint("nobody — this credential cannot write", "yellow"),
    ],
    [
      "workspace",
      shell.workspace
        ? `${shell.workspace.slug} (${shell.workspace.name})`
        : paint("none — \\c to connect", "yellow"),
    ],
    ["role", shell.role?.toLowerCase() ?? paint("unknown", "dim")],
    ["project", shell.root],
    ["config", configPath()],
  ];
  console.log(fields(rows, "Connection"));
}

/** `/api/me`, once. It says who writes are attributed to, and what each role is. */
async function identify(shell: Shell): Promise<WhoAmI> {
  if (!shell.me) shell.me = await shell.client.request<WhoAmI>("/api/me");
  return shell.me;
}

async function catalogue(shell: Shell, options: { refresh?: boolean } = {}): Promise<Workspace[]> {
  if (options.refresh || shell.workspaces.length === 0) {
    shell.workspaces = await shell.client.request<Workspace[]>("/api/workspaces");
  }
  return shell.workspaces;
}

function find(list: Workspace[], needle: string): Workspace | undefined {
  const term = needle.trim().toLowerCase();
  return (
    list.find((entry) => entry.slug.toLowerCase() === term || entry.id === needle.trim()) ??
    list.find((entry) => entry.name.toLowerCase() === term) ??
    list.find((entry) => entry.slug.toLowerCase().includes(term))
  );
}

/** Where the backslash commands act. There is nothing to describe without it. */
function here(shell: Shell): Workspace {
  if (!shell.workspace) {
    throw new CliError("Not connected to a workspace. \\l lists them, \\c <slug> connects.");
  }
  return shell.workspace;
}

// --- listings ---------------------------------------------------------------

function display(shell: Shell, columns: Column[], rows: string[][], title?: string): void {
  console.log(shell.expanded ? records(columns, rows) : box(columns, rows, title));
}

async function listWorkspaces(shell: Shell, plus: boolean): Promise<void> {
  const list = await catalogue(shell, { refresh: true });
  const me = await identify(shell);
  const role = (id: string) =>
    me.workspaces.find((entry) => entry.workspace.id === id)?.role.toLowerCase() ?? "—";

  const columns: Column[] = [
    { name: "" },
    { name: "Slug" },
    { name: "Name" },
    { name: "Role" },
    { name: "Prompts", align: "right" },
    { name: "Members", align: "right" },
  ];
  if (plus) columns.push({ name: "Id" });

  display(
    shell,
    columns,
    list.map((workspace) => {
      const row = [
        workspace.id === shell.workspace?.id ? paint("*", "green") : "",
        workspace.slug,
        workspace.name,
        role(workspace.id),
        String(workspace._count.prompts),
        String(workspace.members.length),
      ];
      if (plus) row.push(workspace.id);
      return row;
    }),
    "Workspaces",
  );
  if (shell.workspace) console.log(paint("* connected", "dim"));
}

async function listMembers(shell: Shell): Promise<void> {
  const workspace = here(shell);
  // Membership comes back with the workspace, so this costs no extra request —
  // and it is readable by a key, where the member-management routes are not.
  const fresh = find(await catalogue(shell, { refresh: true }), workspace.slug) ?? workspace;

  display(
    shell,
    [{ name: "Role" }, { name: "Name" }, { name: "Email" }],
    [...fresh.members]
      .sort((left, right) => left.role.localeCompare(right.role))
      .map((member) => [
        member.role.toLowerCase(),
        member.user.name ?? paint("unnamed", "dim"),
        member.user.email,
      ]),
    `Members of "${fresh.slug}"`,
  );
}

async function listKeys(shell: Shell): Promise<void> {
  const workspace = here(shell);
  if (!shell.client.hasSession) {
    throw new CliError(
      "Keys are owners only, and a key cannot list keys — that is what stops one minting\n" +
        "another. Sign in first: auth login --email you@example.com",
    );
  }

  const list = await shell.client.sessionRequest<KeyRecord[]>(
    `/api/workspaces/${workspace.id}/keys`,
  );
  const stored = loadConfig().key;

  display(
    shell,
    [
      { name: "Key" },
      { name: "Name" },
      { name: "Status" },
      { name: "Created" },
      { name: "Last used" },
    ],
    list.map((record) => [
      // Mark the one this shell holds, so revoking does not silently log the
      // terminal out of itself.
      stored?.startsWith(record.prefix)
        ? paint(`${record.prefix}… *`, "cyan")
        : `${record.prefix}…`,
      truncate(record.name, 24),
      record.revokedAt ? paint("revoked", "yellow") : paint("active", "green"),
      when(record.createdAt),
      record.lastUsedAt ? when(record.lastUsedAt) : paint("never", "dim"),
    ]),
    `API keys of "${workspace.slug}"`,
  );
  if (list.some((record) => stored?.startsWith(record.prefix))) {
    console.log(paint("* the key this shell is using", "dim"));
  }
}

async function promptsIn(shell: Shell): Promise<PromptSummary[]> {
  const workspace = here(shell);
  // Always re-read: a `new` or an `edit` typed a moment ago should show up, and
  // the listing doubles as the completion cache.
  shell.prompts = await shell.client.request<PromptSummary[]>(
    `/api/prompts?workspaceId=${workspace.id}`,
  );
  return shell.prompts;
}

async function listPrompts(
  shell: Shell,
  plus: boolean,
  pattern: string | undefined,
): Promise<void> {
  const all = await promptsIn(shell);
  const term = pattern?.trim().toLowerCase();
  const list = term
    ? all.filter(
        (prompt) => prompt.title.toLowerCase().includes(term) || prompt.id.startsWith(term),
      )
    : all;

  const columns: Column[] = [
    { name: "Id" },
    { name: "Title" },
    { name: "Versions", align: "right" },
    { name: "Variables", align: "right" },
    { name: "Updated" },
  ];
  if (plus) columns.push({ name: "Tags" });

  display(
    shell,
    columns,
    list.map((prompt) => {
      const latest = prompt.versions[0];
      const row = [
        prompt.id.slice(0, 8),
        truncate(prompt.title, 44),
        String(prompt._count.versions),
        String(latest ? variableNames(latest.body).length : 0),
        when(prompt.updatedAt),
      ];
      if (plus) row.push(latest?.tags || paint("—", "dim"));
      return row;
    }),
    term ? `Prompts matching "${pattern}"` : `Prompts in "${here(shell).slug}"`,
  );

  if (all.length === 0) {
    console.log(paint('Nothing here yet: new --title "…" --body "…"', "dim"));
  } else if (list.length === 0) {
    console.log(paint("Nothing matched. \\dp with no pattern lists them all.", "dim"));
  }
}

// --- describing one thing ---------------------------------------------------

/** Resolve what was typed to one prompt, then fetch it in full. */
async function locate(shell: Shell, needle: string | undefined): Promise<PromptDetail> {
  if (!needle) {
    throw new CliError("Which prompt? An id, a 6+ character id prefix, or part of its title.");
  }
  const match = matchPrompt(await promptsIn(shell), needle);
  if (match.kind === "none") throw new CliError(`No prompt matches "${needle}". \\dp lists them.`);
  if (match.kind === "many") {
    const lines = match.candidates
      .map((candidate) => `  ${candidate.id.slice(0, 8)}  ${candidate.title}`)
      .join("\n");
    throw new CliError(`"${needle}" matches several prompts:\n${lines}`);
  }
  return shell.client.request<PromptDetail>(`/api/prompts/${match.value.id}`);
}

/** Oldest first, so the first version is v1 — the numbering the web UI prints. */
function ordered(prompt: PromptDetail) {
  return [...prompt.versions].reverse();
}

/**
 * The centrepiece: everything about one prompt on one screen.
 *
 * Shaped like `\d` on a table — the fields in a box, the related objects
 * underneath — because the related objects are the interesting part here. A
 * prompt is a title and a body; its history and the code it generated are what
 * you came to look at.
 */
async function describePrompt(shell: Shell, needle: string): Promise<void> {
  const prompt = await locate(shell, needle);
  const versions = ordered(prompt);
  const [latest] = prompt.versions;
  const variables = variableNames(latest.body);

  const summary: string[][] = [
    ["id", prompt.id],
    ["workspace", `${prompt.workspace.slug} (${prompt.workspace.name})`],
    ["title", latest.title],
    ["versions", `${versions.length} (v1..v${versions.length})`],
    [
      "variables",
      variables.length > 0
        ? variables.map((name) => `{{${name}}}`).join(" ")
        : paint("none", "dim"),
    ],
    ["tags", latest.tags || paint("none", "dim")],
    ["body", `${latest.body.length} characters, ${latest.body.split("\n").length} lines`],
    ["updated", `${when(latest.createdAt)} by ${latest.author?.name ?? "unknown"}`],
  ];
  console.log(fields(summary, `Prompt "${truncate(latest.title, 48)}"`));

  console.log(paint("Versions:", "bold"));
  for (const [index, version] of versions.entries()) {
    console.log(
      `    ${paint(`v${index + 1}`, "cyan")}  ${truncate(version.note || "—", 40).padEnd(42)}` +
        paint(`${version.author?.name ?? "unknown"} · ${when(version.createdAt)}`, "dim"),
    );
  }

  // History is readable wherever the app runs, but a workspace that has never
  // generated anything may answer this one unhappily, and a prompt is worth
  // describing either way.
  try {
    const { commits } = await shell.client.request<{ commits: Commit[] }>(
      `/api/prompts/${prompt.id}/commits`,
    );
    if (commits.length > 0) {
      console.log(paint("Code commits:", "bold"));
      for (const entry of commits) {
        console.log(
          `    ${paint(`c${entry.sequence}`, "cyan")}  ${truncate(entry.message, 40).padEnd(42)}` +
            `${entry.stats.files} file${entry.stats.files === 1 ? "" : "s"} ` +
            `${changeCount(entry.stats.added, entry.stats.removed)}` +
            paint(` · ${when(entry.createdAt)}`, "dim"),
        );
      }
    }
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(paint(`Code commits: unavailable (${error.message})`, "dim"));
  }

  const named = quote(needle);
  console.log(
    paint(
      `\\sv ${named} prints the body, \\dv ${named} the history, \\dc ${named} the commits.`,
      "dim",
    ),
  );
}

async function describeVersions(
  shell: Shell,
  needle: string | undefined,
  ref: string | undefined,
): Promise<void> {
  const prompt = await locate(shell, needle);
  const versions = ordered(prompt);

  if (ref) {
    const version = pick(versions, ref, "v");
    const at = versions.indexOf(version) + 1;
    // One version is read as fields whatever `\x` says, so it ignores it.
    console.log(
      fields(
        [
          ["version", `v${at} of ${versions.length}`],
          ["id", version.id],
          ["title", version.title],
          ["note", version.note || "—"],
          ["tags", version.tags || "—"],
          ["author", version.author?.name ?? "unknown"],
          ["created", when(version.createdAt)],
          [
            "variables",
            variableNames(version.body)
              .map((name) => `{{${name}}}`)
              .join(" ") || "none",
          ],
          ["body", `${version.body.length} characters`],
        ],
        `Version v${at} of "${truncate(prompt.title, 40)}"`,
      ),
    );
    console.log(paint(`\\sv ${quote(needle ?? "")} v${at} prints the body.`, "dim"));
    return;
  }

  display(
    shell,
    [
      { name: "V", align: "right" },
      { name: "Note" },
      { name: "Author" },
      { name: "Chars", align: "right" },
      { name: "Created" },
    ],
    versions
      .map((version, index) => [
        paint(`v${index + 1}`, "cyan"),
        truncate(version.note || "—", 40),
        version.author?.name ?? "unknown",
        String(version.body.length),
        when(version.createdAt),
      ])
      .reverse(),
    `Versions of "${truncate(prompt.title, 40)}"`,
  );
  console.log(
    paint(`history ${quote(needle ?? "")} v1..v${versions.length} diffs two of them.`, "dim"),
  );
}

async function printVersion(
  shell: Shell,
  needle: string | undefined,
  ref: string | undefined,
): Promise<void> {
  const prompt = await locate(shell, needle);
  const versions = ordered(prompt);
  const version = ref ? pick(versions, ref, "v") : versions[versions.length - 1];
  const at = versions.indexOf(version) + 1;

  console.log(
    paint(`-- ${prompt.title} · v${at} of ${versions.length} · ${version.note || "no note"}`, "dim"),
  );
  console.log(version.body);
}

async function describeCommits(
  shell: Shell,
  needle: string | undefined,
  ref: string | undefined,
): Promise<void> {
  const prompt = await locate(shell, needle);
  const { commits } = await shell.client.request<{ commits: Commit[] }>(
    `/api/prompts/${prompt.id}/commits`,
  );
  if (commits.length === 0) {
    console.log(`No generated code for "${prompt.title}" yet: generate ${quote(needle ?? "")}`);
    return;
  }

  if (ref) {
    // The listing is newest first; c1 is the oldest, so number from that end.
    const summary = pick([...commits].reverse(), ref, "c");
    const detail = await shell.client.request<Commit>(
      `/api/prompts/${prompt.id}/commits/${summary.id}`,
    );
    console.log(
      fields(
        [
          ["commit", `c${detail.sequence}`],
          ["id", detail.id],
          ["message", detail.message],
          ["parent", detail.parentId ?? "none — this is the first"],
          ["prompt", prompt.title],
          ["model", detail.model],
          ["elapsed", `${(detail.elapsedMs / 1000).toFixed(1)}s`],
          [
            "tokens",
            detail.outputTokens === null
              ? "not recorded"
              : `${detail.inputTokens ?? 0} in / ${detail.outputTokens} out`,
          ],
          ["truncated", detail.incomplete ? "yes — the model hit its output limit" : "no"],
          ["author", detail.authorName ?? "unknown"],
          ["created", when(detail.createdAt)],
        ],
        `Commit c${detail.sequence} of "${truncate(prompt.title, 40)}"`,
      ),
    );
    console.log(paint("Files:", "bold"));
    for (const file of detail.files) {
      console.log(
        `    ${paintChange(file.change)} ${file.path.padEnd(42)}` +
          `${changeCount(file.added, file.removed)} ${paint(file.language, "dim")}`,
      );
    }
    console.log(
      paint(
        `commit ${quote(needle ?? "")} c${detail.sequence} --diff shows the lines.`,
        "dim",
      ),
    );
    return;
  }

  display(
    shell,
    [
      { name: "C", align: "right" },
      { name: "Message" },
      { name: "Files", align: "right" },
      { name: "Lines" },
      { name: "Model" },
      { name: "Created" },
    ],
    commits.map((entry) => [
      paint(`c${entry.sequence}`, "cyan"),
      truncate(entry.message, 36),
      String(entry.stats.files),
      changeCount(entry.stats.added, entry.stats.removed) || paint("—", "dim"),
      entry.model,
      when(entry.createdAt),
    ]),
    `Code commits of "${truncate(prompt.title, 40)}"`,
  );
}

/** `v3`, `3`, `c2` — the numbering every listing prints, resolved against it. */
function pick<T>(list: T[], ref: string, letter: "v" | "c"): T {
  const match = new RegExp(`^${letter}?(\\d+)$`, "i").exec(ref.trim());
  const at = match ? Number(match[1]) : 0;
  const chosen = at > 0 ? list[at - 1] : undefined;
  if (!chosen) {
    throw new CliError(
      `No ${letter}${ref.replace(new RegExp(`^${letter}`, "i"), "")} here; ` +
        `this has ${letter}1..${letter}${list.length}.`,
    );
  }
  return chosen;
}

// --- snapshots and runs -----------------------------------------------------

/**
 * The branches of this workspace, and how far this machine has drifted from
 * each baseline.
 *
 * Two sources, as in `pops snapshots`: the server owns the branch and its runs,
 * and only this disk knows what has changed since the baseline. Merging them is
 * the whole value — a branch with runs but no baseline here is still somewhere
 * a push can go.
 */
async function listSnapshots(shell: Shell, archived: boolean): Promise<void> {
  const workspace = here(shell);
  const { snapshots: remote } = await shell.client.request<{ snapshots: ServerSnapshot[] }>(
    `/api/snapshots?workspaceId=${workspace.id}&archived=${archived ? "1" : "0"}`,
  );

  const { rows } = summariseSnapshots(shell.root);
  const local = new Map(rows.map((row) => [row.slug, row]));
  const active = activeSnapshot(shell.root)?.slug;

  const lines: string[][] = [];
  const seen = new Set<string>();

  for (const entry of remote) {
    seen.add(entry.slug);
    const copy = local.get(entry.slug);
    lines.push([
      copy && copy.slug === active ? paint("*", "green") : "",
      entry.name,
      String(entry.runs),
      copy ? String(copy.files) : paint("—", "dim"),
      copy?.changed === undefined || copy.changed === null
        ? paint("—", "dim")
        : String(copy.changed),
      copy?.takenAt ? when(copy.takenAt) : paint("not here", "dim"),
      entry.archivedAt ? paint("archived", "yellow") : "open",
    ]);
  }
  // A baseline this machine holds that the workspace does not know about: one
  // taken while the app was down. The next `snapshot` under that name files it.
  for (const row of rows) {
    if (seen.has(row.slug)) continue;
    lines.push([
      row.slug === active ? paint("*", "green") : "",
      row.name,
      paint("—", "dim"),
      String(row.files),
      row.changed === null ? paint("—", "dim") : String(row.changed),
      row.takenAt ? when(row.takenAt) : paint("never", "dim"),
      paint("local only", "dim"),
    ]);
  }

  display(
    shell,
    [
      { name: "" },
      { name: "Name" },
      { name: "Runs", align: "right" },
      { name: "Files", align: "right" },
      { name: "Changed", align: "right" },
      { name: "Baseline" },
      { name: "State" },
    ],
    lines,
    `Snapshots of "${workspace.slug}"`,
  );
  console.log(
    paint(`* the active baseline in ${shell.root}; status --diff shows the drift.`, "dim"),
  );
}

async function listRuns(shell: Shell, ref: string | undefined): Promise<void> {
  const workspace = here(shell);
  const { runs } = await shell.client.request<{ runs: RunSummary[] }>(
    `/api/runs?workspaceId=${workspace.id}`,
  );
  if (runs.length === 0) {
    console.log(
      `No agent runs in "${workspace.slug}" yet: snapshot, let an agent work, then push.`,
    );
    return;
  }

  if (ref) {
    const sequence = /^r?(\d+)$/i.exec(ref.trim());
    const summary = sequence
      ? runs.find((candidate) => candidate.sequence === Number(sequence[1]))
      : runs.find((candidate) => candidate.id === ref || candidate.id.startsWith(ref));
    if (!summary) {
      throw new CliError(`No run ${ref} in reach. The newest is r${runs[0].sequence}.`);
    }

    const run = await shell.client.request<RunDetail>(`/api/runs/${summary.id}`);
    console.log(
      fields(
        [
          ["run", `r${run.sequence}`],
          ["id", run.id],
          ["snapshot", run.category || UNFILED],
          ["agent", run.agent],
          ["root", run.root],
          ["asked for", run.prompt || "—"],
          ["summary", run.summary],
          ["account", run.response || "—"],
          ["files", `${run.stats.files} · +${run.stats.added} −${run.stats.removed}`],
          ["author", run.authorName ?? "unknown"],
          ["created", when(run.createdAt)],
          [
            "restore",
            run.restoredAt
              ? `applied ${when(run.restoredAt)}`
              : run.restoreRequestedAt
                ? `asked for ${when(run.restoreRequestedAt)} — restore r${run.sequence} applies it`
                : "not asked for",
          ],
        ],
        `Agent run r${run.sequence} in "${workspace.slug}"`,
      ),
    );
    console.log(paint("Files:", "bold"));
    for (const file of run.files) {
      console.log(
        `    ${paintChange(file.change)} ${file.path.padEnd(42)}` +
          changeCount(file.added, file.removed),
      );
    }
    return;
  }

  display(
    shell,
    [
      { name: "R", align: "right" },
      { name: "Snapshot" },
      { name: "Summary" },
      { name: "Agent" },
      { name: "Files", align: "right" },
      { name: "Lines" },
      { name: "Created" },
    ],
    runs.map((run) => [
      paint(`r${run.sequence}`, "cyan"),
      truncate(run.category || UNFILED, 18),
      truncate(run.summary, 30),
      truncate(run.agent, 16),
      String(run.stats.files),
      changeCount(run.stats.added, run.stats.removed) || paint("—", "dim"),
      when(run.createdAt),
    ]),
    `Agent runs in "${workspace.slug}"`,
  );
  console.log(paint("\\dr r7 opens one; restore r7 puts its pre-run files back.", "dim"));
}

// --- input ------------------------------------------------------------------

/** The `pops` commands, for completion. */
const COMMANDS = [
  "auth",
  "commit",
  "edit",
  "generate",
  "help",
  "history",
  "keys",
  "log",
  "new",
  "prompts",
  "push",
  "restore",
  "run",
  "show",
  "snapshot",
  "snapshots",
  "status",
  "whoami",
  "workspaces",
];

/** The commands that name a prompt, so completion can offer titles. */
const TAKES_PROMPT = new Set([
  "\\d",
  "\\dv",
  "\\dc",
  "\\sv",
  "show",
  "edit",
  "history",
  "run",
  "generate",
  "log",
  "commit",
]);

function complete(shell: Shell, line: string): [string[], string] {
  const words = line.split(/\s+/);
  const word = words[words.length - 1] ?? "";
  const [first] = words;

  if (words.length <= 1) {
    const names = word.startsWith("\\")
      ? META.map((entry) => entry.name)
      : [...COMMANDS, ...META.map((entry) => entry.name)];
    return [narrow(names, word), word];
  }
  if (first === "\\c" || first === "\\connect" || words.at(-2) === "--workspace") {
    return [narrow(shell.workspaces.map((workspace) => workspace.slug), word), word];
  }
  if (TAKES_PROMPT.has(first)) {
    // Titles have spaces in them, so they are offered pre-quoted: inserted bare
    // they would split into two arguments and match nothing.
    return [narrow(shell.prompts.map((prompt) => quote(prompt.title)), word), word];
  }
  return [[], word];
}

function narrow(candidates: string[], word: string): string[] {
  const hits = candidates.filter((candidate) =>
    candidate.toLowerCase().startsWith(word.toLowerCase()),
  );
  // readline shows the whole list when nothing matches, which is the help a
  // blank tab is asking for.
  return hits.length > 0 ? hits : candidates;
}

function quote(text: string): string {
  return /[\s"']/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

/**
 * Split a typed line into arguments, the way a shell would.
 *
 * Quotes group words, and an unclosed quote is reported rather than guessed at:
 * the shell then keeps reading, so a prompt body with paragraphs in it can be
 * typed across several lines and arrive as one argument with its newlines
 * intact. A backslash outside quotes is an ordinary character, because every
 * backslash typed here is the start of a command.
 */
export function tokenize(line: string): { tokens: string[]; open: boolean } {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quoted: '"' | "'" | null = null;

  for (let at = 0; at < line.length; at++) {
    const char = line[at];

    if (quoted) {
      if (char === quoted) {
        quoted = null;
        continue;
      }
      // Only double quotes take escapes, as in a POSIX shell, so a Windows path
      // inside single quotes survives.
      if (char === "\\" && quoted === '"' && at + 1 < line.length) {
        current += line[++at];
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quoted = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }

  if (started && !quoted) tokens.push(current);
  // An unterminated quote leaves the partial token out: the caller re-tokenizes
  // the whole thing once the quote closes.
  return { tokens, open: quoted !== null };
}

// --- history ----------------------------------------------------------------

function historyPath(): string {
  return join(dirname(configPath()), "history");
}

function readHistory(): string[] {
  try {
    return readFileSync(historyPath(), "utf8").split("\n").filter(Boolean);
  } catch {
    // No history yet, or unreadable: start empty rather than complain.
    return [];
  }
}

/**
 * Keep the session's lines for the next one.
 *
 * Lines carrying a credential are dropped. A key typed at this prompt — `auth
 * login --key pops_…` — would otherwise sit in a file on disk long after the
 * terminal was closed, which is the thing `config.json`'s 0600 mode exists to
 * prevent.
 */
function writeHistory(reader: Interface): void {
  try {
    // `history` is readline's own newest-first array, and is not in its public
    // types, which is why this is read defensively rather than declared.
    const lines = ((reader as unknown as { history?: string[] }).history ?? [])
      .filter((line) => !/pops_[A-Za-z0-9]/.test(line) && !line.includes("--password"))
      .slice(0, 500)
      .reverse();
    if (lines.length === 0) return;

    const path = historyPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    // A history file is a convenience; failing to write one is not worth a
    // message on the way out.
  }
}

function version(): string {
  try {
    const parsed = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return parsed.version ?? "";
  } catch {
    // Running from somewhere the package has been stripped out: the banner can
    // do without a version.
    return "";
  }
}
