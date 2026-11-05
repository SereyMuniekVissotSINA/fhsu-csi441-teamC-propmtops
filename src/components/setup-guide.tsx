"use client";

import { useState } from "react";

import { action, field } from "@/lib/ui";

// The landing page's "connect your editor" guide.
//
// A client component because of the clipboard and the live-templated config:
// the project path and the API key are typed in here and substituted into the
// JSON, so what gets copied is the reader's own config rather than a snippet
// they have to hand-edit and get wrong.
//
// Every value here is the real contract, not an illustration:
//   - the server is `src/mcp/index.ts`, launched with `bun`, over stdio
//   - credentials come from `POPS_URL` and `POPS_API_KEY`, the names
//     `src/cli/config.ts` reads — never from `.env`
//   - it is a client of the running web app, so `bun run dev` has to be up
// Keep this in step with `.vscode/mcp.json` and the README if any of that moves.

type Platform = "macos" | "windows";

/**
 * Example project locations, used only as input placeholders. Node's `homedir()`
 * backs the credentials path on both platforms, which is why Windows gets a
 * `.config` folder under the user profile rather than AppData.
 */
const PLATFORMS: Record<
  Platform,
  { label: string; samplePath: string; configPath: string; shell: string }
> = {
  macos: {
    label: "macOS / Linux",
    samplePath: "/Users/you/Prompt_Ops",
    configPath: "~/.config/promptops/config.json",
    shell: "Terminal (zsh or bash)",
  },
  windows: {
    label: "Windows",
    samplePath: "C:\\Users\\you\\Prompt_Ops",
    configPath: "%USERPROFILE%\\.config\\promptops\\config.json",
    shell: "PowerShell",
  },
};

const TOOLS = [
  ["list_prompts", "id, title, version count, workspace"],
  ["get_prompt", "current body, tags, {{variables}}, version history"],
  ["create_prompt", "saves a new prompt from the editor"],
  ["append_version", "appends a version; omitted fields carry forward"],
  ["compose", "fills {{variables}} and returns the text — stores nothing"],
] as const;

