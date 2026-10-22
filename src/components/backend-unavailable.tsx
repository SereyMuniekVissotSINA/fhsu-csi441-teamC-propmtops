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
        <p className="font-mono text-sm text-amber-400">BACKEND NOT CONFIGURED</p>

        <h1 className="mt-3 text-2xl font-semibold">{what} needs a database</h1>

        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          The app is running, but it cannot reach the database. Apply the
          migrations and it will pick them up without a restart.
        </p>

        <pre className="mt-5 overflow-x-auto rounded-lg border border-zinc-800 bg-black/60 p-4 text-left font-mono text-xs text-zinc-300">
          cp .env.example .env{"\n"}
          bunx auth secret{"\n"}
          bun run db:migrate{"\n"}
          bun run db:seed
        </pre>

        <div className="mt-6 flex justify-center gap-3">
          <Link className={primary} href="/">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
