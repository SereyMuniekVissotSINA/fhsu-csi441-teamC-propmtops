import Link from "next/link";

import { action, page, panel, primary } from "@/lib/ui";

/**
 * Shown instead of a Prisma stack trace when the database is not reachable.
 *
 * During the dev phase the app has to stay usable with no database and no
 * secrets — `/` and `/demo` never touch Prisma, and the pages that do land here.
 */
export function BackendUnavailable({ what = "This page" }: { what?: string }) {
  return (
    <main className={`${page} flex flex-col items-center justify-center px-6`}>
      <div className={`${panel} max-w-lg text-center`}>
        <p className="font-mono text-sm text-amber-400">BACKEND NOT CONFIGURED</p>

        <h1 className="mt-3 text-2xl font-semibold">{what} needs a database</h1>

        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          The app is running, but it cannot reach the database. Everything else
          still works — the demo workspace runs entirely in your browser.
        </p>

        <pre className="mt-5 overflow-x-auto rounded-lg border border-zinc-800 bg-black/60 p-4 text-left font-mono text-xs text-zinc-300">
          cp .env.example .env{"\n"}
          bunx auth secret{"\n"}
          bun run db:migrate{"\n"}
          bun run db:seed
        </pre>

        <div className="mt-6 flex justify-center gap-3">
          <Link className={primary} href="/demo">
            Open the demo
          </Link>
          <Link className={action} href="/">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