/**
 * Copy to clipboard with a visible outcome.
 *
 * The failure branch is not decoration: `navigator.clipboard` is undefined
 * outside a secure context, so a reader on a plain-HTTP host would otherwise
 * click a button that silently does nothing.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className={`${action} px-3 py-1.5 text-xs`}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
    </button>
  );
}

function Block({
  title,
  hint,
  code,
  label,
}: {
  title: string;
  hint?: string;
  code: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200">{title}</p>
          {hint ? <p className="mt-0.5 text-xs text-zinc-500">{hint}</p> : null}
        </div>
        <CopyButton value={code} label={label} />
      </div>
      {/* Wide code scrolls inside its own box rather than widening the page. */}
      <pre className="overflow-x-auto px-4 py-3 text-xs leading-6 text-zinc-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function SetupGuide() {
  const [platform, setPlatform] = useState<Platform>("macos");
  const [projectPath, setProjectPath] = useState("");
  const [apiKey, setApiKey] = useState("");

  const chosen = PLATFORMS[platform];
  const path = projectPath.trim() || chosen.samplePath;
  const key = apiKey.trim() || "pops_your_key_here";

  // Built as an object and serialized, so a Windows path's backslashes are
  // escaped correctly instead of producing JSON that will not parse.
  const mcpConfig = JSON.stringify(
    {
      servers: {
        "prompt-ops": {
          type: "stdio",
          command: "bun",
          args: ["src/mcp/index.ts"],
          cwd: path,
          env: { POPS_URL: "http://localhost:3000", POPS_API_KEY: key },
        },
      },
    },
    null,
    2,
  );

  const setupCommands = [
    "bun install",
    "bun run db:migrate",
    "bun run dev",
  ].join("\n");

  const keyCommands = [
    "bun run pops auth login --email you@example.com",
    'bun run pops keys create --name "my editor" --save',
    "bun run pops whoami",
  ].join("\n");

  return (
    <section id="connect" className="mx-auto max-w-6xl scroll-mt-8 px-6 pb-24">
      <h2 className="mb-3 text-2xl font-semibold">Connect your editor</h2>
      <p className="mb-8 max-w-3xl text-sm leading-6 text-zinc-400">
        PromptOps ships an MCP server, so an editor agent can list prompts, read one, save a
        new one and append versions without leaving the editor. Fill in your project path and
        workspace key below and the config updates as you type.
      </p>

      {/* One row of controls above the blocks they change. */}
      <div className="mb-6 flex flex-wrap items-end gap-6">
        <div>
          <span className="mb-2 block text-xs tracking-wide text-zinc-500 uppercase">
            Platform
          </span>
          <div className="flex gap-2">
            {(Object.keys(PLATFORMS) as Platform[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPlatform(option)}
                aria-pressed={option === platform}
                className={
                  option === platform
                    ? "rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white"
                    : "rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:text-white"
                }
              >
                {PLATFORMS[option].label}
              </button>
            ))}
          </div>
        </div>

        <label className="min-w-64 flex-1">
          <span className="mb-2 block text-xs tracking-wide text-zinc-500 uppercase">
            Project folder
          </span>
          <input
            className={field}
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
            placeholder={chosen.samplePath}
            spellCheck={false}
            aria-label="Absolute path to your Prompt_Ops checkout"
          />
        </label>

        <label className="min-w-64 flex-1">
          <span className="mb-2 block text-xs tracking-wide text-zinc-500 uppercase">
            Workspace API key
          </span>
          <input
            className={field}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="pops_your_key_here"
            spellCheck={false}
            aria-label="Workspace API key beginning pops_"
          />
        </label>
      </div>

      <ol className="space-y-6">
        <li>
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">
            1. Start the app in {chosen.shell}
          </h3>
          <p className="mb-3 text-sm text-zinc-400">
            The MCP server is a client of the running web app, not a second way into the
            database, so leave <code className="text-emerald-400">bun run dev</code> running in
            its own terminal. Needs <code className="text-emerald-400">DATABASE_URL</code> and{" "}
            <code className="text-emerald-400">AUTH_SECRET</code> in{" "}
            <code className="text-emerald-400">.env</code> first.
          </p>
          <Block
            title="Install and run"
            hint="Same commands on both platforms — bun smooths over the shell differences."
            code={setupCommands}
            label="setup commands"
          />
        </li>

        <li>
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">
            2. Create a workspace API key
          </h3>
          <p className="mb-3 text-sm text-zinc-400">
            The key is shown once and only its hash is stored.{" "}
            <code className="text-emerald-400">--save</code> writes it to{" "}
            <code className="text-emerald-400">{chosen.configPath}</code>, which is where the
            server looks when no environment variable is set. It does not belong in{" "}
            <code className="text-emerald-400">.env</code>.
          </p>
          <Block title="Get a key" code={keyCommands} label="API key commands" />
        </li>

        <li>
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">
            3. Register the server with your editor
          </h3>
          <p className="mb-3 text-sm text-zinc-400">
            Paste this into your MCP client&apos;s config. <strong>VS Code users can skip it</strong> —
            this repo already ships{" "}
            <code className="text-emerald-400">.vscode/mcp.json</code>, which asks for the key
            once and keeps it in VS Code&apos;s secret storage; just run{" "}
            <strong>MCP: List Servers → prompt-ops → Start</strong> from the Command Palette.
          </p>
          <Block
            title="mcp.json"
            hint={`stdio transport, launched with bun from ${path}`}
            code={mcpConfig}
            label="MCP configuration"
          />
        </li>
      </ol>

      <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h3 className="text-sm font-semibold text-zinc-200">The five tools</h3>
        <dl className="mt-4 space-y-2 text-sm">
          {TOOLS.map(([name, description]) => (
            <div key={name} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <dt className="font-mono text-xs text-emerald-400 sm:w-40 sm:shrink-0 sm:pt-0.5">
                {name}
              </dt>
              <dd className="text-zinc-400">{description}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-5 text-zinc-500">
          Running a prompt against a model and anything administrative are deliberately absent:
          a workspace key acts as an editor, and the calling agent already has its own model.
        </p>
      </div>
    </section>
  );
}
