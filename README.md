# Prompt Ops

Version control, but for your prompts. Write them, tweak them, compare the
diffs, and (now) actually run them against an LLM to see if they're any good.

FHSU CSI 441 — Team C.

Want to help? Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and
pull request guidance.

## The stack

Nothing exotic here — just a solid, boring-in-the-best-way set of tools:

| Layer | Choice | Version |
| --- | --- | --- |
| Framework | Next.js (App Router, Turbopack) | 16.3.4 |
| Language | TypeScript | 5.9 |
| Runtime / package manager | Bun | 1.3.14 |
| Database | PostgreSQL via Prisma ORM | 7.10.0 |
| UI | shadcn/ui + Tailwind CSS | 4.3.3 |
| Client state | Zustand | 5.0 |
| Server state | TanStack React Query | 5.102 |
| Auth | NextAuth v5 (Auth.js) + bcryptjs | 5.0.0-beta.32 |
| Validation | Zod + React Hook Form | 4.5 / 7.87 |

## Getting started

Four commands and you're in:

```bash
bun install
cp .env.example .env      # then fill in AUTH_SECRET
bunx auth secret          # writes a generated AUTH_SECRET for you
bunx --bun prisma migrate deploy # applies migrations to DATABASE_URL
bun run db:seed           # optional sample data
bun run dev               # http://localhost:3000
```

The seed creates one account per workspace role, so you can feel the
permission walls by signing in as each. All three use `password123` — please
don't use that for anything you actually care about.

| Role | Email | Can |
| --- | --- | --- |
| `OWNER` | `admin@promptops.local` | everything, including members and API keys |
| `EDITOR` | `editor@promptops.local` | create, edit and delete prompts |
| `VIEWER` | `viewer@promptops.local` | browse and compare, nothing else |

The owner matters: members and API keys are gated on `OWNER`, so a workspace
without one can't be administered at all — and couldn't mint the key the CLI
and the MCP server need.

## The real database: library and graph view

Sign in at `/login`, then head to `/dashboard/explorer` (or **Library &
graph** from the dashboard) to see prompts backed by actual PostgreSQL
records. Search, pick versions, copy prompts, and
poke around the graph visualization. Switch workspaces from the links above
the library, save changes from **Open editor**, and grab anything new with
**Refresh library**.

Need to clear something out? Open a prompt and scroll to **Danger zone** at
the bottom of the editor. **Delete prompt** asks once, then removes the prompt
along with every saved version and every generated-code commit attached to it
— the database cascades them. It is the one irreversible action in the app, so
viewers never see the button, and the server action re-checks for `EDITOR`
regardless of what the UI rendered.

You'll need `DATABASE_URL` and `AUTH_SECRET` in `.env`, plus the Prisma
migrations applied. `DATABASE_URL` has to be a real PostgreSQL URL from
whichever cloud provider you're using. `bunx --bun prisma migrate status`
tells you where things stand; `bunx --bun prisma migrate deploy` catches you
up. GitHub and Google sign-in need their credential pairs too (see
`.env.example`) — password sign-in works fine without either.

Setting up a brand-new database? Here's the drill:

1. Spin up a PostgreSQL database with your provider of choice and grab the
   connection string. Pooled URL goes in `DATABASE_URL`; if you also get a
   direct (non-pooled) URL, put that in `DIRECT_URL` — Prisma uses it for
   migrations. Change `sslmode=require` to `sslmode=verify-full` while you're
   in there: the `pg` driver treats them identically today but warns on every
   run, because `require` is set to mean weaker verification in `pg` v9.
2. Copy `.env.example` to `.env`, drop in your `DATABASE_URL`, and generate
   `AUTH_SECRET` with `bunx auth secret`.
3. `bunx --bun prisma migrate deploy` to create the tables.
4. Optionally seed some data with `bun run db:seed`, then double-check
   everything with `bunx --bun prisma migrate status` and `bun run dev`.
