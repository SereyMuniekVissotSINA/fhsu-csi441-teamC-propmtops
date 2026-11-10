import Link from "next/link";

import { page, panel, primary } from "@/lib/ui";

/**
 * Shown instead of a Prisma stack trace when the database is not reachable.
 *
 * The landing page never touches Prisma, so it keeps rendering; every page that
 * does need the database lands here with the setup steps instead of throwing.
 */
export function BackendUnavailable({ what = "This page" }: { what?: string }) {
  return (
    <main className={`${page} flex flex-col items-center justify-center px-6`}>
      <div className={`${panel} max-w-lg text-center`}>
        <p className="font-mono text-sm text-amber-400">BACKEND UNAVAILABLE</p>

        <h1 className="mt-3 text-2xl font-semibold">{what} needs a database</h1>

        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          {what} is temporarily unavailable. Please try again shortly.
        </p>

        {process.env.NODE_ENV === "development" ? (
          <p className="mt-5 text-left text-xs leading-relaxed text-zinc-400">
            Check the server logs and database connection settings. Restart with
            <code> bun run dev </code> to regenerate the database client. Check
            migration status before applying migrations to an existing database.
          </p>
        ) : null}

        <div className="mt-6 flex justify-center gap-3">
          <Link className={primary} href="/">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
