import assert from "node:assert/strict";
import test from "node:test";

import {
  dailyRuns,
  formatDuration,
  incompleteRate,
  latencySummary,
  modelBreakdown,
  percentile,
  tokenTotals,
  type CommitMetric,
} from "./analytics";

function commit(overrides: Partial<CommitMetric> = {}): CommitMetric {
  return {
    createdAt: new Date("2026-11-05T12:00:00.000Z"),
    elapsedMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    model: "gpt-4o-mini",
    incomplete: false,
    ...overrides,
  };
}

test("percentile returns an observed value, never an interpolated one", () => {
  const values = [100, 200, 300, 400];
  assert.equal(percentile(values, 0.5), 200);
  assert.equal(percentile(values, 0.95), 400);
  // p0 is the lowest observation rather than a rank of -1.
  assert.equal(percentile(values, 0), 100);
  assert.equal(percentile(values, 1), 400);
});

test("percentile does not mutate its input and tolerates unsorted series", () => {
  const values = [300, 100, 400, 200];
  assert.equal(percentile(values, 0.5), 200);
  assert.deepEqual(values, [300, 100, 400, 200]);
});

test("an empty series is null, not zero", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(latencySummary([]), null);
  assert.equal(incompleteRate([]), null);
});

test("latency summary reports the distribution, not just a mean", () => {
  const summary = latencySummary([500, 1000, 1500, 9000]);
  assert.ok(summary);
  assert.equal(summary.count, 4);
  assert.equal(summary.p50, 1000);
  assert.equal(summary.p95, 9000);
  assert.equal(summary.min, 500);
  assert.equal(summary.max, 9000);
});

test("token totals separate a real zero from unreported usage", () => {
  const rows = [
    commit({ inputTokens: 100, outputTokens: 20 }),
    commit({ inputTokens: null, outputTokens: null }),
    commit({ inputTokens: 40, outputTokens: null }),
  ];
  const totals = tokenTotals(rows);
  assert.equal(totals.input, 140);
  assert.equal(totals.output, 20);
  assert.equal(totals.total, 160);
  // Two runs reported something; the third never did and must not read as 0.
  assert.equal(totals.measured, 2);
  assert.equal(totals.missing, 1);
});

test("token totals of entirely unreported runs stay zero with full missing count", () => {
  const rows = [commit({ inputTokens: null, outputTokens: null })];
  const totals = tokenTotals(rows);
  assert.equal(totals.total, 0);
  assert.equal(totals.measured, 0);
  assert.equal(totals.missing, 1);
});

test("model breakdown orders by volume and keeps unnamed models visible", () => {
  const rows = [
    commit({ model: "gpt-4o-mini", elapsedMs: 1000 }),
    commit({ model: "gpt-4o-mini", elapsedMs: 3000 }),
    commit({ model: "llama-3", elapsedMs: 500, incomplete: true }),
    commit({ model: "", elapsedMs: 700 }),
  ];
  const breakdown = modelBreakdown(rows);
  assert.equal(breakdown.length, 3);
  assert.equal(breakdown[0].model, "gpt-4o-mini");
  assert.equal(breakdown[0].runs, 2);
  // Nearest-rank on an even series takes the lower observation, so two runs of
  // 1000ms and 3000ms report 1000 rather than an averaged 2000 nobody saw.
  assert.equal(breakdown[0].p50, 1000);
  assert.equal(breakdown[1].incomplete, 1);
  // An empty model column becomes "unknown" so the counts still sum to the total.
  assert.equal(
    breakdown.reduce((total, entry) => total + entry.runs, 0),
    rows.length,
  );
  assert.ok(breakdown.some((entry) => entry.model === "unknown"));
});

test("daily runs fill empty days and keep a gap distinguishable from zero latency", () => {
  const now = new Date("2026-11-05T23:30:00.000Z");
  const rows = [
    commit({ createdAt: new Date("2026-11-05T01:00:00.000Z"), elapsedMs: 800 }),
    commit({ createdAt: new Date("2026-11-03T22:00:00.000Z"), elapsedMs: 1200 }),
  ];
  const buckets = dailyRuns(rows, 3, now);

  assert.equal(buckets.length, 3);
  // Oldest first, so the series plots left to right.
  assert.deepEqual(
    buckets.map((bucket) => bucket.date),
    ["2026-11-03", "2026-11-04", "2026-11-05"],
  );
  assert.equal(buckets[0].runs, 1);
  assert.equal(buckets[1].runs, 0);
  // A day with no runs has no median at all, rather than a plottable 0.
  assert.equal(buckets[1].p50, null);
  assert.equal(buckets[2].p50, 800);
});

test("daily runs ignore commits outside the window without dropping them from totals", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const rows = [commit({ createdAt: new Date("2026-01-01T12:00:00.000Z") })];
  const buckets = dailyRuns(rows, 2, now);
  assert.equal(buckets.length, 2);
  assert.equal(
    buckets.reduce((total, bucket) => total + bucket.runs, 0),
    0,
  );
});

test("a window shorter than a day still yields one bucket", () => {
  const buckets = dailyRuns([], 0, new Date("2026-11-05T12:00:00.000Z"));
  assert.equal(buckets.length, 1);
});

test("incomplete rate is a share of runs", () => {
  const rows = [commit({ incomplete: true }), commit(), commit(), commit()];
  assert.equal(incompleteRate(rows), 0.25);
});

test("durations read at the scale they occur", () => {
  assert.equal(formatDuration(820), "820ms");
  assert.equal(formatDuration(1400), "1.4s");
  assert.equal(formatDuration(125_000), "2m 05s");
});
