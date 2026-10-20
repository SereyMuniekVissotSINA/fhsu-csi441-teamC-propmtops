"use client";

import { useEffect, useState } from "react";
import { observedSavings, usageGroupKey, USAGE_CURRENCIES, type UsageGroup } from "@/lib/usage";
import { action, field, panel, primary } from "@/lib/ui";

type Version = { id: string; label: string; note: string };
type Filters = { start: string; end: string; versionId: string; model: string; workload: string; currency: string };
const mean = (value: string) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const moneyMean = (value: string) => Number(value).toFixed(8);

export function UsageAnalytics({ promptId, versions, initialStart, initialEnd }: {
  promptId: string; versions: Version[]; initialStart: string; initialEnd: string;
}) {
  const initial = { start: initialStart, end: initialEnd, versionId: "", model: "", workload: "", currency: "" };
  const [draft, setDraft] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [validation, setValidation] = useState("");
  const [revision, setRevision] = useState(0);
  const params = new URLSearchParams({ start: `${applied.start}:00.000Z`, end: `${applied.end}:00.000Z` });
  for (const key of ["versionId", "model", "workload", "currency"] as const) {
    if (applied[key]) params.set(key, applied[key]);
  }
  const url = `/api/prompts/${encodeURIComponent(promptId)}/usage?${params}`;
  function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.start || !draft.end || Date.parse(`${draft.start}Z`) >= Date.parse(`${draft.end}Z`)) {
      setValidation("Choose a start time before the end time.");
      return;
    }
    setValidation("");
    setApplied({ ...draft, model: draft.model.trim(), workload: draft.workload.trim(), currency: draft.currency.trim().toUpperCase() });
    setRevision(value => value + 1);
  }
  return <div className="space-y-6">
    <section className={`${panel} space-y-4`}>
      <h2 className="text-lg font-medium">Usage filters</h2>
      <p className="text-sm text-zinc-400">Times are UTC. The start is included; the end is excluded. Filters take effect when you click Apply.</p>
      <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(["start", "end"] as const).map(key => <label key={key} className="space-y-1 text-sm">
          <span>{key === "start" ? "Start (UTC, inclusive)" : "End (UTC, exclusive)"}</span>
          <input type="datetime-local" required className={field} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
        </label>)}
        <label className="space-y-1 text-sm"><span>Prompt version</span>
          <select className={field} value={draft.versionId} onChange={event => setDraft({ ...draft, versionId: event.target.value })}>
            <option value="">All versions</option>
            {versions.map(v => <option key={v.id} value={v.id}>{v.label} · {v.note || "Saved version"}</option>)}
          </select>
        </label>
        {(["model", "workload", "currency"] as const).map(key => <label key={key} className="space-y-1 text-sm">
          <span className="capitalize">{key} (exact match, optional)</span>
          {key === "currency" ? <select className={field} value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value })}>
            <option value="">All currencies (separate groups)</option>
            {USAGE_CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
          </select> : <input className={field} value={draft[key]} maxLength={120}
            placeholder={key === "workload" ? "support-fixtures-v1-temp0" : "provider/model"}
            onChange={event => setDraft({ ...draft, [key]: event.target.value })} />}
        </label>)}
        <button className={primary} type="submit">Apply / refresh</button>
        {validation ? <p role="alert" className="text-sm text-red-400">{validation}</p> : null}
      </form>
    </section>
    <LoadUsage key={`${url}:${revision}`} url={url} versions={versions} applied={applied} onRetry={() => setRevision(value => value + 1)} />
    <IntegrationHelp versions={versions} />
  </div>;
}

