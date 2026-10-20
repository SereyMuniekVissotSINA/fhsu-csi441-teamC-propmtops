"use client";

import { useActionState, useMemo, useRef, useState } from "react";

import { composePrompt, variableNames } from "@/lib/demo-prompts";
import { field, panel, primary } from "@/lib/ui";
import { PromptFiles } from "@/components/prompt-files";
import { FileVersionComparison } from "@/components/file-version-comparison";
import type { FileComparisonPair } from "@/lib/file-comparison";
import type { PromptFileInfo } from "@/lib/file-policy";
import { PromptVersionComparison, type ComparisonPair } from "@/components/prompt-version-comparison";
import { draftAfterSave, loadPromptDraft, type PromptDraft, type PromptHistoryVersion } from "@/lib/prompt-history";

import { savePromptAction, type FormState } from "../../actions";

export function PromptEditor({
  id,
  versions,
  editable,
  initialFiles,
  aiTestingEnabled,
}: {
  id: string;
  versions: PromptHistoryVersion[];
  editable: boolean;
  initialFiles: PromptFileInfo[];
  aiTestingEnabled: boolean;
}) {
  const latest = versions[0];
  const [draft, setDraft] = useState(() => loadPromptDraft(latest));
  const [baseline, setBaseline] = useState(() => loadPromptDraft(latest));
  const { title, body, tags, note } = draft;
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(latest.id);
  const [editorMessage, setEditorMessage] = useState("");
  const [comparison, setComparison] = useState<ComparisonPair | null>(null);
  const [fileComparison, setFileComparison] = useState<FileComparisonPair | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [runError, setRunError] = useState("");
  const [files, setFiles] = useState(initialFiles);
  const comparedFile = files.find(file => file.id === fileComparison?.fileId);
  const [selectedFileVersion, setSelectedFileVersion] = useState(initialFiles[0]?.versions[0]?.id ?? "");
  const [result, setResult] = useState<{ output: string; model: string; elapsedMs: number; incomplete: boolean; fileVersion?: { id: string; version: number }; usage?: { input_tokens: number; output_tokens: number } | null } | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (previous, formData) => {
      setEditorMessage("");
      let next: FormState;
      try {
        next = await savePromptAction(previous, formData);
      } catch {
        return { error: "Could not confirm the save. Your draft has been kept; check History before retrying." };
      }
      if (next.success && !next.error) {
        const cleared = draftAfterSave(draft, next);
        setDraft(cleared);
        setBaseline(cleared);
        setLoadedVersionId(null);
        setValues({});
        setResult(null);
        setRunError("");
        setEditorMessage("Saved as a new version. The prompt and commit note are cleared for your next entry. Load any saved version from History to continue editing it.");
      }
      return next;
    },
    {},
  );

  function updateDraft(change: Partial<PromptDraft>) {
    setDraft(current => ({ ...current, ...change }));
    setEditorMessage("");
  }

  function loadVersion(version: PromptHistoryVersion) {
    const dirty = (Object.keys(draft) as (keyof PromptDraft)[]).some(key => draft[key] !== baseline[key]);
    if (dirty && !window.confirm("Replace your unsaved draft with this saved version?")) return;
    const restored = loadPromptDraft(version);
    setDraft(restored);
    setBaseline(restored);
    setLoadedVersionId(version.id);
    setValues({});
    setResult(null);
    setRunError("");
    setEditorMessage(`Loaded v${versions.length - versions.findIndex(item => item.id === version.id)}. Saved history is unchanged.`);
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    editorRef.current?.focus({ preventScroll: true });
  }

  function compareVersion(version: PromptHistoryVersion) {
    const other = version.id === latest.id ? versions[1] : latest;
    if (!other) return;
    setComparison({ firstId: version.id, secondId: other.id });
    setFileComparison(null);
    requestAnimationFrame(() => comparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // Reused from the demo rather than reimplemented — both are pure functions
  // with no browser dependency (src/lib/demo-prompts.ts).
  const variables = useMemo(() => variableNames(body), [body]);
  const preview = useMemo(() => composePrompt(body, values), [body, values]);
  const missingVariables = variables.some((name) => !values[name]?.trim());

  function compareFile(pair: FileComparisonPair) {
    setFileComparison(pair);
    setComparison(null);
    requestAnimationFrame(() => comparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function runPrompt() {
    setRunning(true);
    setRunError("");
    setResult(null);
    try {
      const response = await fetch(`/api/prompts/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: preview, ...(selectedFileVersion ? { fileVersionId: selectedFileVersion } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not run this prompt.");
      setResult(data);
      if (data.files) setFiles(data.files);
      if (data.fileVersion) setSelectedFileVersion(data.fileVersion.id);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Could not run this prompt.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-6">
        <form action={formAction} className={`${panel} space-y-3`}>
          <input type="hidden" name="id" value={id} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">Prompt editor</h2>
            <span className="text-xs text-zinc-400">{loadedVersionId
              ? `${editable ? "Editing from" : "Viewing"} v${versions.length - versions.findIndex(version => version.id === loadedVersionId)}`
              : "New entry · saved history preserved"}</span>
          </div>
          {editorMessage ? <p role="status" className="text-sm text-emerald-400">{editorMessage}</p> : null}

          <input
            className={field}
            name="title"
            value={title}
            onChange={event => updateDraft({ title: event.target.value })}
            required
            maxLength={120}
            disabled={!editable || pending}
            aria-label="Title"
          />

          <textarea
            ref={editorRef}
            className={`${field} min-h-64 font-mono`}
            name="body"
            value={body}
            onChange={(event) => updateDraft({ body: event.target.value })}
            placeholder="Write the prompt for your next version, or load a saved version from History."
            required
            readOnly={!editable}
            disabled={pending}
            aria-label="Prompt body"
          />

          <input
            className={field}
            name="tags"
            value={tags}
            onChange={event => updateDraft({ tags: event.target.value })}
            placeholder="Tags, comma separated"
            disabled={!editable || pending}
            aria-label="Tags"
          />

          <input
            className={field}
            name="note"
            value={note}
            onChange={event => updateDraft({ note: event.target.value })}
            placeholder="What changed? (saved with this version)"
            maxLength={240}
            disabled={!editable || pending}
            aria-label="Change note"
          />

          {state.error ? (
            <p role="alert" className="text-sm text-red-400">
              {state.error}
            </p>
          ) : null}

          {editable ? (
            <button className={primary} type="submit" disabled={pending || running || uploading || !body.trim() || !title.trim()}>
              {pending ? "Saving…" : "Save as new version"}
            </button>
          ) : (
            <p className="text-sm text-zinc-500">
              You have view-only access to this workspace.
            </p>
          )}
        </form>

        {variables.length > 0 ? (
          <div className={panel}>
            <h2 className="mb-4 text-sm font-medium tracking-wide text-zinc-400 uppercase">
              Preview
            </h2>

            <div className="space-y-2">
              {variables.map((name) => (
                <label key={name} className="block">
                  <span className="font-mono text-xs text-zinc-500">{name}</span>
                  <input
                    className={field}
                    value={values[name] ?? ""}
                    onChange={(event) =>
                      setValues((previous) => ({
                        ...previous,
                        [name]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>

            <pre className="mt-4 overflow-x-auto rounded-lg border border-zinc-800 bg-black/60 p-4 font-mono text-xs whitespace-pre-wrap text-zinc-300">
              {preview}
            </pre>
          </div>
        ) : null}
        <div ref={comparisonRef} className="scroll-mt-6">
          {fileComparison && comparedFile ? <FileVersionComparison promptId={id} file={comparedFile} pair={fileComparison}
            onChange={setFileComparison} onClose={() => setFileComparison(null)} allowAI={editable && aiTestingEnabled} /> : null}
          {comparison ? <PromptVersionComparison promptId={id} versions={versions} pair={comparison}
            onChange={setComparison} onClose={() => setComparison(null)} allowAI={editable && aiTestingEnabled} /> : null}
        </div>
      </div>

      <aside aria-label="Files, AI testing, and prompt history" className="min-w-0 space-y-6">
        <PromptFiles promptId={id} files={files} selected={selectedFileVersion} onSelect={setSelectedFileVersion} onFiles={setFiles} onUploadingChange={setUploading} onCompare={compareFile} editable={editable} busy={running || pending}>
      {aiTestingEnabled && editable ? (
        <section className="space-y-3 border-y border-zinc-800 py-4">
          <h2 className="text-lg font-medium">Test with AI</h2>
          <p className="text-sm text-zinc-400">Sends the current draft, variable values, and selected file content to your configured AI provider. Provider usage limits and pricing apply. File results are saved as new versions; prompt-only results are not saved. Review generated files before using them; code is not executed or tested.</p>
          <button type="button" className={`${primary} w-full`} onClick={runPrompt} disabled={pending || running || uploading || missingVariables || !preview.trim() || preview.length > 16000}>
            {running ? "Working on your request…" : selectedFileVersion ? "Run AI & save revised file" : "Run test"}
          </button>
          {missingVariables ? <p className="text-sm text-zinc-400">Fill in every variable in the prompt preview to run.</p> : null}
          {preview.length > 16000 ? <p className="text-sm text-zinc-400">Limit the composed prompt to 16,000 characters.</p> : null}
          {runError ? <p role="alert" className="text-sm text-red-400">{runError}</p> : null}
          <div aria-live="polite">
            {result ? <>
              <p className="text-xs text-zinc-400">{result.model} · {(result.elapsedMs / 1000).toFixed(1)}s{result.usage ? ` · ${result.usage.input_tokens} input / ${result.usage.output_tokens} output tokens` : ""}</p>
              {result.incomplete ? <p className="text-sm text-amber-400">Response is incomplete; it may have reached the output limit.</p> : null}
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{result.output || "No text returned."}</pre>
              {result.fileVersion ? <a className="mt-3 inline-block text-emerald-400 underline" href={`/api/prompts/${id}/files/${result.fileVersion.id}`}>Download revised file · v{result.fileVersion.version}</a> : null}
            </> : null}
          </div>
        </section>
      ) : editable ? <p className="text-sm text-zinc-400">AI testing is not enabled on this server. Your uploaded files and their history are still available.</p> : null}
        </PromptFiles>

      <section aria-label="Prompt history" className={`${panel} [overflow-wrap:anywhere]`}>
        <h2 className="mb-4 text-sm font-medium tracking-wide text-zinc-400 uppercase">
          History ({versions.length})
        </h2>

        <ol className="space-y-4">
          {versions.map((version, index) => (
            <li key={version.id} className="border-l-2 border-zinc-800 pl-4">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-emerald-400">
                  v{versions.length - index}
                </span>
                {index === 0 ? (
                  <span className="text-xs text-zinc-500">current</span>
                ) : null}
              </div>

              <p className="mt-1 text-sm text-zinc-300">{version.note}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {version.authorName ?? "Unknown"} · {version.createdAt.slice(0, 10)}
              </p>

              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => loadVersion(version)}
                  disabled={pending || running}
                  className="text-xs text-zinc-400 underline hover:text-white disabled:opacity-40"
                >
                  Load v{versions.length - index}
                </button>
                {versions.length > 1 ? <button type="button" onClick={() => compareVersion(version)}
                  className="text-xs text-emerald-400 underline hover:text-emerald-300">
                  {index === 0 ? "Compare with previous" : "Compare with latest"}
                </button> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
      </aside>
    </div>
  );
}
