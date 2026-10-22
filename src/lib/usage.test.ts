import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsFilterSchema, normalizeUsage, observedSavings, readUsageJson, sameUsage, scaledDecimal, type UsageGroup } from "./usage";
import { usageCredential } from "./usage-store";
import { generateApiKey } from "./api-keys";

const sample = {
  requestId: "request-1", promptVersionId: "version-2", inputTokens: 60, outputTokens: 40, tokenUnit: "tokens",
  latency: { value: 1.25, unit: "s" }, estimatedCost: { amount: "0.01", currency: "USD" },
  measuredAt: "2026-10-20T12:00:00Z", model: "provider/model", workload: "fixture-v1-temp0",
};
const row: UsageGroup = {
  promptVersionId: "v1", model: "provider/model", workload: "fixture-v1-temp0", currency: "USD",
  requests: "2", inputTokens: "200", outputTokens: "100", totalTokens: "300", meanTokens: "150",
  meanLatencyMs: "2000", estimatedCost: "0.03000000", meanCost: "0.01500000",
};

test("usage normalization preserves exact version, declared units, decimal cost and explicit zero", () => {
  const normalized = normalizeUsage(sample);
  assert.equal(normalized.promptVersionId, "version-2");
  assert.equal(normalized.latencyMs, 1250);
  assert.equal(normalized.estimatedCost, "0.01000000");
  assert.equal(normalized.measuredAt.toISOString(), "2026-10-20T12:00:00.000Z");
  const zero = normalizeUsage({ ...sample, inputTokens: 0, outputTokens: 0, latency: { value: 0, unit: "ms" }, estimatedCost: { amount: "0", currency: "KHR" } });
  assert.equal(zero.latencyMs, 0);
  assert.equal(zero.estimatedCost, "0.00000000");
});

test("canonical retries allow equivalent units, number/string amounts, whitespace labels and timestamp offsets", () => {
  const equivalent = normalizeUsage({ ...sample, latency: { value: "1250.000", unit: "ms" },
    estimatedCost: { amount: 0.01, currency: "USD" }, measuredAt: "2026-10-20T07:00:00.000-05:00", model: " provider/model " });
  assert.ok(sameUsage(normalizeUsage(sample), equivalent));
  for (const change of [
    { promptVersionId: "v-other" }, { inputTokens: 61 }, { outputTokens: 41 }, { model: "other" },
    { workload: "other" }, { measuredAt: new Date("2026-10-20T12:01:00Z") }, { currency: "EUR" },
    { estimatedCost: "0.02" }, { latencyMs: 1251 }, { requestId: "other" },
  ]) assert.equal(sameUsage(equivalent, { ...equivalent, ...change }), false);
});

test("invalid counts, units, dates, precision, currencies, unknown fields and missing measurements are rejected", () => {
  const invalid = [
    { inputTokens: -1 }, { outputTokens: 1.5 }, { inputTokens: 2_147_483_648 },
    { inputTokens: NaN }, { outputTokens: Infinity }, { inputTokens: "60" }, { tokenUnit: "words" },
    { latency: { value: 1, unit: "minutes" } }, { latency: { value: "0.0001", unit: "s" } },
    { latency: { value: "0.1", unit: "ms" } }, { latency: { value: "2147483648", unit: "ms" } },
    { estimatedCost: { amount: "0.000000001", currency: "USD" } },
    { estimatedCost: { amount: "-1", currency: "USD" } }, { estimatedCost: { amount: "1", currency: "ZZZ" } },
    { estimatedCost: { amount: "1000000000000", currency: "USD" } },
    { measuredAt: "2026-02-30T12:00:00Z" }, { measuredAt: "2026-10-20T12:00:00" },
    { workspaceId: "attacker-workspace" }, { model: "" }, { workload: "" }, { latency: undefined },
  ];
  for (const change of invalid) assert.throws(() => normalizeUsage({ ...sample, ...change }));
  assert.equal(scaledDecimal("999999999999.99999999", 8).toString(), "99999999999999999999");
});

test("analytics intervals are explicit, ordered and validate optional filters", () => {
  const interval = { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" };
  assert.ok(analyticsFilterSchema.safeParse(interval).success);
  assert.equal(analyticsFilterSchema.safeParse({ ...interval, end: interval.start }).success, false);
  assert.equal(analyticsFilterSchema.safeParse({ ...interval, currency: "ZZZ" }).success, false);
  assert.equal(analyticsFilterSchema.safeParse({ ...interval, start: "invalid" }).success, false);
});

test("savings compare per-request means, not unequal totals; increases are not labeled savings", () => {
  const candidate = { ...row, promptVersionId: "v2", requests: "1", totalTokens: "120", meanTokens: "120", meanLatencyMs: "1500", meanCost: "0.012" };
  const result = observedSavings(row, candidate)!;
  assert.equal(result.tokens.percent, 20);
  assert.equal(result.tokens.reduction, 30);
  assert.equal(result.latency.percent, 25);
  assert.ok(Math.abs(result.cost.percent! - 20) < 0.00001);
  assert.equal(observedSavings(row, { ...candidate, meanTokens: "180" })?.tokens.percent, -20);
});

test("no fabricated percentages for zero baselines, missing samples or incomparable cohorts", () => {
  assert.equal(observedSavings({ ...row, meanTokens: "0" }, { ...row, promptVersionId: "v2", meanTokens: "10" })?.tokens.percent, null);
  for (const change of [{ model: "other" }, { workload: "other" }, { currency: "EUR" }, { requests: "0" }, { promptVersionId: "v1" }]) {
    assert.equal(observedSavings(row, { ...row, promptVersionId: "v2", ...change }), null);
  }
});

test("usage credentials require a complete workspace bearer key, never a session or payload identity", () => {
  const key = generateApiKey();
  assert.equal(usageCredential(`Bearer ${key.key}`), key.hashedKey);
  for (const header of [null, "", "Basic abc", "Bearer provider-key", `Bearer ${key.key}junk`]) {
    assert.throws(() => usageCredential(header));
  }
});

test("usage reader rejects malformed, non-JSON and oversized bodies before persistence", async () => {
  const request = (body: string, type = "application/json") => new Request("http://localhost/api/usage", { method: "POST", headers: { "Content-Type": type }, body });
  assert.deepEqual(await readUsageJson(request(JSON.stringify(sample))), sample);
  await assert.rejects(readUsageJson(request("{")), /Invalid JSON/);
  await assert.rejects(readUsageJson(request("{}", "text/plain")), /application\/json/);
  await assert.rejects(readUsageJson(request(" ".repeat(16_385))), /16 KB/);
});