5. When you deploy, set the same `DATABASE_URL` and `AUTH_SECRET` as
   server-side secrets on your host, and run `bunx --bun prisma migrate
   deploy` before the app actually starts.

Don't commit `.env`, and never expose `DATABASE_URL` through a
`NEXT_PUBLIC_` variable — that's the kind of mistake that ends up in a
postmortem. If you've still got an old local `prisma/dev.db` lying around,
it's not imported automatically, so hang onto it until whatever you need from
it has made its way into PostgreSQL.

## Testing prompts against a real LLM

This is the fun new part: you can actually fire a prompt at a model and see
what comes back, without leaving the editor.

For local testing through a 9Router instance, set these in `.env`:

```env
LLM_BASE_URL="http://localhost:20128/v1"
LLM_MODEL="openrouter/nvidia/nemotron-3-super-120b-a12b:free"
LLM_API_KEY="your-9router-api-key"
```

Use the key 9Router issues you, and keep your actual upstream OpenRouter key
tucked away inside 9Router itself — never in `.env`. `LLM_MODEL` has to be an
id from 9Router's own `/v1/models` list; ask the running server what it has:

```bash
curl -s -H "Authorization: Bearer $LLM_API_KEY" "$LLM_BASE_URL/models" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).data.forEach(m=>console.log(m.id)))'
```

Then restart `bun run dev`, sign in, open a prompt from `/dashboard`, fill in
its variables, and click **Run test**. It sends your current draft — unsaved
edits and all — and shows the response, the model, how long it took, and the
token usage. Text-only results are a scratchpad and are not saved; selecting
an attached file saves a separate revised file version (see below).

All three `LLM_*` variables are needed together, and the server has to be
something your own machine can reach — a cloud-hosted deployment cannot dial
back into your laptop. The request goes through Chat Completions with a
4,096-token output cap.

AI testing is enabled in development, and in production only when
`AI_TESTING_ENABLED=true`. Every request is capped at 16,000 input characters,
1,024 output tokens, and 60 seconds, with no automatic retries, so a bad
prompt can't quietly burn through your quota — though those caps are per
request, not a spending limit, so keep an eye on usage. To sanity-check the
plumbing without spending anything, run
`node --import tsx --test src/lib/openai-run.test.ts` — it's all mocked.

Not in here (yet): persistent token analytics.
And deployment/hosting is left as an exercise for whoever ships this.

## Generating code — and keeping every version of it

Prompts that write code have a second history worth keeping: the code itself.
Hit **Generate code** on a prompt and the response gets parsed into files,
diffed against the previous run, and committed — append-only, attached to the
prompt, with a parent pointer. It is `git log` for whatever your local model
keeps producing, except the log lives next to the prompt that caused it.

Open a prompt from `/dashboard`, fill in its variables, and look for
**Generated code** under the editor. Each run adds a commit:

```
c3  Update src/lib/parse.ts            2 files · 1 changed +18 −4
    Alex · 2026-10-15 14:02 · nemotron-3-super-120b · 6.4s · 812 in / 1203 out
    M src/lib/parse.ts   +18 −4      · src/lib/types.ts
c2  Add 2 files                        2 files +41 −0
c1  Add src/lib/parse.ts               1 file  +23 −0
```

Click a commit to see its files, with git's status letters — `A` added, `M`
modified, `D` removed, `·` unchanged. Modified files get a **Show diff** button
that compares them against the same file in the parent commit, three lines of
context either side. Commit messages are optional; one gets written from the
diff when you leave the box empty.

A few things that matter:

- **Nothing is written to your working tree.** Commits are database records you
  read, diff, and copy out of. A bad generation cannot clobber a real file.
- **Every commit stores exactly what produced it** — the composed prompt, the
  raw response, the model, the elapsed time, and the token counts — so a run
  stays reproducible after the prompt has moved on. The prompt version used is
  linked too, which is how a commit survives later edits to the prompt.
- **Runs that return no files still commit.** The raw response is kept so you
  can see what the model did instead.
