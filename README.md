# Prompt Ops

FHSU CSI 441 — Team C.

## Tech stack

| Layer | Choice | Version |
| --- | --- | --- |
| Framework | Next.js (App Router, Turbopack) | 16.3.4 |
| Language | TypeScript | 5.9 |
| Runtime / package manager | Bun | 1.3.14 |
| Database | SQLite via Prisma ORM | 7.10.0 |
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
bun run db:migrate        # creates dev.db and applies migrations
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
    prisma.ts          Client singleton + better-sqlite3 driver adapter
    query-client.ts    React Query defaults, SSR-safe
    env.ts             Zod-validated environment variables
    validations.ts     Shared Zod schemas
  store/ui-store.ts    Zustand example slice
  types/next-auth.d.ts Session/JWT type augmentation
```

## Notes

- **Prisma 7 needs a driver adapter.** SQLite goes through `@prisma/adapter-better-sqlite3`, wired up in `src/lib/prisma.ts`. Moving to Postgres means swapping that adapter and the `datasource` provider.
- **Auth is split in two files on purpose.** `proxy.ts` runs on the edge, where Prisma and bcryptjs cannot, so it only imports `auth.config.ts`. The Prisma adapter and credentials provider live in `auth.ts`, which only server code imports.
- **Sessions are JWTs**, not database sessions — required when using a credentials provider.
- **`bun pm trust`** has already been run for `better-sqlite3`, `esbuild`, and the Prisma engines. A fresh clone may need it again.

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
