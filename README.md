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
   migrations.
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
usage. Text-only results are a scratchpad and are not saved. Selecting an
attached file saves a separate revised file version (see below).

AI testing is enabled in development. The authenticated editor can also run
in production when `AI_TESTING_ENABLED=true`; the anonymous demo remains
development-only. Text-only direct OpenAI requests are capped at 16,000 input
characters, 1,024 output tokens, and 60
seconds, with no automatic retries, so a bad prompt can't quietly burn
through your budget (though the caps don't add up to a hard spending limit
overall, so still keep an eye on your bill). Want to sanity-check the
plumbing without spending a cent? Run
`node --import tsx --test src/lib/openai-run.test.ts` — it's all mocked.

Not in here (yet): an MCP server and any kind of persistent token analytics.
Workspace API keys exist and can be managed through the API, but prompt
endpoints only trust browser sessions right now, not bearer keys. And
deployment/hosting is left as an exercise for whoever ships this.

## File uploads and AI revisions

### Prompt history and comparison

In the authenticated prompt editor, **Load vN** restores that saved prompt's
title, body, and tags without overwriting history. Loading another version
asks before replacing unsaved edits. You can load the latest version too.
After **Save as new version** succeeds, the body and commit note clear for a
new entry; title and tags remain. Failed saves keep the draft intact.

Use **Compare with latest** (or **Compare with previous** on the latest entry)
to compare any two saved prompt versions. The comparison shows title/tag
changes and red removed / green added content lines. For very large inputs,
it shows complete old/new content instead of computing detailed line matches.
This compares prompt snapshots, not attached file versions or unsaved drafts.

Owners and editors can click **Analyze changes with AI** when server AI testing
is enabled. Both saved snapshots are sent to the configured provider only on
that click; usage limits and charges apply. AI analysis is an interpretation,
does not execute either prompt, is not saved, and does not create a version.
Analysis is limited to 32,000 serialized snapshot characters and 4,096 output
tokens, with incomplete output clearly marked. Viewers can compare locally
but cannot request AI analysis. Run `bun run test:history` for the regression
tests; provider calls are mocked.

### Attached files

This feature is available in the authenticated `/dashboard`, not the
browser-only demo. Apply the new tables before opening the dashboard:

```bash
bunx --bun prisma migrate deploy
bun run dev
```

Owners and editors can attach files while creating a prompt or upload more
from its editor. Under **Files & versions**, select a file version, write the
requested changes in the prompt, fill any variables, and click **Run AI &
save revised file**. The AI receives the selected file's extracted content
and the current prompt draft. A successful response creates a downloadable
v2, v3, etc.; v1 remains the exact original upload. Any earlier version can
be selected as the source for another revision. History records that source,
the instruction, model, and summary. Viewers may preview and download files
but cannot upload or run revisions.

For files with two or more versions, click **Compare with vN** (or **Compare
with latest/previous**) beside a file version. A comparison opens in the main
panel; use its selectors to compare any two versions of that same file. Removed
lines are red and added lines are green. **View both file contents** shows
syntax-colored previews and download links. This is separate from prompt History.
PDF/Word comparisons cover extracted text; Excel comparisons cover stored cell
values displayed as readable JSON, not formulas, layouts, images, or formatting.

Editors/owners can optionally click **Analyze file changes with AI**. Only then
are both saved file contents sent to the configured provider. The action checks
workspace access and that both versions belong to the same file and prompt.
Analysis is limited to 64,000 serialized snapshot characters and 4,096 output
tokens; partial output is marked. Analysis never executes code, modifies files,
or creates a new version. Viewers can use the comparison without AI.

Supported files and limits:

- UTF-8 code/text files, text-based `.pdf`, `.docx`, and `.xlsx`. Legacy
  `.doc`/`.xls`, macros, embedded attachments, encrypted documents, and scanned
  PDFs requiring OCR are not supported.
