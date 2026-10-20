"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { analyzeFileVersionsAction } from "@/app/dashboard/prompts/[id]/file-comparison-actions";
import { FileCodePreview } from "@/components/file-code-preview";
import { fileComparisonText, fileComparisonVersions, type FileComparisonPair } from "@/lib/file-comparison";
import type { FileVersionInfo, PromptFileInfo } from "@/lib/file-policy";
import { promptLineDiff } from "@/lib/prompt-history";
import { field, panel, primary } from "@/lib/ui";

export function FileVersionComparison({ promptId, file, pair, onChange, onClose, allowAI }: {
  promptId: string; file: PromptFileInfo; pair: FileComparisonPair;
  onChange: (pair: FileComparisonPair) => void; onClose: () => void; allowAI: boolean;
}) {
  const versions = fileComparisonVersions(file, pair);
  return <section className={`${panel} min-w-0 space-y-4`} aria-label="Compare saved file versions">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-medium">Compare file versions</h2>
      <button type="button" onClick={onClose} className="text-sm text-zinc-400 underline">Close comparison</button>
    </div>
    <p className="break-words font-medium">{file.name}</p>
    <p className="text-sm text-zinc-400">Compare saved file content, not prompt history. PDF/Word: extracted text only. Excel: stored cell values, not formulas. Layout, images, and formatting are not compared. Saved files stay unchanged.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {(["firstId", "secondId"] as const).map((key, index) => <label key={key} className="min-w-0 space-y-1 text-sm">
        <span>{index === 0 ? "First file version" : "Second file version"}</span>
        <select className={field} value={pair[key]} onChange={event => onChange({ ...pair, [key]: event.target.value })}>
          {file.versions.map(version => <option key={version.id} value={version.id}>v{version.version}{version.version === 1 ? " (original)" : ""}</option>)}
        </select>
      </label>)}
    </div>
    {versions ? <LoadComparison key={`${promptId}:${file.id}:${versions.before.id}:${versions.after.id}`}
      promptId={promptId} file={file} before={versions.before} after={versions.after} allowAI={allowAI} />
      : <p role="status" className="text-sm text-zinc-400">Choose two different available versions of this file.</p>}
  </section>;
}

type ContentProps = { promptId: string; file: PromptFileInfo; before: FileVersionInfo; after: FileVersionInfo; allowAI: boolean };

function LoadComparison(props: ContentProps) {
  const { promptId, before, after } = props;
  const [texts, setTexts] = useState<[string, string] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const values = await Promise.all([before.id, after.id].map(async id => {
          const response = await fetch(`/api/prompts/${encodeURIComponent(promptId)}/files/${encodeURIComponent(id)}?preview=1`, { signal: controller.signal, cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not load these file versions.");
          if (typeof data.text !== "string") throw new Error("The file preview was invalid. Please try again.");
          return data.text as string;
        }));
        if (!controller.signal.aborted) setTexts([values[0], values[1]]);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load these file versions.");
      }
    }
    void load();
    return () => controller.abort();
  }, [promptId, before.id, after.id]);
  if (error) return <p role="alert" className="text-sm text-red-400">{error} Close and reopen the comparison to retry.</p>;
  if (!texts) return <p role="status" className="text-sm text-zinc-400">Loading both file versions…</p>;
  return <LoadedComparison {...props} texts={texts} />;
}

function LoadedComparison({ promptId, file, before, after, allowAI, texts }: ContentProps & { texts: [string, string] }) {
  const formatted = useMemo(() => texts.map(text => fileComparisonText(text, file.kind)), [texts, file.kind]);
  const diff = useMemo(() => promptLineDiff(formatted[0], formatted[1]), [formatted]);
  const changed = texts[0] !== texts[1];
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState<Awaited<ReturnType<typeof analyzeFileVersionsAction>> | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  function analyze() {
    setResponse(null);
    startTransition(async () => {
      try { setResponse(await analyzeFileVersionsAction({ promptId, fileId: file.id, firstId: before.id, secondId: after.id })); }
      catch { setResponse({ error: "Could not reach the server. Your files are unchanged; try again." }); }
    });
  }
  return <>
    <p role="status" className="text-sm text-emerald-400">v{before.version} → v{after.version}: {changed ? "file content changed." : "extracted file contents are identical."}</p>
    {changed ? <div>
      <h3 className="text-sm">File content changes · − removed / + added</h3>
      {diff.coarse ? <p className="mt-2 text-xs text-zinc-400">Large comparison: showing complete old and new content instead of matching individual lines.</p> : null}
      <pre tabIndex={0} aria-label="File content differences" className="mt-2 max-h-96 overflow-auto rounded border border-zinc-800 bg-black/30 p-2 text-xs leading-5">
        <code>{diff.lines.map((line, index) => <span key={index} className={`block min-h-5 whitespace-pre-wrap [overflow-wrap:anywhere] ${line.kind === "added" ? "bg-emerald-950/50 text-emerald-300" : line.kind === "removed" ? "bg-red-950/50 text-red-300" : "text-zinc-400"}`}>
          {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}{line.text}
        </span>)}</code>
      </pre>
    </div> : null}
    <details onToggle={event => setShowSnapshots(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm text-emerald-400">View both file contents</summary>
      {showSnapshots ? <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
        {[before, after].map((version, index) => <article key={version.id} className="min-w-0 space-y-2">
          <h3 className="text-sm">{index === 0 ? "Before" : "After"} · v{version.version}</h3>
          <a className="text-xs underline" href={`/api/prompts/${promptId}/files/${version.id}`}>Download v{version.version}</a>
          <FileCodePreview text={formatted[index]} name={file.name} kind={file.kind} />
        </article>)}
      </div> : null}
    </details>
    {allowAI && changed ? <div className="space-y-3 border-t border-zinc-800 pt-4">
      <p className="text-xs text-zinc-400">AI analysis sends both saved file contents to your configured provider. Usage charges/limits apply. It does not execute code, save the analysis, or create a file version.</p>
      <button type="button" className={primary} disabled={pending} onClick={analyze}>{pending ? "Analyzing file changes…" : "Analyze file changes with AI"}</button>
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