function LoadUsage({ url, versions, applied, onRetry }: { url: string; versions: Version[]; applied: Filters; onRetry: () => void }) {
  const [state, setState] = useState<{ rows?: UsageGroup[]; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load usage.");
        if (!controller.signal.aborted) setState({ rows: data.rows });
      } catch (error) {
        if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : "Could not load usage." });
      }
    }
    void load();
    return () => controller.abort();
  }, [url]);
  return <section className={`${panel} space-y-4`} aria-label="Recorded usage results">
    <h2 className="text-lg font-medium">Recorded usage by prompt version</h2>
    <p className="text-sm text-zinc-400">Applied interval: {applied.start.replace("T", " ")} ≤ measurement time &lt; {applied.end.replace("T", " ")} UTC.
      {applied.model ? ` Model: ${applied.model}.` : ""}{applied.workload ? ` Workload: ${applied.workload}.` : ""}{applied.currency ? ` Currency: ${applied.currency}.` : ""}
      {applied.versionId ? ` Version: ${versions.find(v => v.id === applied.versionId)?.label}.` : ""}</p>
    {state.error ? <div role="alert" className="space-y-3"><p className="text-sm text-red-400">{state.error} Usage is unavailable, not zero.</p>
      <button className={action} type="button" onClick={onRetry}>Retry</button></div>
      : !state.rows ? <p role="status">Loading usage…</p>
        : state.rows.length === 0 ? <p role="status" className="text-zinc-400">No recorded usage matches these filters. No savings can be calculated yet. Send measurements using the integration below.</p>
          : <UsageResults rows={state.rows} versions={versions} />}
  </section>;
}

