"use client";

import { useMemo, useState, useTransition } from "react";
import { analyzeVersionsAction } from "@/app/dashboard/prompts/[id]/comparison-actions";
import { changedPromptFields, promptLineDiff, snapshotFields, type PromptHistoryVersion } from "@/lib/prompt-history";
import { field, panel, primary } from "@/lib/ui";

export type ComparisonPair = { firstId: string; secondId: string };

export function PromptVersionComparison({ promptId, versions, pair, onChange, onClose, allowAI }: {
  promptId: string; versions: PromptHistoryVersion[]; pair: ComparisonPair;
  onChange: (pair: ComparisonPair) => void; onClose: () => void; allowAI: boolean;
}) {
  const firstIndex = versions.findIndex(version => version.id === pair.firstId);
  const secondIndex = versions.findIndex(version => version.id === pair.secondId);
  // The page supplies newest first; always present the chronological direction.
  const beforeIndex = Math.max(firstIndex, secondIndex);
  const afterIndex = Math.min(firstIndex, secondIndex);
  const before = versions[beforeIndex];
  const after = versions[afterIndex];

  return <section className={`${panel} min-w-0 space-y-4`} aria-label="Compare saved prompt versions">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-medium">Compare versions</h2>
      <button type="button" onClick={onClose} className="text-sm text-zinc-400 underline hover:text-white">Close comparison</button>
    </div>
    <p className="text-sm text-zinc-400">Compare saved prompts, not the unsaved editor draft or attached file versions. History is never overwritten.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {(["firstId", "secondId"] as const).map((key, index) => <label key={key} className="space-y-1 text-sm">
        <span>{index === 0 ? "First version" : "Second version"}</span>
        <select className={field} value={pair[key]} onChange={event => onChange({ ...pair, [key]: event.target.value })}>
          {versions.map((version, i) => <option key={version.id} value={version.id}>v{versions.length - i} · {version.note || "Saved version"}</option>)}
        </select>
      </label>)}
    </div>
    {firstIndex < 0 || secondIndex < 0 ? <p role="alert">A selected version is no longer available.</p>
      : before.id === after.id ? <p role="status" className="text-sm text-zinc-400">Choose two different versions.</p>
        : <ComparisonContent key={`${before.id}:${after.id}`} promptId={promptId} before={before} after={after}
          beforeNumber={versions.length - beforeIndex} afterNumber={versions.length - afterIndex} allowAI={allowAI} />}
  </section>;
}

function ComparisonContent({ promptId, before, after, beforeNumber, afterNumber, allowAI }: {
  promptId: string; before: PromptHistoryVersion; after: PromptHistoryVersion;
  beforeNumber: number; afterNumber: number; allowAI: boolean;
}) {
  const changed = changedPromptFields(before, after);
  const diff = useMemo(() => promptLineDiff(before.body, after.body), [before.body, after.body]);
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState<Awaited<ReturnType<typeof analyzeVersionsAction>> | null>(null);

  function analyze() {
    setResponse(null);
    startTransition(async () => {
      try {
        setResponse(await analyzeVersionsAction({ promptId, firstId: before.id, secondId: after.id }));
      } catch {
        setResponse({ error: "Could not reach the server. Your versions are unchanged; try again." });
      }
    });
  }

  return <>
    <p role="status" className="text-sm text-emerald-400">{changed.length
      ? `v${beforeNumber} → v${afterNumber}: changed ${changed.map(key => key === "body" ? "content" : key).join(", ")}.`
      : "The title, content, and tags are identical. Only commit details may differ."}</p>
    <div className="grid min-w-0 gap-3 xl:grid-cols-2">
      {[{ version: before, number: beforeNumber, label: "Before" }, { version: after, number: afterNumber, label: "After" }].map(({ version, number, label }) => <article key={label} className="min-w-0 rounded-lg border border-zinc-800 p-3">
        <h3 className="font-medium">{label} · v{number}</h3>
        <p className="mt-1 break-words text-xs text-zinc-400">{version.note || "No commit note"}</p>
        <dl className="mt-3 space-y-3">
          {snapshotFields.map(key => <div key={key} className={`rounded p-2 ${changed.includes(key) ? "border border-amber-800 bg-amber-950/20" : "border border-zinc-800"}`}>
            <dt className="mb-1 text-xs capitalize text-zinc-400">{key === "body" ? "Content" : key} · {changed.includes(key) ? "Changed" : "Unchanged"}</dt>
            <dd className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">{version[key] || "(empty)"}</dd>
          </div>)}
        </dl>
      </article>)}
    </div>
    {changed.includes("body") ? <details open>
      <summary className="cursor-pointer text-sm">Content changes · − removed / + added</summary>
      {diff.coarse ? <p className="mt-2 text-xs text-zinc-400">Large comparison: showing complete old and new content instead of matching individual lines.</p> : null}
      <pre tabIndex={0} aria-label="Content differences" className="mt-2 max-h-96 overflow-auto rounded border border-zinc-800 bg-black/30 p-2 text-xs leading-5">
        <code>{diff.lines.map((line, index) => <span key={index} className={`block min-h-5 whitespace-pre-wrap [overflow-wrap:anywhere] ${line.kind === "added" ? "bg-emerald-950/50 text-emerald-300" : line.kind === "removed" ? "bg-red-950/50 text-red-300" : "text-zinc-400"}`}>
          {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}{line.text}
        </span>)}</code>
      </pre>
    </details> : null}
    {allowAI && changed.length > 0 ? <div className="space-y-3 border-t border-zinc-800 pt-4">
      <p className="text-xs text-zinc-400">AI analysis sends both saved prompts to your configured provider. Usage charges/limits apply. It does not run the prompts, create a version, or save the analysis.</p>
      <button type="button" className={primary} disabled={pending} onClick={analyze}>{pending ? "Analyzing changes…" : "Analyze changes with AI"}</button>
      <div aria-live="polite">
        {response?.error ? <p role="alert" className="text-sm text-red-400">{response.error}</p> : null}
        {response?.analysis ? <>
          <p className="text-xs text-zinc-400">{response.analysis.model} · {(response.analysis.elapsedMs / 1000).toFixed(1)}s · AI interpretation; verify against the diff above.</p>
          {response.analysis.incomplete ? <p className="mt-2 text-sm text-amber-400">Partial analysis — the response was incomplete.</p> : null}
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{response.analysis.output}</pre>
        </> : null}
      </div>
    </div> : null}
  </>;
}