- **A truncated response is labelled**, so a short file list is never mistaken
  for the model's complete answer.

To make parsing possible, a short output contract is appended to your prompt
asking for one fenced code block per file, each fence starting with the file's
path. The parser is forgiving — ` ```ts src/a.ts `, `path=`, `title="..."`,
`` ```json:package.json ``, a bold or heading path above the fence, a leading
`// src/a.ts` comment, or the path alone on the first line inside the block
(which is what several local models do) all work. A bare path line names the
file and is then dropped from its contents, since it is not part of the code. Unnamed blocks are skipped when the
response named any of its files, since those are nearly always shell snippets
sitting next to the real code. Paths are normalized and anything trying to
climb out of the project root is rejected. Caps: 40 files per commit, 100,000
characters per file.

Generating needs an AI provider configured (see the section above) and, like
the rest of the LLM plumbing, **runs in development only**. Reading the history
has no such limit — commits outlive the environment that made them.

New tables came with this, so apply migrations before using it:

```bash
bunx --bun prisma migrate deploy
```

| Endpoint | What it does |
| --- | --- |
| `POST /api/prompts/<id>/generate` | Run the prompt and commit the result (editor or owner, development only) |
| `GET /api/prompts/<id>/commits` | The commit log: messages, stats, file paths and statuses |
| `GET /api/prompts/<id>/commits/<commitId>` | One commit in full — file contents, prompt sent, raw response |
| `GET /api/me` | Who the caller is, and which workspace a key reaches |

`bun run test` covers the parsing, path safety, diffing, and commit
classification; the provider seam is mocked in
`node --import tsx --test src/lib/openai-run.test.ts`.

## `pops` — the command line client

Everything the dashboard does, from a terminal. It talks to a running app over
the same HTTP API the browser uses, so there is one set of rules and the CLI
cannot drift from the product.

```bash
bun run pops help                    # or `bun link` once, then just `pops`
```

### Signing in

Day to day the CLI authenticates with a **workspace API key**. From a cold
start you have no key, so sign in with your password once and mint one:

```bash
bun run pops auth login --email owner@example.com   # prompts for the password, no echo
bun run pops keys create --name "my laptop" --save  # prints the key once, stores it
bun run pops whoami
```

Both credentials live in `~/.config/promptops/config.json`, mode 600. If you
already hold a key, `pops auth login --key pops_…` stores it without a
password.

`POPS_API_KEY` and `POPS_URL` override the stored values, which is what you
want in CI or when pointing at another instance. `--key` and `--url` override
both for a single command. `POPS_PASSWORD` and `--password` skip the password
prompt for scripts — prefer the prompt, so the password stays out of your shell
history and out of `ps`.

A key is deliberately weaker than the person who made it: it reaches **one**
workspace and acts as an `EDITOR` there. It can read and write prompts and
generate code; it cannot add members, mint more keys, or create a workspace —
those still require a browser session. That is why `pops keys` is the one group
of commands that uses the session cookie rather than the key: a key that could
mint a key would be an escalation path, so the CLI signs in as a person
instead, through Auth.js's own endpoints. Writes made with a key are attributed
to whoever created it, which is why a key minted before that was recorded can
read but cannot create a prompt.

### Managing keys

Owners only, and only after `auth login --email`.

```bash
pops keys                                # prefix, name, created, last used, status
pops keys create --name "ci" --save      # shown once; only its hash is stored
pops keys revoke ci                      # by name, prefix, or id
```

A key is revoked, never deleted, so the listing stays an audit of what was
issued; revocation takes effect on the next request. The key this CLI is
holding is marked `*` in the listing, so you can see before you revoke it that
you are about to log your own terminal out.

### The workflow

```bash
pops workspaces                          # what you can reach
pops prompts                             # id, title, versions, updated
pops show slugify                        # current body, tags, {{variables}}
pops new --title "Release notes" --file prompt.md
pops edit slugify --body "…" --note "Tighten the wording"
pops history slugify                     # v1, v2, v3 …
pops history slugify v1..v3              # diff two versions
pops run slugify -v name=Alex            # send it to the model, print the reply
pops generate slugify -m "Add clamp"     # generate code and commit it
pops log slugify                         # the commit log
pops commit slugify c2 --diff            # one commit, as a diff
pops commit slugify c2 --file src/lib/a.ts
```