- Up to three files per upload, 2 MB combined, and 24,000 extracted characters
  per file. One selected file is revised per AI run.
- PDFs: up to 50 pages. PDF/Word output is rebuilt from text; complex layout,
  images, and rich formatting are not preserved.
- Excel: up to 10 sheets, 1,000 rows and 100 columns per sheet. Output contains
  literal cell values; formulas become displayed/cached values, and formatting,
  charts, macros, and external connections are not retained.
- Office archives are bounded to 10 MB uncompressed and 1,000 entries.

Files and revisions are stored in PostgreSQL and scoped to the prompt's
workspace. Deleting the prompt or workspace also deletes its attached files.
Uploads are not sent to the AI until a revision or AI analysis is requested. Do not upload secrets
or content you are not allowed to share with the configured provider.
File runs allow up to 16,384 output tokens, so they may cost more than text-only
tests. Invalid, truncated, or failed responses do not create a revision.
Generated code is never executed or automatically tested; review all output.

Configure `LLM_BASE_URL`/`LLM_MODEL` (optional `LLM_API_KEY`) or
`OPENAI_API_KEY`/`OPENAI_MODEL` as described above. For `bun run start`, set
`AI_TESTING_ENABLED=true` before running the server to enable authenticated AI
testing. Without it, uploaded files and history still work.

Run `bun run test:files` for document round trips, original-byte preservation,
upload validation, and mocked AI success/failure tests. These tests do not call
a paid provider.

### Token usage and observed savings (report UC-7 / UC-8)

Open an authenticated prompt and click **Token usage & savings**. Every workspace
member, including viewers, can review usage for that workspace. This implements
the report's externally submitted usage/analytics flow (REQ-9, REQ-10, REQ-19,
REQ-26), not automatic prompt rewriting or guaranteed token savings.

Before starting a checkout with this feature, apply the additive migration and
regenerate the client; never reset an existing database:

```bash
bunx --bun prisma migrate deploy
bunx --bun prisma generate
```

An owner creates a workspace API key in the dashboard. An instrumented external
application executes a saved prompt, collects the provider's actual token usage
and its measured response latency, estimates cost using its applicable pricing,
and sends a server-to-server request:

```http
POST /api/usage
Authorization: Bearer <workspace-api-key>
Content-Type: application/json
```

```json
{
  "requestId": "unique-id-for-this-execution",
  "promptVersionId": "the-exact-saved-version-used",
  "inputTokens": 100,
  "outputTokens": 50,
  "tokenUnit": "tokens",
  "latency": { "value": 1.25, "unit": "s" },
  "estimatedCost": { "amount": "0.00015000", "currency": "USD" },
  "model": "provider/model",
  "workload": "support-fixtures-v1-temp0",
  "measuredAt": "2026-10-20T12:00:00.000Z"
}
```

These are example measurements, not model prices or real production results.
The analytics page's **How to record usage** section provides the saved version
IDs. Send actual request counts from the provider, not character-count estimates.
The `workload` label should identify the same input dataset and generation
settings when comparing versions. Do not include secrets or prompt/file text.

- New measurements return `201` with `usageId`, `promptVersionId`, `acceptedAt`,
  and `duplicate: false`. Repeating the same API-key/request-ID pair with
  equivalent normalized data returns `200`, the same receipt, and
  `duplicate: true`. Changed data for that identity returns `409`; use a new ID
  only for a genuinely new execution.
- The key determines workspace access. A caller cannot supply a workspace ID;
  foreign prompt versions are rejected. Revoked keys cannot ingest more data.
  Historical usage remains readable after revocation.
- Both token counts are required nonnegative integers, at most 2,147,483,647
  each. Total tokens = input + output. Include provider-reported billable
  reasoning/output tokens rather than counting visible response text alone.
- Latency accepts `ms` or `s` and must convert to exact whole milliseconds,
  at most 2,147,483,647. Explicit zeros are accepted; missing data is rejected.