function UsageResults({ rows, versions }: { rows: UsageGroup[]; versions: Version[] }) {
  const [baselineKey, setBaselineKey] = useState(usageGroupKey(rows[0]));
  const [candidateKey, setCandidateKey] = useState("");
  const baseline = rows.find(row => usageGroupKey(row) === baselineKey);
  const candidate = rows.find(row => usageGroupKey(row) === candidateKey);
  const savings = baseline && candidate ? observedSavings(baseline, candidate) : null;
  function label(row: UsageGroup) {
    return `${versions.find(v => v.id === row.promptVersionId)?.label ?? row.promptVersionId} · ${row.model} · ${row.workload} · ${row.currency}`;
  }
  return <>
    <p className="text-sm text-zinc-400">Each row is one version/model/workload/currency group. Cost totals are reported estimates, not provider bills. Means are rounded for display.</p>
    <div className="overflow-x-auto rounded-lg border border-zinc-800" tabIndex={0} aria-label="Usage table, scroll horizontally">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Usage totals and averages grouped by prompt version, model, workload, and currency</caption>
        <thead className="bg-zinc-900 text-zinc-400"><tr>
          {["Version / model / workload", "Requests", "Input tokens", "Output tokens", "Total tokens", "Avg tokens / request", "Avg latency (ms)", "Estimated total cost", "Avg cost / request"].map(title => <th key={title} scope="col" className="p-3 whitespace-nowrap">{title}</th>)}
        </tr></thead>
        <tbody>{rows.map(row => <tr key={usageGroupKey(row)} className="border-t border-zinc-800">
          <th scope="row" className="max-w-72 min-w-52 p-3 font-normal break-words">{label(row)}</th>
          {[row.requests, row.inputTokens, row.outputTokens, row.totalTokens, mean(row.meanTokens), mean(row.meanLatencyMs),
            `${row.currency} ${row.estimatedCost}`, `${row.currency} ${moneyMean(row.meanCost)}`].map((value, i) => <td key={i} className="p-3 whitespace-nowrap tabular-nums">{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-4 border-t border-zinc-800 pt-4">
      <h3 className="font-medium">Observed savings per request</h3>
      <p className="text-sm text-zinc-400">Select different prompt versions with the same model, workload, and currency. Use a workload label identifying the same test inputs and model settings. Lower token usage does not prove equivalent output quality.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm"><span>Baseline</span>
          <select className={field} value={baselineKey} onChange={event => { setBaselineKey(event.target.value); setCandidateKey(""); }}>
            {rows.map(row => <option key={usageGroupKey(row)} value={usageGroupKey(row)}>{label(row)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm"><span>Candidate</span>
          <select className={field} value={candidateKey} onChange={event => setCandidateKey(event.target.value)}>
            <option value="">Choose a comparable version</option>
            {rows.filter(row => baseline && observedSavings(baseline, row)).map(row => <option key={usageGroupKey(row)} value={usageGroupKey(row)}>{label(row)}</option>)}
          </select>
        </label>
      </div>
      {savings && baseline && candidate ? <div className="space-y-3" role="status">
        <p className="text-sm text-zinc-400">Baseline: {baseline.requests} requests. Candidate: {candidate.requests} requests. Comparison uses averages, not totals.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {([{ title: "Tokens", unit: "tokens", data: savings.tokens }, { title: "Latency", unit: "ms", data: savings.latency },
            { title: "Estimated cost", unit: baseline.currency, data: savings.cost }]).map(({ title, unit, data }) => <div key={title} className="rounded-lg border border-zinc-800 p-4">
            <h4 className="text-sm text-zinc-400">{title} / request</h4>
            <p className={`mt-2 text-lg ${data.reduction > 0 ? "text-emerald-400" : data.reduction < 0 ? "text-amber-400" : "text-zinc-300"}`}>
              {data.percent === null ? "Percentage unavailable" : `${Math.abs(data.percent).toFixed(1)}% ${data.reduction > 0 ? "lower" : data.reduction < 0 ? "higher" : "change"}`}
            </p>
            <p className="mt-1 text-xs text-zinc-400">{Math.abs(data.reduction).toFixed(title === "Estimated cost" ? 8 : 3)} {unit} {data.reduction >= 0 ? "less" : "more"} on average.
              {data.percent === null ? " Baseline is zero." : ""}</p>
          </div>)}
        </div>
        <p className="text-xs text-zinc-400">Observed differences only—not guaranteed future savings or a quality score. Small samples and different inputs can distort results; review outputs before selecting a version.</p>
      </div> : <p className="text-sm text-zinc-400">A comparison needs recorded usage for two different versions in the same model/workload/currency group.</p>}
    </div>
  </>;
}

function IntegrationHelp({ versions }: { versions: Version[] }) {
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const example = {
    requestId: "unique-execution-id", promptVersionId: versionId,
    inputTokens: 100, outputTokens: 50, tokenUnit: "tokens",
    latency: { value: 1.25, unit: "s" },
    estimatedCost: { amount: "0.00015000", currency: "USD" },
    model: "provider/model", workload: "support-fixtures-v1-temp0",
    measuredAt: "2026-10-20T12:00:00.000Z",
  };
  return <details className={`${panel} space-y-3`}>
    <summary className="cursor-pointer font-medium">How to record usage</summary>
    <p className="text-sm text-zinc-400">An external application sends its measured usage after executing a saved prompt. Create a workspace API key as an owner in the dashboard. Keep it server-side. This page does not call an AI provider or automatically record the editor’s draft tests.</p>
    <label className="block space-y-1 text-sm"><span>Executed prompt version (copy its ID in the payload)</span>
      <select className={field} value={versionId} onChange={event => setVersionId(event.target.value)}>
        {versions.map(v => <option key={v.id} value={v.id}>{v.label} · {v.note || "Saved version"}</option>)}
      </select>
    </label>
    <pre className="overflow-auto rounded border border-zinc-800 p-3 text-xs">{`POST /api/usage\nAuthorization: Bearer <workspace-api-key>\nContent-Type: application/json\n\n${JSON.stringify(example, null, 2)}`}</pre>
    <p className="text-xs text-zinc-400">Example values only: replace every measurement, model, workload, and timestamp with actual data. Input/output counts must include all billable tokens reported for that request. Use a new requestId for each execution; retry the same execution with the same ID and payload. Costs are supplied by your application; PromptOps does not guess pricing.</p>
  </details>;
}
