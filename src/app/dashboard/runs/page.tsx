import type { Metadata } from "next";
import Link from "next/link";

import { UNFILED, describeRun, runStats } from "@/lib/agent-runs";
import { canEdit, requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { action, panel } from "@/lib/ui";

import { SnapshotControls } from "./snapshot-controls";

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
  snapshotId: string | null;
  snapshot: { id: string; name: string; slug: string; archivedAt: Date | null } | null;
  agent: string;
  prompt: string;
  createdAt: Date;
  baselineAt: Date | null;
  restoredAt: Date | null;
  restoreRequestedAt: Date | null;
  author: { name: string | null } | null;
  files: { path: string; change: "ADDED" | "MODIFIED" | "REMOVED"; added: number; removed: number }[];
};

type Group = {
  id: string | null;
  name: string;
  slug: string;
  archived: boolean;
  runs: RunRow[];
};

/**
 * Group runs under their snapshot, keeping the order they arrived in — newest
 * first — so the branch worked on most recently leads the page.
 *
 * Grouped by the relation, not by the name: two runs are the same branch
 * because they point at the same snapshot, not because their names match. A
 * run pushed before snapshots belonged to a workspace has none, and collects
 * under one unfiled heading.
 */
function bySnapshot(runs: RunRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const run of runs) {
    const key = run.snapshotId ?? "";
    const group = groups.get(key);
    if (group) {
      group.runs.push(run);
      continue;
    }
    groups.set(key, {
      id: run.snapshot?.id ?? null,
      name: run.snapshot?.name ?? run.category ?? UNFILED,
      slug: run.snapshot?.slug ?? run.categorySlug ?? "",
      archived: Boolean(run.snapshot?.archivedAt),
      runs: [run],
    });
  }
  return [...groups.values()];
}

function stamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

export default async function RunsPage({ searchParams }: PageProps<"/dashboard/runs">) {
  const session = await requireSessionPage("/dashboard/runs");
  const {
    workspace: requested,
    snapshot: filter,
    archived: showArchived,
  } = await searchParams;

  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: session.user.id } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      members: { where: { userId: session.user.id }, select: { role: true } },
    },
  });

  const active = workspaces.find((entry) => entry.slug === requested) ?? workspaces[0];
  const chosen = typeof filter === "string" ? filter : null;
  const archived = showArchived === "1";
  const role = active?.members[0]?.role ?? "VIEWER";

  const runs: RunRow[] = active
    ? await prisma.agentRun.findMany({
        where: {
          workspaceId: active.id,
          // By the relation, so filtering follows the branch rather than a
          // name two branches could share across workspaces.
          ...(chosen ? { snapshot: { slug: chosen } } : {}),
          // Archived branches are out of the way unless asked for, the same
          // rule the snapshots API applies.
          ...(archived || chosen ? {} : { OR: [{ snapshotId: null }, { snapshot: { archivedAt: null } }] }),
        },
        orderBy: { sequence: "desc" },
        take: 100,
        select: {
          id: true,
          sequence: true,
          category: true,
          categorySlug: true,
          snapshotId: true,
          snapshot: { select: { id: true, name: true, slug: true, archivedAt: true } },
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

  // Every branch in the workspace, not just the ones with runs on this page,
  // so filtering down to one never hides where to go back to — and so a branch
  // baselined but never pushed to is still visible as somewhere runs will land.
  const branches = active
    ? await prisma.snapshot.findMany({
        where: { workspaceId: active.id, ...(archived ? {} : { archivedAt: null }) },
        orderBy: [{ baselinedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          baselinedAt: true,
          archivedAt: true,
          _count: { select: { runs: true } },
        },
      })
    : [];

  const groups = bySnapshot(runs);
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

      {branches.length > 0 ? (
        <section className={`${panel} mb-6`}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium tracking-wide text-zinc-400 uppercase">
              Snapshots in {active?.name}
            </h2>
            <Link
              href={archived ? base : `${base}&archived=1`}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              {archived ? "hide archived" : "show archived"}
            </Link>
          </div>

          <ul className="divide-y divide-zinc-800/70">
            {branches.map((branch) => (
              <li key={branch.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link
                  href={`${base}&snapshot=${encodeURIComponent(branch.slug)}`}
                  className={
                    chosen === branch.slug
                      ? "text-sm text-emerald-400"
                      : "text-sm text-zinc-200 hover:text-white"
                  }
                >
                  {branch.name}
                </Link>
                {branch.archivedAt ? (
                  <span className="rounded-md border border-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                    archived
                  </span>
                ) : null}
                <span className="font-mono text-xs text-zinc-600">
                  {branch._count.runs} run{branch._count.runs === 1 ? "" : "s"}
                  {branch.baselinedAt ? ` · baselined ${stamp(branch.baselinedAt)}` : " · never baselined"}
                </span>
                {/* Viewers read the log and nothing else. The server checks
                    again regardless; a hidden control is not a boundary. */}
                {canEdit(role) ? (
                  <div className="ml-auto">
                    <SnapshotControls
                      id={branch.id}
                      name={branch.name}
                      runs={branch._count.runs}
                      archived={Boolean(branch.archivedAt)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {chosen ? (
            <Link href={base} className="mt-3 inline-block text-xs text-emerald-400 hover:text-emerald-300">
              ← all runs in this workspace
            </Link>
          ) : null}
        </section>
      ) : null}

      {runs.length === 0 ? (
        <div className={`${panel} text-sm text-zinc-400`}>
          {chosen ? (
            <p>No runs under that snapshot yet.</p>
          ) : (
            <>
              <p>No runs recorded yet. From the project you want to track:</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-black/60 p-4 font-mono text-xs text-zinc-300">
                {`pops snapshot                      # pick the workspace, name the branch
# …let the agent edit files…
pops push --prompt "what you asked for"`}
              </pre>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.id ?? "unfiled"}>
              <h2 className="mb-3 flex flex-wrap items-baseline gap-3">
                <span className="text-sm font-medium tracking-wide text-zinc-300 uppercase">
                  {group.name}
                </span>
                {group.archived ? (
                  <span className="text-xs text-zinc-600">archived</span>
                ) : null}
                <span className="text-xs text-zinc-600">
                  {group.runs.length} run{group.runs.length === 1 ? "" : "s"}
                </span>
                {group.slug && !chosen ? (
                  <Link
                    href={`${base}&snapshot=${encodeURIComponent(group.slug)}`}
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
