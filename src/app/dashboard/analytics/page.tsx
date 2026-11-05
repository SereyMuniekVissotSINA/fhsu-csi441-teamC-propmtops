import type { Metadata } from "next";
import Link from "next/link";

import {
  dailyRuns,
  formatCount,
  formatDuration,
  incompleteCount,
  latencySummary,
  modelBreakdown,
  tokenTotals,
  type CommitMetric,
  type DayBucket,
} from "@/lib/analytics";
import { requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { panel } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Analytics | PromptOps",
};


/** Windows offered above the charts. 30 days is the default. */
const WINDOWS = [7, 30, 90] as const;
const DEFAULT_WINDOW = 30;

type CommitRow = CommitMetric & {
  promptId: string;
  prompt: { title: string } | null;
};

type PromptUsage = {
  promptId: string;
  title: string;
  runs: number;
};

/**
 * this the busiest part
 *
 * Kept here rather than in `analytics.ts` because it reads a joined title,
 * which is a shape of this page's query rather than a fact about the maths.
 */
function promptBreakdown(rows: CommitRow[]): PromptUsage[] {
  const groups = new Map<string, PromptUsage>();
  for (const row of rows) {
    const existing = groups.get(row.promptId);
    if (existing) {
      existing.runs += 1;
      continue;
    }
    groups.set(row.promptId, {
      promptId: row.promptId,
      // A commit whose prompt was deleted keeps its row via SetNull elsewhere;
      // name it rather than dropping it from a count the totals include.
      title: row.prompt?.title ?? "Deleted prompt",
      runs: 1,
    });
  }
  return [...groups.values()].sort((a, b) => b.runs - a.runs || a.title.localeCompare(b.title));
}

function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p>
      {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
    </div>
  );
}

/**
 * Runs per day as a single-series bar chart.
 *
 * One measure, so one axis and no legend — the heading names the series. Colour
 * carries no information here: every bar is the one accent, and length is the
 * whole encoding, which is why a model or a prompt is never coloured either.
 * `<title>` gives a native hover readout without shipping a client component.
 */
function DailyChart({ buckets }: { buckets: DayBucket[] }) {
  const peak = Math.max(...buckets.map((bucket) => bucket.runs), 1);

  // A viewBox plus width:100% scales to the panel without measuring the DOM.
  const width = 720;
  const height = 160;
  const floor = height - 22; // room beneath the baseline for the date labels
  const slot = width / buckets.length;
  // 2px of surface between bars, so adjacent days stay separate marks.
  const barWidth = Math.max(slot - 2, 1);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full"
      role="img"
      aria-label={`Runs per day over the last ${buckets.length} days, peaking at ${peak}`}
      preserveAspectRatio="none"
    >
      {/* Baseline and a single recessive gridline at the peak: enough to read
          magnitude against, quiet enough not to compete with the bars. */}
      <line x1={0} y1={floor} x2={width} y2={floor} stroke="#27272a" strokeWidth={1} />
      <line x1={0} y1={8} x2={width} y2={8} stroke="#18181b" strokeWidth={1} />

      {buckets.map((bucket, index) => {
        const usable = floor - 8;
        const barHeight = bucket.runs === 0 ? 0 : Math.max((bucket.runs / peak) * usable, 2);
        const x = index * slot + (slot - barWidth) / 2;
        return (
          <g key={bucket.date}>
            <title>
              {bucket.date}: {bucket.runs} run{bucket.runs === 1 ? "" : "s"}
              {bucket.p50 === null ? "" : ` · median ${formatDuration(bucket.p50)}`}
            </title>
            {/* A zero day draws nothing but keeps its slot, so a gap in the
                series reads as a gap rather than closing up. */}
            {barHeight > 0 ? (
              <rect
                x={x}
                y={floor - barHeight}
                width={barWidth}
                height={barHeight}
                rx={2}
                fill="#10b981"
              />
            ) : null}
            {/* Hit target for the tooltip covers the whole slot, including the
                empty space above a short bar and all of a zero day. */}
            <rect x={x} y={8} width={barWidth} height={floor - 8} fill="transparent" />
          </g>
        );
      })}

      {/* Label only the ends, not every bar: the series is read as a shape. */}
      <text x={0} y={height - 6} className="fill-zinc-500" fontSize={11}>
        {buckets[0]?.date.slice(5)}
      </text>
      <text x={width} y={height - 6} textAnchor="end" className="fill-zinc-500" fontSize={11}>
        {buckets[buckets.length - 1]?.date.slice(5)}
      </text>
      <text x={4} y={18} className="fill-zinc-500" fontSize={11}>
        peak {peak}
      </text>
    </svg>
  );
}

