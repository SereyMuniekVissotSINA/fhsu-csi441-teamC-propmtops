"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { field } from "@/lib/ui";

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
//
// Visual language matches the landing page: 5px corners, native system stacks,
// mono set at 0.9rem/1.9 so a pasted command stays readable at a glance.

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
    shell: "Terminal",
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
 *
 * Its own small ghost style rather than `action` from ui.ts — this sits inside
 * a card header at 0.8rem, where a full-size bordered button would dominate the
 * code it belongs to.
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
      className="rounded-[3px] px-2 py-1 text-[0.8rem] text-zinc-400 transition hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
    </button>
  );
}

/**
 * A terminal-style card: title row with a copy control, then the content in
 * mono. `prompt` draws the leading marker on each line, which is what makes a
 * shell block read as something to run rather than something to read.
 */
function Block({
  title,
  hint,
  code,
  label,
  prompt = false,
}: {
  title: string;
  hint?: string;
  code: string;
  label: string;
  prompt?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[5px] border border-zinc-800 bg-zinc-950/70">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-[0.65rem]">
        <div className="flex min-w-0 items-center gap-[0.7rem]">
          <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
            <i className="block h-2 w-2 rounded-full bg-zinc-700" />
            <i className="block h-2 w-2 rounded-full bg-zinc-700" />
            <i className="block h-2 w-2 rounded-full bg-zinc-700" />
          </span>
          <span className="truncate text-[0.8rem] text-zinc-300">{title}</span>
        </div>
        <CopyButton value={code} label={label} />
      </div>

      {hint ? (
        <p className="border-b border-zinc-800/60 px-4 py-2 text-[0.8rem] text-zinc-500">
          {hint}
        </p>
      ) : null}

      {/* Wide code scrolls inside its own box rather than widening the page. */}
      <pre className="font-system-mono overflow-x-auto px-4 py-[1.1rem] text-[0.9rem] leading-[1.9] text-zinc-200">
        <code>
          {prompt
            ? code.split("\n").map((line) => (
                <span key={line} className="block">
                  <span className="mr-[0.65rem] text-emerald-400" aria-hidden="true">
                    ›
                  </span>
                  {line}
                </span>
              ))
            : code}
        </code>
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

  const setupCommands = ["bun install", "bun run db:migrate", "bun run dev"].join("\n");

  const keyCommands = [
    "bun run pops auth login --email you@example.com",
    'bun run pops keys create --name "my editor" --save',
    "bun run pops whoami",
  ].join("\n");

  const steps = [
    {
      heading: `Start the app in ${chosen.shell}`,
      body: (
        <>
          The MCP server is a client of the running web app, not a second way into the
          database, so leave <Code>bun run dev</Code> running in its own terminal. Needs{" "}
          <Code>DATABASE_URL</Code> and <Code>AUTH_SECRET</Code> in <Code>.env</Code> first.
        </>
      ),
      block: (
        <Block
          title={chosen.shell}
          hint="Same commands on both platforms — bun smooths over the shell differences."
          code={setupCommands}
          label="setup commands"
          prompt
        />
      ),
    },
    {
      heading: "Create a workspace API key",
      body: (
        <>
          The key is shown once and only its hash is stored. <Code>--save</Code> writes it to{" "}
          <Code>{chosen.configPath}</Code>, which is where the server looks when no
          environment variable is set. It does not belong in <Code>.env</Code>.
        </>
      ),
      block: <Block title={chosen.shell} code={keyCommands} label="API key commands" prompt />,
    },
    {
      heading: "Register the server with your editor",
      body: (
        <>
          Paste this into your MCP client&apos;s config. <strong className="text-zinc-200">
            VS Code users can skip it
          </strong>{" "}
          — this repo already ships <Code>.vscode/mcp.json</Code>, which asks for the key once
          and keeps it in VS Code&apos;s secret storage; run{" "}
          <strong className="text-zinc-200">MCP: List Servers → prompt-ops → Start</strong>{" "}
          from the Command Palette.
        </>
      ),
      block: (
        <Block
          title="mcp.json"
          hint={`stdio transport, launched with bun from ${path}`}
          code={mcpConfig}
          label="MCP configuration"
        />
      ),
    },
  ];

  return (
    <section
      id="connect"
      className="scroll-mt-8 border-t border-zinc-800/70 py-[3.8rem]"
    >
      <div className="mx-auto max-w-[1200px] px-6">
        <h2 className="max-w-[850px] text-[clamp(1.75rem,3vw,2.2rem)] leading-[1.14] font-[650] tracking-[-0.035em] text-white">
          Connect your editor.
        </h2>
        <p className="mt-5 max-w-[710px] text-[1.075rem] leading-[1.7] text-zinc-400">
          PromptOps ships an MCP server, so an editor agent can list prompts, read one, save a
          new one and append versions without leaving the editor. Fill in your project path and
          workspace key and the config below updates as you type.
        </p>

        {/* One row of controls above the blocks they change. */}
        <div className="mt-8 flex flex-wrap items-end gap-x-8 gap-y-5">
          <div>
            <span className="mb-2 block text-[0.75rem] tracking-[0.09em] text-zinc-500 uppercase">
              Platform
            </span>
            <div className="flex gap-1">
              {(Object.keys(PLATFORMS) as Platform[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPlatform(option)}
                  aria-pressed={option === platform}
                  className={
                    option === platform
                      ? "rounded-[5px] bg-zinc-800 px-3 py-2 text-[0.9rem] text-white"
                      : "rounded-[5px] px-3 py-2 text-[0.9rem] text-zinc-400 transition hover:text-white"
                  }
                >
                  {PLATFORMS[option].label}
                </button>
              ))}
            </div>
          </div>

          <label className="min-w-60 flex-1">
            <span className="mb-2 block text-[0.75rem] tracking-[0.09em] text-zinc-500 uppercase">
              Project folder
            </span>
            <input
              className={cn(field, "font-system-mono rounded-[5px] text-[0.875rem]")}
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              placeholder={chosen.samplePath}
              spellCheck={false}
              aria-label="Absolute path to your Prompt_Ops checkout"
            />
          </label>

          <label className="min-w-60 flex-1">
            <span className="mb-2 block text-[0.75rem] tracking-[0.09em] text-zinc-500 uppercase">
              Workspace API key
            </span>
            <input
              className={cn(field, "font-system-mono rounded-[5px] text-[0.875rem]")}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="pops_your_key_here"
              spellCheck={false}
              aria-label="Workspace API key beginning pops_"
            />
          </label>
        </div>

        <ol className="mt-10 space-y-10">
          {steps.map((step, index) => (
            <li key={step.heading} className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-10">
              <div>
                <h3 className="text-[1.075rem] font-[650] tracking-[-0.02em] text-zinc-100">
                  <span className="text-zinc-600">{index + 1}.</span> {step.heading}
                </h3>
                <p className="mt-3 text-[0.95rem] leading-[1.65] text-zinc-400">{step.body}</p>
              </div>
              <div className="min-w-0">{step.block}</div>
            </li>
          ))}
        </ol>

        {/* A disclosure, because the tool list is reference material rather
            than part of the three steps someone follows the first time. */}
        <details className="mt-10 border-t border-zinc-800/70 pt-6">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[0.9rem] font-medium text-zinc-300 transition hover:text-white">
            <span aria-hidden="true" className="text-zinc-600">
              ▸
            </span>
            The five tools an agent gets
          </summary>
          <dl className="mt-4 space-y-2.5 text-[0.95rem]">
            {TOOLS.map(([name, description]) => (
              <div key={name} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                <dt className="font-system-mono text-[0.8rem] text-emerald-400 sm:w-40 sm:shrink-0 sm:pt-1">
                  {name}
                </dt>
                <dd className="leading-[1.65] text-zinc-400">{description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 max-w-[710px] text-[0.85rem] leading-[1.6] text-zinc-500">
            Running a prompt against a model and anything administrative are deliberately
            absent: a workspace key acts as an editor, and the calling agent already has its
            own model.
          </p>
        </details>
      </div>
    </section>
  );
}

/** Inline code inside prose. Mono at 0.9em so it sits on the text baseline. */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-system-mono text-[0.9em] text-emerald-400">{children}</code>
  );
}