A prompt can be named by id, by a 6-or-more character id prefix, or by part of
its title — like abbreviating a git commit. When a name matches two prompts the
CLI prints both and stops rather than guessing which one you meant.

`--json` prints the raw API response for any command, so `pops log x --json |
jq` works. Colour follows `NO_COLOR` and switches off when output is piped.

`run` and `generate` reach a model, so they need the app in development mode
with a provider configured — the same restriction the browser has.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server |
| `bun run build` | `prisma generate` + production build |
| `bun run start` | Serve the production build |
| `bun run pops` | The CLI (`bun run pops help`) |
| `bun run lint` | ESLint |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Pure-logic suites (`node:test`) |
| `bun run smoke:test` | End-to-end checks against a running app |
| `bun run db:migrate` | Create + apply a migration |
| `bun run db:push` | Push schema without a migration |
| `bun run db:seed` | Run `prisma/seed.ts` |
| `bun run db:studio` | Prisma Studio |
| `bun run db:reset` | Drop and re-apply everything (destroys data — you've been warned) |

## Where everything lives

```
prisma/
  schema.prisma        Auth.js models, the Prompt domain model, code commits
  seed.ts              Sample prompts + one account per role
src/
  auth.config.ts       Edge-safe Auth.js config (no Prisma/bcrypt)
  auth.ts              Full config: Prisma adapter + credentials provider
  proxy.ts             Route protection (Next 16's renamed middleware)
  app/
    api/auth/[...nextauth]/route.ts
    api/register/route.ts    Sign-up, hashes with bcryptjs
    api/prompts/route.ts     Reference CRUD route
    api/prompts/[id]/generate/route.ts  Generate code and commit it
    api/prompts/[id]/commits/          The generated-code log
  components/
    prompt-library.tsx Search, versions and graph over the workspace library
    prompt-graph.tsx   Force-free graph of prompts, tags and variables
    providers/         SessionProvider + QueryClientProvider
    ui/                shadcn components
  generated/prisma/    Prisma client output (gitignored)
  mcp/
    index.ts           `prompt-ops` MCP server for Copilot Chat (stdio)
  cli/
    index.ts           `pops` — commands and help
    client.ts          HTTP layer, bearer key or session cookie, error mapping
    config.ts          ~/.config/promptops/config.json
    session.ts         Password sign-in through Auth.js, for the owner-only routes
    format.ts          Tables, diffs, colour
    resolve.ts         Name a prompt by id, prefix, or title — or a key
  lib/
    api-auth.ts        Session or API key: one caller model for every route
    prompts-core.ts    Pure prompt helpers + sample data, shared by app/CLI/seed
    prisma.ts          Client singleton + PostgreSQL driver adapter
    code-commits.ts    Response → files → commit, with the diff against the last run
    code-diff.ts       Line diffing, shared by the API and the commit log UI
    query-client.ts    React Query defaults, SSR-safe
    env.ts             Zod-validated environment variables
    validations.ts     Shared Zod schemas
  store/ui-store.ts    Zustand example slice
  types/next-auth.d.ts Session/JWT type augmentation
```

## Things worth knowing before you dig in

- **Prisma 7 needs a driver adapter.** We're on PostgreSQL via
  `@prisma/adapter-pg`, wired up in `src/lib/prisma.ts`.
- **Auth is split across two files, deliberately.** `proxy.ts` runs on the
  edge, where Prisma and bcryptjs can't follow, so it only imports
  `auth.config.ts`. The Prisma adapter and credentials provider live in the
  server-only `auth.ts`.
- **Sessions are JWTs**, not database sessions — required for a credentials
  provider to work at all.
- **`bun pm trust`** has already been run for `esbuild` and the Prisma
  engines. A fresh clone might ask you to do it again.

## VS Code

`.vscode/extensions.json` has the recommended extensions (ESLint, Prettier,
Tailwind IntelliSense, Prisma, Bun, Copilot Chat) ready to go. Accept the
prompt on first open, or run **Extensions: Show Recommended Extensions** if
you missed it.

## GitHub Copilot Chat — the MCP server

Manage prompts from Copilot Chat's agent mode: list them, read one, save a new
one, append a version, fill in variables — without leaving the editor.

`.vscode/mcp.json` registers a `prompt-ops` server; `src/mcp/index.ts` is it.

```bash
bun run mcp        # stdio on stdin/stdout — only useful to an MCP client
```

### Using it from VS Code

1. Start the app: `bun run dev`. The server is a client of the HTTP API, so
   nothing works without it running.
2. Have a key: `pops auth login --email you@…` then `pops keys create --save`.
3. Open the Command Palette → **MCP: List Servers** → `prompt-ops` → **Start**.
   VS Code asks for the key once (the `pops-api-key` input) and keeps it in its
   own secret storage.
4. In Copilot Chat, switch to **Agent** mode and check the tools picker for the
   five `prompt-ops` tools.

### The tools

| Tool | What it does |
| --- | --- |
| `list_prompts` | id, title, version count, workspace. `workspace` narrows it |
| `get_prompt` | current body, tags, `{{variables}}`, and the version history |
| `create_prompt` | saves a new prompt, so one refined in the editor is kept |
| `append_version` | appends a version; omitted fields carry forward |
| `compose` | fills `{{variables}}` and returns the text — stores nothing |

A prompt is named the way the CLI names one: id, a 6-or-more character id
prefix, or part of its title. Ambiguity is an error listing the candidates,
never a guess — an agent that picked one at random would append a version to
the wrong prompt, and that cannot be undone.

### What it deliberately does not expose

- **`run` and `generate`.** They reach a model, cost money, and are
  development-only by design. The caller is already an agent with its own
  model.
- **Members, keys, and deleting a prompt.** A workspace key is an `EDITOR` and
  cannot do the first two; deletion is the one irreversible operation in the
  product and is not something an agent should reach for on its own.

### How it is built

- **It is a client of the web app, not a second way into the database.** Every
  tool goes out over the same HTTP API the dashboard and CLI use, so workspace
  scoping, the append-only rules and authorship stay where they are enforced.
  A Prisma client here would duplicate the rules and would need database
  credentials in an editor's environment — exactly what the API key avoids.
- **Credentials come from the environment**, using the names the CLI reads in
  `src/cli/config.ts`: `POPS_URL` and `POPS_API_KEY`. It reuses
  `src/cli/client.ts`, so if `pops whoami` works, so does this — and with no
  environment at all it falls back to `~/.config/promptops/config.json`. The
  key never belongs in `.env`.
- **stdout is the JSON-RPC channel.** Diagnostics go to stderr; a stray
  `console.log` would corrupt the stream and the client would report a
  protocol error.
- **A failed call returns `isError` with the server's own message**, so the
  agent can relay "API key has been revoked." instead of "the tool broke".

## Push notifications (because who checks GitHub notifications)

Every push to this repo pings a Telegram chat with the branch, who pushed,
the time in Phnom Penh, and the files that changed —
`.github/workflows/telegram-notify.yml` does the honors.

It needs two **repository secrets** (Settings → Secrets and variables →
Actions):

| Secret | Where it comes from |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `TELEGRAM_CHAT_ID` | See below |

To find the chat ID: add the bot to the group, send any message, then open
`https://api.telegram.org/bot<TOKEN>/getUpdates` and read
`result[0].message.chat.id`. Group IDs are negative, and supergroups start
with `-100`.

No secrets configured? The workflow just shrugs, logs a notice, and exits
green — so forks and fresh clones don't fail builds over a missing Telegram
bot. Branch deletions are skipped entirely.
