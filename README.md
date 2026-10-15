# Prompt Ops

FHSU CSI 441 — Team C.

## Tech stack

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

```bash
bun install
cp .env.example .env      # then fill in AUTH_SECRET
bunx auth secret          # writes a generated AUTH_SECRET for you
bunx --bun prisma migrate deploy # applies migrations to DATABASE_URL
bun run db:seed           # optional demo data
bun run dev               # http://localhost:3000
```

Seeded login: `admin@promptops.local` / `password123`.

## Browser demo

Run `bun run dev` and open `http://localhost:3000/demo`, or follow the **Auth & Workspaces** and **Version Control** links on the landing page. Choose a demo identity: Alex is an owner, Sam an editor, and Jordan a viewer in Personal workspace. These are simulated accounts without passwords, real authentication, or sent invitations.

Use **Workspace settings** to create a workspace, manage the three demo identities' membership roles, and reveal/copy/rotate a placeholder API key. Owners manage membership and keys, owners/editors save prompts, and viewers browse, preview, and compare. Sign out and choose another identity to test permissions. Demo keys do not authenticate API requests.

Create, search, edit, and delete prompts, or preview `{{variables}}`. Every save or restore appends a snapshot with the demo author's name. The History tab compares any two saved versions side by side and restores previous content as a new version. `/demo?view=history` opens the version-control view directly after demo sign-in.

On first visit to Personal workspace, the browser fetches sample prompts from `GET /api/demo/prompts`. The original `promptops.demo.v1` local-storage library is preserved as Personal workspace; other workspaces use separate keys prefixed `promptops.demo.v1.workspace.`. Account settings and the current demo session use `promptops.demo.accounts.v1`. Subsequent visits restore the session and saved libraries, including intentionally empty libraries. Demo changes stay in the browser and do not use the authenticated Prisma API or call an LLM.

Loading failures offer retry, a temporary session without saving, or a confirmed reset. Failed storage writes retain the editor draft. Conflicting changes from another tab require a reload before saving. Clearing browser data removes the demo workspace.

Run `bun run test` for role permissions, last-owner protection, workspace isolation, version history, persistence, variable substitution, and storage failure tests.

## Database library and graph

Sign in at `/login`, then open `/dashboard/explorer` (or **Library & graph** in
the dashboard). Search, version selection, copying, and graph visualization use
the authenticated workspace's PostgreSQL records. Switch workspaces using the links
above the library. Use **Open editor** to save changes and **Refresh library** to
retrieve changes made in another tab.

`/demo` and `/demo/explorer` remain browser-only sandboxes. Their local prompts are
not automatically imported into the database.

The backend requires `DATABASE_URL` and `AUTH_SECRET` in `.env`, plus the Prisma
migrations. `DATABASE_URL` must be a PostgreSQL URL from your cloud provider.
Check it with `bunx --bun prisma migrate status`; apply existing pending
migrations with `bunx --bun prisma migrate deploy`.
GitHub and Google sign-in additionally require their credential pairs listed in
`.env.example`. Password sign-in does not require either OAuth provider.

For a new external database:

1. Create a PostgreSQL database with your cloud provider and copy its connection
   string. Put its pooled URL in `DATABASE_URL`. If the provider also supplies a
   direct URL, put that in `DIRECT_URL`; Prisma uses it for migrations.
2. Copy `.env.example` to `.env`, replace `DATABASE_URL`, and generate
   `AUTH_SECRET` with `bunx auth secret`.
3. Run `bunx --bun prisma migrate deploy` to create the tables.
4. Optionally run `bun run db:seed`, then verify with
   `bunx --bun prisma migrate status` and `bun run dev`.
5. Add the same `DATABASE_URL` and `AUTH_SECRET` as server-side secrets in the
   application host. Run `bunx --bun prisma migrate deploy` during deployment,
   before starting the application.

Do not commit `.env` or expose `DATABASE_URL` through a `NEXT_PUBLIC_` variable.
The old local `prisma/dev.db` file, if present, is not imported automatically;
keep it until any data you need has been copied into PostgreSQL.

