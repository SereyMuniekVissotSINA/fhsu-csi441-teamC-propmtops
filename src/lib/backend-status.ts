import { isAuthConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";

// During the dev phase the app has to stay usable with no database and no
// secrets: `/` and `/demo` must render regardless. Pages that need Prisma ask
// here first and show a "not configured" panel instead of throwing.

let cached: { ready: boolean; checkedAt: number } | undefined;

// Long enough that page renders don't each pay for a probe, short enough that
// starting the database mid-session recovers without a restart.
const TTL_MS = 10_000;

export async function isDatabaseReady(): Promise<boolean> {
  if (cached && Date.now() - cached.checkedAt < TTL_MS) return cached.ready;

  let ready: boolean;
  try {
    await prisma.$queryRaw`SELECT 1`;
    ready = true;
  } catch {
    // Missing file, unapplied migrations, bad DATABASE_URL — all mean the same
    // thing to a caller: don't try to render database-backed content.
    ready = false;
  }

  cached = { ready, checkedAt: Date.now() };
  return ready;
}

/** Bypass the TTL — used right after a migration or seed in dev. */
export function resetDatabaseStatus() {
  cached = undefined;
}

/**
 * True when the app can actually sign someone in — a database to read users
 * from, and the environment NextAuth needs. Pages behind auth check this before
 * touching `auth()`, which would otherwise fail without AUTH_SECRET.
 */
export async function isAuthReady(): Promise<boolean> {
  return isAuthConfigured() && (await isDatabaseReady());
}