- Estimated cost accepts an ordinary decimal string (recommended) or number,
  at most 12 integer and 8 fractional digits. No exponent notation, silent
  rounding, currency conversion, or assumed model pricing. Supported currencies:
  USD, KHR, EUR, GBP, CAD, AUD, JPY, CNY, INR, SGD.
- Timestamps require a UTC/offset ISO timestamp, with seconds or exactly three
  fractional digits. Records are filtered by **measuredAt**, not arrival time.
  Bodies are limited to 16 KB. Invalid input returns `400`, invalid/revoked keys
  `401`, foreign/missing versions `404`, and oversized payloads `413`.

The UI filters by UTC interval, version, model, workload, and currency; its
read-only endpoint is `GET /api/prompts/:id/usage?start=<ISO>&end=<ISO>` with
optional `versionId`, `model`, `workload`, `currency` parameters and a member
session. Start is inclusive and end exclusive. Results aggregate in PostgreSQL,
separately by version/model/workload/currency, and include request counts,
input/output/total tokens, mean tokens, mean latency in milliseconds, exact
estimated-cost totals, and mean estimated cost. Narrow filters if the result
would exceed 500 groups. Failures are not displayed as zero usage.

Choose baseline/candidate groups from different prompt versions with matching
model, workload, and currency. Observed reduction is
`(baseline mean - candidate mean) / baseline mean × 100`, calculated per request
so unequal request counts do not masquerade as savings. A zero baseline has no
percentage; increases are labeled higher usage. Small samples and differing
inputs/settings can bias comparisons. Review output quality separately.

The current editor's **Run test**, file revisions, and AI change analyses are
**not automatically recorded**: those can run an unsaved draft and must not be
misattributed to the latest saved prompt. No historical usage is fabricated or
backfilled. This analytics workflow makes no LLM calls.

Verification:

```bash
bun run test:usage
```

For opt-in PostgreSQL integration tests, set `USAGE_DB_TESTS=1` and run
`bun run test:usage:db`. Optionally provide `USAGE_TEST_DATABASE_URL`; otherwise
the configured direct/database URL is used. The test creates a randomly named
`promptops_usage_test_*` schema, migrates and populates **only that schema**, checks
retry races, conflicts, authorization, revocation, time boundaries, and exact
aggregate fixtures, then removes that temporary schema. It needs create-schema
permission. It never resets or seeds the application's tables or calls an LLM.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server |
| `bun run build` | `prisma generate` + production build |
| `bun run start` | Serve the production build |
| `bun run lint` | ESLint |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test:files` | File upload/revision and mocked provider tests |
| `bun run test:usage` | Usage validation, normalization, and savings calculations |
| `bun run test:usage:db` | Opt-in isolated PostgreSQL integration tests |
| `bun run db:migrate` | Create + apply a migration |
| `bun run db:push` | Push schema without a migration |
| `bun run db:seed` | Run `prisma/seed.ts` |
| `bun run db:studio` | Prisma Studio |
| `bun run db:reset` | Drop and re-apply everything (destroys data — you've been warned) |

## Where everything lives

```
prisma/
  schema.prisma        Auth.js models + the Prompt domain model
  seed.ts              Demo data
src/
  auth.config.ts       Edge-safe Auth.js config (no Prisma/bcrypt)
  auth.ts              Full config: Prisma adapter + credentials provider
  proxy.ts             Route protection (Next 16's renamed middleware)
  app/
    api/auth/[...nextauth]/route.ts
    api/register/route.ts    Sign-up, hashes with bcryptjs
    api/prompts/route.ts     Reference CRUD route
  components/
    providers/         SessionProvider + QueryClientProvider
    ui/                shadcn components
  generated/prisma/    Prisma client output (gitignored)
  lib/
    prisma.ts          Client singleton + PostgreSQL driver adapter
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
Tailwind IntelliSense, Prisma, Bun) ready to go. Accept the prompt on first
open, or run **Extensions: Show Recommended Extensions** if you missed it.

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
