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
bun run db:seed           # optional demo data
bun run dev               # http://localhost:3000
```

Seeded login: `admin@promptops.local` / `password123`. (Please don't use this
password for anything you actually care about.)

## Browser demo — no account required

Run `bun run dev`, open `http://localhost:3000/demo`, and pick a demo identity
off the landing page: Alex is an owner, Sam's an editor, and Jordan's a
viewer, all hanging out in the Personal workspace. Nobody needs a real
password here — these are pretend accounts for kicking the tires.

**Workspace settings** lets you spin up a workspace, shuffle around who's an
owner/editor/viewer, and reveal/copy/rotate a placeholder API key. Owners run
the show (membership + keys), owners and editors can save prompts, and
viewers get to browse, preview, and compare but not touch anything. Sign out
and swap identities to feel the permission walls for yourself. Heads up:
these demo keys are just for show and don't actually authenticate API
requests.

Create, search, edit, and delete prompts, or preview `{{variables}}` filled
in live. Every save or restore drops a new snapshot with the demo author's
name attached, so the History tab always has something to compare — pick any
two versions and see them side by side, or restore an old one (which, true to
form, just becomes a new version). Jump straight into that view with
`/demo?view=history`.

First time you land in the Personal workspace, the browser quietly fetches
some starter prompts from `GET /api/demo/prompts`. The classic
`promptops.demo.v1` local-storage library sticks around as the Personal
workspace; every other workspace gets its own key under
`promptops.demo.v1.workspace.`, and account/session info lives in
`promptops.demo.accounts.v1`. Come back later and everything's still there —
even the libraries you left intentionally empty. All of this stays local in
your browser; it never touches the real database or calls an LLM.

If something goes wrong loading your data, you get options: retry, carry on
with a throwaway session, or reset with a confirmation first. A failed save
won't eat your draft. Two tabs fighting over the same workspace? You'll need
to reload before saving again. And yes, clearing your browser data wipes the
demo workspace — it was never meant to be permanent.

Run `bun run test` to check role permissions, last-owner protection,
workspace isolation, version history, persistence, variable substitution, and
what happens when storage misbehaves.

## The real database: library and graph view

Sign in at `/login`, then head to `/dashboard/explorer` (or **Library &
graph** from the dashboard) to see prompts backed by actual PostgreSQL
records instead of browser storage. Search, pick versions, copy prompts, and
poke around the graph visualization. Switch workspaces from the links above
the library, save changes from **Open editor**, and grab anything new with
**Refresh library**.

