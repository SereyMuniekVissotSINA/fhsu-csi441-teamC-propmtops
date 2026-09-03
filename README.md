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
