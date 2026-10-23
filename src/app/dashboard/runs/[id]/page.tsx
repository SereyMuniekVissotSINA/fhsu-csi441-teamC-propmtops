import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FileDiff } from "@/components/file-diff";
import {
  UNCATEGORISED,
  describeRestore,
  describeRun,
  parseToolEvents,
  restoreSteps,
  runStats,
} from "@/lib/agent-runs";
import { canEdit, requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { panel } from "@/lib/ui";

import { RestoreRun } from "./restore-run";

export const metadata: Metadata = {
  title: "Agent run | PromptOps",
};

const changeLabel = { ADDED: "added", MODIFIED: "changed", REMOVED: "deleted" } as const;

export default async function RunPage({ params }: PageProps<"/dashboard/runs/[id]">) {
  const { id } = await params;
  const session = await requireSessionPage(`/dashboard/runs/${id}`);

  const run = await prisma.agentRun.findFirst({
    // Scoped by membership in the same query: a run in someone else's
    // workspace is indistinguishable from one that does not exist.
    where: { id, workspace: { members: { some: { userId: session.user.id } } } },
    include: {
      workspace: {
        select: {
          name: true,
          slug: true,
          members: { where: { userId: session.user.id }, select: { role: true } },
        },
      },
      author: { select: { name: true } },
      restoreRequestedBy: { select: { name: true } },
      files: { orderBy: { path: "asc" } },
    },
  });

  if (!run) notFound();

  const role = run.workspace.members[0]?.role ?? "VIEWER";
  const stats = runStats(run.files);
  const steps = restoreSteps(run.files);
  const events = parseToolEvents(run.toolEvents);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
        <Link className="hover:text-white" href={`/dashboard/runs?workspace=${run.workspace.slug}`}>
          ← Agent runs
        </Link>
        {/* The container this run is filed under, as a way back into it. */}
        <span aria-hidden="true">/</span>
        <Link
          className="hover:text-white"
          href={`/dashboard/runs?workspace=${run.workspace.slug}${
            run.categorySlug ? `&category=${encodeURIComponent(run.categorySlug)}` : ""
          }`}
        >
          {run.category || UNCATEGORISED}
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="text-2xl font-semibold">
          <span className="mr-3 font-mono text-base text-emerald-400">r{run.sequence}</span>
          {describeRun(run.files)}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {run.author?.name ?? "Unknown"} · {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
          {run.agent ? ` · ${run.agent}` : ""} · {stats.files} file
          {stats.files === 1 ? "" : "s"} · +{stats.added} −{stats.removed}
        </p>
        {run.baselineAt ? (
          <p className="mt-1 text-xs text-zinc-500">
            Measured against the {run.category || UNCATEGORISED} baseline taken{" "}
            {run.baselineAt.toISOString().slice(0, 16).replace("T", " ")}.
          </p>
        ) : null}
        {run.root ? (
          <p className="mt-1 font-mono text-xs text-zinc-600">{run.root}</p>
        ) : null}
        {run.restoredAt ? (
          <p className="mt-2 text-xs text-emerald-400">
            Restored {run.restoredAt.toISOString().slice(0, 16).replace("T", " ")}.
          </p>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {run.prompt ? (
            <section className={panel}>
              <h2 className="mb-3 text-sm font-medium tracking-wide text-zinc-400 uppercase">
                Prompt
              </h2>
              <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-zinc-200">
                {run.prompt}
              </pre>
            </section>
          ) : null}

          {run.response ? (
            <section className={panel}>
              <h2 className="mb-3 text-sm font-medium tracking-wide text-zinc-400 uppercase">
                What the agent said
              </h2>
              <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-zinc-300">
                {run.response}
              </pre>
              <p className="mt-3 text-xs text-zinc-500">
                Kept for the record only. The file changes below come from the filesystem.
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-sm font-medium tracking-wide text-zinc-400 uppercase">
              Files
            </h2>
            <div className="space-y-4">
              {run.files.map((file) => (
                <article
                  key={file.id}
                  className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60"
                >
                  <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
                    <span className="font-mono text-xs break-all text-zinc-200">{file.path}</span>
                    <span className="rounded-md border border-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                      {changeLabel[file.change]}
                    </span>
                    <span className="ml-auto font-mono text-xs text-zinc-500">
                      +{file.added} −{file.removed}
                    </span>
                  </header>
                  <FileDiff before={file.before} after={file.after} />
                </article>
              ))}
            </div>
          </section>

          {events.length > 0 ? (
            <section className={panel}>
              <h2 className="mb-3 text-sm font-medium tracking-wide text-zinc-400 uppercase">
                Tool events
              </h2>
              <pre className="max-h-96 overflow-auto font-mono text-xs text-zinc-400">
                {JSON.stringify(events, null, 2)}
              </pre>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          {/* Viewers can read a run and nothing else, so the control is not
              rendered for them at all. */}
          {canEdit(role) ? (
            <section className={panel}>
              <h2 className="mb-2 text-sm font-medium tracking-wide text-zinc-400 uppercase">
                Undo this run
              </h2>
              <p className="mb-4 text-xs text-zinc-500">
                {describeRestore(steps)}, in {run.root || "the project directory"}.
              </p>
              <RestoreRun
                id={run.id}
                sequence={run.sequence}
                requested={Boolean(run.restoreRequestedAt)}
                restoredAt={run.restoredAt?.toISOString() ?? null}
              />
              {run.restoreRequestedAt && run.restoreRequestedBy?.name ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Asked for by {run.restoreRequestedBy.name}.
                </p>
              ) : null}
            </section>
          ) : (
            <section className={`${panel} text-xs text-zinc-500`}>
              Undoing a run needs the editor role.
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