`/demo` and `/demo/explorer` are still their own browser-only sandbox — handy
for a quick look, but nothing you do there shows up in the database.

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
LLM_MODEL="openrouter/stepfun/step-3.5-flash:free"
LLM_API_KEY="your-9router-api-key"
```

Use the key 9Router generates for you, and keep your actual upstream
OpenRouter key tucked away inside 9Router itself. Model IDs come straight
from 9Router's `/v1/models` list. Restart `bun run dev`, open `/demo`, pick a
prompt, hit **Preview**, fill in the variables, and click **Generate
response**. No login, no database — this path works entirely on its own.
The authenticated editor gets the same trick via its **Run test** button once
the database's connected. One thing to know: `LLM_BASE_URL` routes through
Chat Completions with a 4,096-token output cap, and it only works for things
your own machine can reach — a cloud-hosted deployment can't dial back into
your laptop. Unset it if you want to go straight to OpenAI instead.

Speaking of which: grab an API project/key from
https://platform.openai.com/api-keys, make sure billing's set up for that
project, then add `OPENAI_API_KEY` and `OPENAI_MODEL` (any model your project
can access via the Responses API) to `.env` and restart the dev server. Keep
that key server-side and far away from version control.

With PostgreSQL wired up and migrations applied, sign in as a workspace
owner or editor, open a prompt in `/dashboard`, fill in its variables, and
click **Run with OpenAI**. It sends your current draft — unsaved edits and
all — and shows you the response, the model, how long it took, and the token
usage. Nothing gets saved; it's just a scratchpad for checking your work.

This whole thing is development-only — it won't run in production. Every
request is capped at 16,000 input characters, 1,024 output tokens, and 60
seconds, with no automatic retries, so a bad prompt can't quietly burn
through your budget (though the caps don't add up to a hard spending limit
overall, so still keep an eye on your bill). Want to sanity-check the
plumbing without spending a cent? Run
`node --import tsx --test src/lib/openai-run.test.ts` — it's all mocked.

Not in here (yet): an MCP server and any kind of persistent token analytics.
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

The CLI authenticates with a **workspace API key**, not your password. Create
one in the web app (workspace settings → API keys; owners only), then:

```bash
bun run pops auth login --key pops_…       # stored in ~/.config/promptops/config.json, mode 600
bun run pops whoami
```

`POPS_API_KEY` and `POPS_URL` override the stored values, which is what you
want in CI or when pointing at another instance. `--key` and `--url` override
both for a single command.

A key is deliberately weaker than the person who made it: it reaches **one**
workspace and acts as an `EDITOR` there. It can read and write prompts and
generate code; it cannot add members, mint more keys, or create a workspace —
those still require a browser session. Revoking a key in the web app takes
effect on the next request. Writes made with a key are attributed to whoever
created it, which is why a key minted before that was recorded can read but
cannot create a prompt.

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
| `bun run db:migrate` | Create + apply a migration |
| `bun run db:push` | Push schema without a migration |
| `bun run db:seed` | Run `prisma/seed.ts` |
| `bun run db:studio` | Prisma Studio |
| `bun run db:reset` | Drop and re-apply everything (destroys data — you've been warned) |

## Where everything lives

```
prisma/
  schema.prisma        Auth.js models, the Prompt domain model, code commits
  seed.ts              Demo data
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
    providers/         SessionProvider + QueryClientProvider
    ui/                shadcn components
  generated/prisma/    Prisma client output (gitignored)
  cli/
    index.ts           `pops` — commands and help
    client.ts          HTTP layer, bearer key, error mapping
    config.ts          ~/.config/promptops/config.json
    format.ts          Tables, diffs, colour
    resolve.ts         Name a prompt by id, prefix, or title
  lib/
    api-auth.ts        Session or API key: one caller model for every route
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

## GitHub Copilot Chat (wired up, not working yet)

The goal: manage prompts from Copilot Chat's agent mode — list them, read one,
append a version — without leaving the editor.

`.vscode/mcp.json` registers a `prompt-ops` MCP server for exactly that. **It
does not work yet**, because the server it points at (`src/mcp/index.ts`)
hasn't been written. Copilot will list the server and report that it failed to
start. The config is committed first so the wiring is settled and reviewable
before the server lands.

What's already decided by that file:

- **Transport is stdio**, launched as `bun src/mcp/index.ts` — the same shape
  as the `pops` CLI in `package.json`.
- **Credentials come from the environment**, using the names the CLI already
  reads in `src/cli/config.ts`: `POPS_URL` and `POPS_API_KEY`. Environment
  variables win over the stored config file there, so the same precedence
  applies here.
- **The key is never committed.** VS Code prompts for it once via the
  `pops-api-key` input and keeps it in its own secret storage. Delete that
  input and the `POPS_API_KEY` entry if you'd rather have the server fall back
  to whatever `pops login` wrote to `~/.config/promptops/config.json` — that
  file is owner-only on purpose, and the key never belongs in `.env`.

To finish this, the server needs to exist and expose a few tools
(`list_prompts`, `get_prompt`, `append_version`, `compose`) over the
`requireCaller*` helpers in `src/lib/api-auth.ts`, authenticating with a
workspace API key. `composePrompt` and `variableNames` in
`src/lib/demo-prompts.ts` are pure and browser-independent, so variable
substitution can be reused as-is.

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
