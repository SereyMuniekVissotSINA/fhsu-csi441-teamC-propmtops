import type { Metadata } from "next";
import Link from "next/link";

import { UNCATEGORISED, describeRun, runStats } from "@/lib/agent-runs";
import { requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { action, panel } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Agent runs | PromptOps",
};

// The log of what coding agents did to local projects in this workspace,
// filed under the snapshot category each run was pushed from: workspace, then
// category, then the runs.
//
// Scoped on membership inside the query, the way the prompt pages are: a run in
// someone else's workspace is indistinguishable from one that is not there.

type RunRow = {
  id: string;
  sequence: number;
  category: string;
  categorySlug: string;
  agent: string;
  prompt: string;
  createdAt: Date;
  baselineAt: Date | null;
  restoredAt: Date | null;
  restoreRequestedAt: Date | null;
  author: { name: string | null } | null;
  files: { path: string; change: "ADDED" | "MODIFIED" | "REMOVED"; added: number; removed: number }[];
};

/**
 * Group runs into their containers, keeping the order they arrived in — newest
 * first — so the category worked on most recently leads the page.
 */
function byCategory(runs: RunRow[]): { name: string; slug: string; runs: RunRow[] }[] {
  const groups = new Map<string, { name: string; slug: string; runs: RunRow[] }>();
  for (const run of runs) {
    const slug = run.categorySlug || "";
    const group = groups.get(slug);
    if (group) group.runs.push(run);
    else groups.set(slug, { name: run.category || UNCATEGORISED, slug, runs: [run] });
  }
  return [...groups.values()];
}

function stamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

export default async function RunsPage({ searchParams }: PageProps<"/dashboard/runs">) {
  const session = await requireSessionPage("/dashboard/runs");
  const { workspace: requested, category: filter } = await searchParams;

  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: session.user.id } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });

  const active = workspaces.find((entry) => entry.slug === requested) ?? workspaces[0];
  const chosen = typeof filter === "string" ? filter : null;

  const runs: RunRow[] = active
    ? await prisma.agentRun.findMany({
        where: {
          workspaceId: active.id,
          ...(chosen ? { categorySlug: chosen } : {}),
        },
        orderBy: { sequence: "desc" },
        take: 100,
        select: {
          id: true,
          sequence: true,
          category: true,
          categorySlug: true,
          agent: true,
          prompt: true,
          createdAt: true,
          baselineAt: true,
          restoredAt: true,
          restoreRequestedAt: true,
          author: { select: { name: true } },
          files: {
            orderBy: { path: "asc" },
            select: { path: true, change: true, added: true, removed: true },
          },
        },
      })
    : [];

  // The filter chips list every container in the workspace, not just the ones
  // on this page, so filtering down to one never hides where to go back to.
  const allCategories = active
    ? await prisma.agentRun.groupBy({
        by: ["categorySlug", "category"],
        where: { workspaceId: active.id },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      })
    : [];

  const groups = byCategory(runs);
  const base = `/dashboard/runs?workspace=${active?.slug ?? ""}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agent runs</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            What a coding agent changed on a local project, taken from the filesystem rather
            than from the agent&apos;s own account of it. Runs are filed under the snapshot
            they were measured against, and each one can be undone on the machine that holds
            the files.
          </p>
        </div>

        {workspaces.length > 1 ? (
          <nav className="flex flex-wrap gap-2">
            {workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                href={`/dashboard/runs?workspace=${workspace.slug}`}
                className={
                  workspace.id === active?.id ? `${action} border-emerald-500 text-emerald-400` : action
                }
              >
                {workspace.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {allCategories.length > 1 || chosen ? (
        <nav className="mb-6 flex flex-wrap items-center gap-2">
          <Link
            href={base}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              chosen
                ? "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                : "border-emerald-500 text-emerald-400"
            }`}
          >
            All runs
          </Link>
          {allCategories.map((entry) => (
            <Link
              key={entry.categorySlug}
              href={`${base}&category=${encodeURIComponent(entry.categorySlug)}`}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                chosen === entry.categorySlug
                  ? "border-emerald-500 text-emerald-400"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              {entry.category || UNCATEGORISED}
              <span className="ml-2 text-zinc-600">{entry._count._all}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {runs.length === 0 ? (
        <div className={`${panel} text-sm text-zinc-400`}>
          {chosen ? (
            <p>No runs in that category.</p>
          ) : (
            <>
              <p>No runs recorded yet. From the project you want to track:</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-black/60 p-4 font-mono text-xs text-zinc-300">
                {`pops snapshot                      # names the snapshot, then baselines
# …let the agent edit files…
pops push --prompt "what you asked for"`}
              </pre>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.slug || "uncategorised"}>
              <h2 className="mb-3 flex flex-wrap items-baseline gap-3">
                <span className="text-sm font-medium tracking-wide text-zinc-300 uppercase">
                  {group.name}
                </span>
                <span className="text-xs text-zinc-600">
                  {group.runs.length} run{group.runs.length === 1 ? "" : "s"}
                </span>
                {group.slug && !chosen ? (
                  <Link
                    href={`${base}&category=${encodeURIComponent(group.slug)}`}
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    only this one
                  </Link>
                ) : null}
              </h2>

              <ul className="space-y-3">
                {group.runs.map((run) => {
                  const stats = runStats(run.files);
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/dashboard/runs/${run.id}`}
                        className={`${panel} block transition hover:border-zinc-700`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="font-medium">
                            <span className="mr-2 font-mono text-xs text-emerald-400">
                              r{run.sequence}
                            </span>
                            {describeRun(run.files)}
                          </h3>
                          <span className="shrink-0 font-mono text-xs text-zinc-500">
                            {stats.files} file{stats.files === 1 ? "" : "s"} · +{stats.added} −
                            {stats.removed}
                          </span>
                        </div>

                        {run.prompt ? (
                          <p className="mt-2 line-clamp-2 font-mono text-xs text-zinc-500">
                            {run.prompt}
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                          {run.agent ? (
                            <span className="rounded-md border border-zinc-800 px-2 py-0.5 text-zinc-400">
                              {run.agent}
                            </span>
                          ) : null}
                          {run.restoredAt ? (
                            <span className="rounded-md border border-emerald-900 px-2 py-0.5 text-emerald-400">
                              restored
                            </span>
                          ) : run.restoreRequestedAt ? (
                            <span className="rounded-md border border-amber-900 px-2 py-0.5 text-amber-400">
                              restore requested
                            </span>
                          ) : null}
                          <span className="ml-auto">
                            {run.author?.name ?? "Unknown"} · {stamp(run.createdAt)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