## OpenAI development testing

For local OpenRouter testing through 9Router, set these in `.env`:

```env
LLM_BASE_URL="http://localhost:20128/v1"
LLM_MODEL="openrouter/stepfun/step-3.5-flash:free"
LLM_API_KEY="your-9router-api-key"
```

Use the key generated in 9Router; keep your upstream OpenRouter key configured
inside 9Router. Copy model IDs from 9Router's `/v1/models` list. Restart
`bun run dev`, then open `/demo`, select a prompt, choose **Preview**, fill in
its variables, and click **Generate response**. This demo flow requires neither
authentication nor PostgreSQL. The authenticated prompt editor also has a
**Run test** action when the database is connected.
`LLM_BASE_URL` selects Chat Completions through the router with a 4,096-token
output cap. Unset it to use direct OpenAI below. Localhost refers to the
machine running the Next.js server. Cloud-hosted apps cannot reach your laptop
through this URL.

Create an OpenAI API project/key at https://platform.openai.com/api-keys and
configure API billing for that project. Add `OPENAI_API_KEY` and `OPENAI_MODEL`
(a Responses-compatible model ID available to your project) to the existing
`.env`, then restart `bun run dev`. Keep the key server-only and out of Git.

With PostgreSQL connected and migrations applied, sign in as a workspace owner
or editor, open a prompt under `/dashboard`, fill its variables, and click
**Run with OpenAI**. The current draft is sent, including unsaved changes.
The panel shows the response, model, elapsed time, and token usage. Runs are not
persisted.

This endpoint is disabled outside development. Each request is limited to
16,000 input characters, 1,024 output tokens, and 60 seconds; there are no
automatic retries. These limits do not impose a cumulative spending cap.
Run the mocked integration checks with
`node --import tsx --test src/lib/openai-run.test.ts` (no API charges).

An MCP server and persistent token analytics are not implemented. Workspace
API keys can be managed through the existing API, but prompt endpoints currently
authenticate browser sessions, not bearer keys. Hosting is not configured by
this local setup.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server |
| `bun run build` | `prisma generate` + production build |
| `bun run start` | Serve the production build |
| `bun run lint` | ESLint |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run db:migrate` | Create + apply a migration |
| `bun run db:push` | Push schema without a migration |
| `bun run db:seed` | Run `prisma/seed.ts` |
| `bun run db:studio` | Prisma Studio |
| `bun run db:reset` | Drop and re-apply everything (destroys data) |

## Layout

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

## Notes

- **Prisma 7 needs a driver adapter.** PostgreSQL goes through `@prisma/adapter-pg`, wired up in `src/lib/prisma.ts`.
- **Auth is split in two files on purpose.** `proxy.ts` runs on the edge, where Prisma and bcryptjs cannot, so it only imports `auth.config.ts`. The Prisma adapter and credentials provider live in `auth.ts`, which only server code imports.
- **Sessions are JWTs**, not database sessions — required when using a credentials provider.
- **`bun pm trust`** has already been run for `esbuild` and the Prisma engines. A fresh clone may need it again.

## VS Code

`.vscode/extensions.json` lists the recommended extensions (ESLint, Prettier, Tailwind IntelliSense, Prisma, Bun). Accept the prompt on first open, or run **Extensions: Show Recommended Extensions**.

## Push notifications

Every push to this repo sends a Telegram message with the branch, the pusher, the
time (Phnom Penh), and the list of changed files —
`.github/workflows/telegram-notify.yml`.

It needs two **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Where it comes from |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `TELEGRAM_CHAT_ID` | See below |

To find the chat ID, add the bot to the group, send any message there, then open
`https://api.telegram.org/bot<TOKEN>/getUpdates` and read
`result[0].message.chat.id`. Group IDs are negative and supergroups start with
`-100`.

Without both secrets the workflow logs a notice and exits green, so forks and
fresh clones do not get failing runs. Branch deletions are skipped.
