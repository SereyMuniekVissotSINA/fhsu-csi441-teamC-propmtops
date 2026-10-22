import { z } from "zod";

export class UsageError extends Error {
  constructor(readonly status: 400 | 401 | 404 | 409 | 413, message: string) {
    super(message);
  }
}

const id = z.string().min(1).max(100);
const integer = z.number().int().min(0).max(2_147_483_647);
const decimal = z.union([z.string(), z.number().finite()]).transform(String)
  .refine(value => /^(0|[1-9]\d{0,11})(\.\d{1,8})?$/.test(value), "Use a nonnegative decimal with at most 12 integer and 8 fractional digits.");
const timestamp = z.iso.datetime({ offset: true, precision: 3 }).or(z.iso.datetime({ offset: true, precision: 0 }));
const label = z.string().trim().min(1).max(120);
export const USAGE_CURRENCIES = ["USD", "KHR", "EUR", "GBP", "CAD", "AUD", "JPY", "CNY", "INR", "SGD"] as const;

export const usageInputSchema = z.object({
  requestId: id,
  promptVersionId: id,
  inputTokens: integer,
  outputTokens: integer,
  tokenUnit: z.literal("tokens"),
  latency: z.object({ value: decimal, unit: z.enum(["ms", "s"]) }).strict(),
  estimatedCost: z.object({ amount: decimal, currency: z.enum(USAGE_CURRENCIES) }).strict(),
  model: label,
  workload: label,
  measuredAt: timestamp,
}).strict();

/** Exact scaled decimal arithmetic: never silently round money or latency. */
export function scaledDecimal(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || /[1-9]/.test(fraction.slice(scale))) {
    throw new UsageError(400, "Measurement precision exceeds the supported unit.");
  }
  return BigInt(whole) * BigInt(10) ** BigInt(scale) + BigInt(fraction.slice(0, scale).padEnd(scale, "0") || "0");
}

export function normalizeUsage(input: unknown) {
  const parsed = usageInputSchema.safeParse(input);
  if (!parsed.success) throw new UsageError(400, "Invalid usage. Supply a version ID, request ID, nonnegative token counts, latency with ms/s units, estimated cost/currency, model, workload, and ISO timestamp (seconds or milliseconds).");
  const data = parsed.data;
  const latency = scaledDecimal(data.latency.value, data.latency.unit === "s" ? 3 : 0);
  if (latency > BigInt(2_147_483_647)) throw new UsageError(400, "Latency exceeds the supported millisecond range.");
  const cost = scaledDecimal(data.estimatedCost.amount, 8);
  return {
    requestId: data.requestId, promptVersionId: data.promptVersionId,
    inputTokens: data.inputTokens, outputTokens: data.outputTokens,
    latencyMs: Number(latency),
    estimatedCost: `${cost / BigInt(100_000_000)}.${(cost % BigInt(100_000_000)).toString().padStart(8, "0")}`,
    currency: data.estimatedCost.currency, model: data.model, workload: data.workload,
    measuredAt: new Date(data.measuredAt),
  };
}
export type NormalizedUsage = ReturnType<typeof normalizeUsage>;

export function sameUsage(a: Omit<NormalizedUsage, "currency"> & { currency: string }, b: Omit<NormalizedUsage, "currency"> & { currency: string }) {
  return a.requestId === b.requestId && a.promptVersionId === b.promptVersionId
    && a.inputTokens === b.inputTokens && a.outputTokens === b.outputTokens && a.latencyMs === b.latencyMs
    && scaledDecimal(a.estimatedCost, 8) === scaledDecimal(b.estimatedCost, 8)
    && a.currency === b.currency && a.model === b.model && a.workload === b.workload
    && a.measuredAt.getTime() === b.measuredAt.getTime();
}

export const analyticsFilterSchema = z.object({
  start: timestamp, end: timestamp,
  versionId: id.optional(),
  model: label.optional(), workload: label.optional(),
  currency: z.enum(USAGE_CURRENCIES).optional(),
}).strict().refine(data => Date.parse(data.start) < Date.parse(data.end), "Start must be before end.");
export type AnalyticsFilters = z.infer<typeof analyticsFilterSchema>;

export type UsageGroup = {
  promptVersionId: string; model: string; workload: string; currency: string;
  requests: string; inputTokens: string; outputTokens: string; totalTokens: string;
  meanTokens: string; meanLatencyMs: string; estimatedCost: string; meanCost: string;
};

export function usageGroupKey(row: UsageGroup) {
  return JSON.stringify([row.promptVersionId, row.model, row.workload, row.currency]);
}

// Approximate display percentages only; stored money and aggregate totals stay
// exact decimals. Compare per-request means, never totals from unequal samples.
export function observedSavings(baseline: UsageGroup, candidate: UsageGroup) {
  if (baseline.promptVersionId === candidate.promptVersionId || baseline.model !== candidate.model
    || baseline.workload !== candidate.workload || baseline.currency !== candidate.currency
    || Number(baseline.requests) <= 0 || Number(candidate.requests) <= 0) return null;
  function metric(before: string, after: string) {
    const b = Number(before), a = Number(after);
    return { reduction: b - a, percent: b === 0 ? null : (b - a) / b * 100 };
  }
  return { tokens: metric(baseline.meanTokens, candidate.meanTokens),
    latency: metric(baseline.meanLatencyMs, candidate.meanLatencyMs),
    cost: metric(baseline.meanCost, candidate.meanCost) };
}

export async function readUsageJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new UsageError(400, "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new UsageError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) {
        await reader.cancel();
        throw new UsageError(413, "Usage payload exceeds 16 KB.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new UsageError(400, "Invalid JSON body."); }
  } finally { reader.releaseLock(); }
}