/** A labelled magnitude row: name, bar, count. Identity is the text. */
function BarRow({ label, value, peak, hint }: { label: string; value: number; peak: number; hint?: string }) {
  const share = peak === 0 ? 0 : (value / peak) * 100;
  return (
    <li className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-sm text-zinc-300" title={label}>
        {label}
      </span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-900">
        <span
          className="block h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.max(share, 1)}%` }}
        />
      </span>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-zinc-400">
        {formatCount(value)}
        {hint ? <span className="ml-2 text-xs text-zinc-600">{hint}</span> : null}
      </span>
    </li>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: PageProps<"/dashboard/analytics">) {
  const session = await requireSessionPage("/dashboard/analytics");
  const { workspace: requested, days: requestedDays } = await searchParams;

  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: session.user.id } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });

  if (workspaces.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className={`${panel} text-center`}>
          <h1 className="text-xl font-semibold">No workspaces yet</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Analytics appear once a workspace has generation history.
          </p>
        </div>
      </main>
    );
  }

  const active = workspaces.find((entry) => entry.slug === requested) ?? workspaces[0];

  // Only the offered windows are honoured, so the query cannot be widened to an
  // arbitrary range by hand-editing the URL.
  const parsedDays = Number(requestedDays);
  const windowDays = WINDOWS.includes(parsedDays as (typeof WINDOWS)[number])
    ? parsedDays
    : DEFAULT_WINDOW;

  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  const commits: CommitRow[] = await prisma.codeCommit.findMany({
    where: { prompt: { workspaceId: active.id }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      elapsedMs: true,
      inputTokens: true,
      outputTokens: true,
      model: true,
      incomplete: true,
      promptId: true,
      prompt: { select: { title: true } },
    },
  });

  const latency = latencySummary(commits.map((commit) => commit.elapsedMs));
  const tokens = tokenTotals(commits);
  const models = modelBreakdown(commits);
  const prompts = promptBreakdown(commits);
  const buckets = dailyRuns(commits, windowDays, now);
  const incomplete = incompleteCount(commits);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Generation runs in {active.name} over the last {windowDays} days.
        </p>

        {/* Filters in one row above the charts. */}
        <div className="mt-5 flex flex-wrap items-center gap-6">
          {workspaces.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs tracking-wide text-zinc-500 uppercase">Workspace</span>
              {workspaces.map((entry) => (
                <Link
                  key={entry.id}
                  href={`/dashboard/analytics?workspace=${entry.slug}&days=${windowDays}`}
                  className={
                    entry.id === active.id
                      ? "rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-white"
                      : "rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-white"
                  }
                >
                  {entry.name}
                </Link>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <span className="text-xs tracking-wide text-zinc-500 uppercase">Window</span>
            {WINDOWS.map((option) => (
              <Link
                key={option}
                href={`/dashboard/analytics?workspace=${active.slug}&days=${option}`}
                className={
                  option === windowDays
                    ? "rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-white"
                    : "rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-white"
                }
              >
                {option}d
              </Link>
            ))}
          </div>
        </div>
      </header>

      {commits.length === 0 ? (
        <div className={`${panel} text-center`}>
          <h2 className="text-lg font-semibold">No runs in this window</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Generating code from a prompt appends a commit, and these figures follow from
            those. Try a longer window, or run a prompt from its page.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Runs"
              value={formatCount(commits.length)}
              detail={`across ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`}
            />
            <Tile
              label="Median latency"
              value={latency ? formatDuration(latency.p50) : "—"}
              detail={
                latency
                  ? `p95 ${formatDuration(latency.p95)} · max ${formatDuration(latency.max)}`
                  : undefined
              }
            />
            <Tile
              label="Tokens"
              value={formatCount(tokens.total)}
              detail={
                // The coverage note is the honest part: a total over partly
                // unreported usage is a floor, not a measurement.
                tokens.missing > 0
                  ? `${formatCount(tokens.input)} in · ${formatCount(tokens.output)} out · ${tokens.missing} run${tokens.missing === 1 ? "" : "s"} reported none`
                  : `${formatCount(tokens.input)} in · ${formatCount(tokens.output)} out`
              }
            />
            <Tile
              label="Hit output limit"
              value={`${Math.round((incomplete / commits.length) * 100)}%`}
              detail={`${formatCount(incomplete)} of ${formatCount(commits.length)} runs truncated`}
            />
          </section>

          <section className={panel}>
            <h2 className="text-sm font-semibold text-zinc-300">Runs per day</h2>
            <p className="mt-1 mb-4 text-xs text-zinc-500">
              Hover a day for its run count and median latency.
            </p>
            <DailyChart buckets={buckets} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className={panel}>
              <h2 className="mb-4 text-sm font-semibold text-zinc-300">Models</h2>
              <ul className="space-y-3">
                {models.map((entry) => (
                  <BarRow
                    key={entry.model}
                    label={entry.model}
                    value={entry.runs}
                    peak={models[0].runs}
                    hint={formatDuration(entry.p50)}
                  />
                ))}
              </ul>
              <p className="mt-4 text-xs text-zinc-600">Run count, with median latency.</p>
            </section>

            <section className={panel}>
              <h2 className="mb-4 text-sm font-semibold text-zinc-300">Busiest prompts</h2>
              <ul className="space-y-3">
                {prompts.slice(0, 8).map((entry) => (
                  <BarRow
                    key={entry.promptId}
                    label={entry.title}
                    value={entry.runs}
                    peak={prompts[0].runs}
                  />
                ))}
              </ul>
              {prompts.length > 8 ? (
                <p className="mt-4 text-xs text-zinc-600">
                  Showing the top 8 of {prompts.length}.
                </p>
              ) : null}
            </section>
          </div>

          {/* A table view of the same numbers, so nothing on this page is
              readable only as a bar length. */}
          <section className={panel}>
            <h2 className="mb-4 text-sm font-semibold text-zinc-300">Model detail</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs tracking-wide text-zinc-500 uppercase">
                    <th className="pb-2 pr-4 font-medium">Model</th>
                    <th className="pb-2 pr-4 text-right font-medium">Runs</th>
                    <th className="pb-2 pr-4 text-right font-medium">Median</th>
                    <th className="pb-2 text-right font-medium">Truncated</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {models.map((entry) => (
                    <tr key={entry.model} className="border-b border-zinc-900 last:border-0">
                      <td className="py-2 pr-4">{entry.model}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCount(entry.runs)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatDuration(entry.p50)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatCount(entry.incomplete)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
