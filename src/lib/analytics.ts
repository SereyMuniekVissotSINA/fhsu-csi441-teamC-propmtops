// Aggregation maths for the analytics page.
//
// Import-free for the same reason `prompts-core.ts` is: the page reads it, the
// tests read it, and nothing here should drag Prisma or an environment variable
// into either. It takes plain rows and returns plain numbers.
//
// Everything aggregates columns `CodeCommit` already stores — `elapsedMs`,
// `inputTokens`, `outputTokens`, `model`, `incomplete`. There is deliberately
// no cost figure: the schema records no price, and inventing one from a
// hardcoded rate table would be a number that looks authoritative and is not.

/** One generation run, reduced to the fields the aggregates actually read. */
export type CommitMetric = {
  createdAt: Date;
  elapsedMs: number;
  // Nullable in the schema — a provider that reported no usage leaves these
  // unset, which is why token totals carry their own coverage count below.
  inputTokens: number | null;
  outputTokens: number | null;
  model: string;
  incomplete: boolean;
};

/**
 * Nearest-rank percentile: the smallest observed value at or above the given
 * fraction of the sorted series.
 *
 * Nearest-rank rather than interpolating, because every result is then a
 * latency that actually happened. For the sample sizes a student project
 * produces — tens of runs, not millions — an interpolated p95 invents a
 * millisecond figure no run ever recorded.
 *
 * `fraction` is 0..1. Returns null for an empty series rather than 0, because
 * "no runs" and "instant" are different answers.
 */
export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const rank = Math.ceil(clamped * sorted.length);
  // ceil(0) is 0 for fraction 0; the lowest observation is the answer there.
  return sorted[Math.max(rank - 1, 0)];
}

export type LatencySummary = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
};

/**
 * Latency distribution in milliseconds. Null when there is nothing to
 * summarize, so the caller renders an empty state instead of a row of zeros.
 */
export function latencySummary(values: number[]): LatencySummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    // Non-null by construction: the series is known non-empty here.
    p50: percentile(sorted, 0.5)!,
    p95: percentile(sorted, 0.95)!,
    p99: percentile(sorted, 0.99)!,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export type TokenTotals = {
  input: number;
  output: number;
  total: number;
  /** Runs that reported usage. */
  measured: number;
  /** Runs that did not, so a total can be read as the floor it really is. */
  missing: number;
};

/**
 * Token totals with their coverage.
 *
 * The coverage counts are the point: `inputTokens` is nullable, so a sum on its
 * own cannot distinguish "these runs used 400 tokens" from "most runs never
 * reported usage". A run counts as measured when it reported either side.
 */
export function tokenTotals(rows: CommitMetric[]): TokenTotals {
  let input = 0;
  let output = 0;
  let measured = 0;

  for (const row of rows) {
    const hasUsage = row.inputTokens !== null || row.outputTokens !== null;
    if (!hasUsage) continue;
    measured += 1;
    input += row.inputTokens ?? 0;
    output += row.outputTokens ?? 0;
  }

  return {
    input,
    output,
    total: input + output,
    measured,
    missing: rows.length - measured,
  };
}

export type ModelUsage = {
  model: string;
  runs: number;
  /** Median latency for this model, so a slow provider is visible. */
  p50: number;
  incomplete: number;
};

/** Models used, most-used first. Ties break by name so the order is stable. */
export function modelBreakdown(rows: CommitMetric[]): ModelUsage[] {
  const groups = new Map<string, { latencies: number[]; incomplete: number }>();

  for (const row of rows) {
    // A commit written before `model` was recorded has an empty string; it is
    // still a run, and hiding it would make the counts disagree with the total.
    const key = row.model || "unknown";
    const group = groups.get(key) ?? { latencies: [], incomplete: 0 };
    group.latencies.push(row.elapsedMs);
    if (row.incomplete) group.incomplete += 1;
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([model, group]) => ({
      model,
      runs: group.latencies.length,
      p50: percentile(group.latencies, 0.5)!,
      incomplete: group.incomplete,
    }))
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));
}

export type DayBucket = {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  runs: number;
  /** Null on a day with no runs — not zero, which would plot as a real datum. */
  p50: number | null;
};

/** The UTC calendar day a timestamp falls in. */
function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Runs per day over a trailing window, oldest first, including days with no
 * runs so the series has even spacing and a gap reads as a gap.
 *
 * `now` is a parameter rather than a `Date.now()` call so the tests are not
 * time-dependent. Buckets are UTC days: the alternative is the server's local
 * zone, which would silently move every boundary with deployment.
 */
export function dailyRuns(rows: CommitMetric[], days: number, now: Date): DayBucket[] {
  const span = Math.max(Math.floor(days), 1);
  const byDay = new Map<string, number[]>();

  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(row.elapsedMs);
    else byDay.set(key, [row.elapsedMs]);
  }

  const buckets: DayBucket[] = [];
  const cursor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const DAY_MS = 86_400_000;

  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const key = dayKey(new Date(cursor - offset * DAY_MS));
    const latencies = byDay.get(key);
    buckets.push({
      date: key,
      runs: latencies?.length ?? 0,
      p50: latencies ? percentile(latencies, 0.5)! : null,
    });
  }

  return buckets;
}

/** Runs that hit the provider's output limit. */
export function incompleteCount(rows: CommitMetric[]): number {
  return rows.reduce((total, row) => total + (row.incomplete ? 1 : 0), 0);
}

/**
 * Share of runs that stopped at the output limit, 0..1. Null with no runs, so
 * the caller shows "—" rather than a reassuring 0%.
 */
export function incompleteRate(rows: CommitMetric[]): number | null {
  if (rows.length === 0) return null;
  return incompleteCount(rows) / rows.length;
}

/** Milliseconds as a short human string: `820ms`, `1.4s`, `2m 05s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Thousands separators without pulling in `Intl` formatting options. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
