"use client";

import { useActionState, useMemo, useState } from "react";

import { composePrompt, variableNames } from "@/lib/prompts-core";
import { field, panel, primary } from "@/lib/ui";
import { PromptFiles } from "@/components/prompt-files";
import type { PromptFileInfo } from "@/lib/file-policy";

import { savePromptAction, type FormState } from "../../actions";
import { CodeCommitLog, type CommitSummary } from "./code-commits";

type Version = {
  id: string;
  title: string;
  body: string;
  tags: string;
  note: string;
  createdAt: string;
  authorName: string | null;
};

export function PromptEditor({
  id,
  versions,
  commits,
  editable,
  initialFiles,
  aiTestingEnabled,
}: {
  id: string;
  versions: Version[];
  commits: CommitSummary[];
  editable: boolean;
  initialFiles: PromptFileInfo[];
  aiTestingEnabled: boolean;
}) {
  const latest = versions[0];
  const [body, setBody] = useState(latest.body);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [runError, setRunError] = useState("");
  const [files, setFiles] = useState(initialFiles);
  const [selectedFileVersion, setSelectedFileVersion] = useState(initialFiles[0]?.versions[0]?.id ?? "");
  const [result, setResult] = useState<{ output: string; model: string; elapsedMs: number; incomplete: boolean; fileVersion?: { id: string; version: number }; usage?: { input_tokens: number; output_tokens: number } | null } | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePromptAction,
    {},
  );

  // Shared with the CLI rather than reimplemented — both are pure functions
  // with no browser dependency (src/lib/prompts-core.ts).
  const variables = useMemo(() => variableNames(body), [body]);
  const preview = useMemo(() => composePrompt(body, values), [body, values]);
  const missingVariables = variables.some((name) => !values[name]?.trim());

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

          <input
            className={field}
            name="title"
            defaultValue={latest.title}
            required
            maxLength={120}
            disabled={!editable}
            aria-label="Title"
          />

          <textarea
            className={`${field} min-h-64 font-mono`}
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            disabled={!editable}
            aria-label="Prompt body"
          />

          <input
            className={field}
            name="tags"
            defaultValue={latest.tags}
            placeholder="Tags, comma separated"
            disabled={!editable}
            aria-label="Tags"
          />

          <input
            className={field}
            name="note"
            placeholder="What changed? (saved with this version)"
            maxLength={240}
            disabled={!editable}
            aria-label="Change note"
          />

          {state.error ? (
            <p role="alert" className="text-sm text-red-400">
              {state.error}
            </p>
          ) : null}

          {editable ? (
            <button className={primary} type="submit" disabled={pending}>
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
      </div>

      <aside aria-label="Files, AI testing, and prompt history" className="min-w-0 space-y-6">
        <PromptFiles promptId={id} files={files} selected={selectedFileVersion} onSelect={setSelectedFileVersion} onFiles={setFiles} onUploadingChange={setUploading} editable={editable} busy={running}>
      {aiTestingEnabled && editable ? (
        <section className="space-y-3 border-y border-zinc-800 py-4">
          <h2 className="text-lg font-medium">Test with AI</h2>
          <p className="text-sm text-zinc-400">Sends the current draft, variable values, and selected file content to your configured AI provider. Provider usage limits and pricing apply. File results are saved as new versions; prompt-only results are not saved. Review generated files before using them; code is not executed or tested.</p>
          <button type="button" className={`${primary} w-full`} onClick={runPrompt} disabled={running || uploading || missingVariables || !preview.trim() || preview.length > 16000}>
            {running ? "Working on your request…" : selectedFileVersion ? "Run AI & save revised file" : "Run test"}
          </button>
          {missingVariables ? <p className="text-sm text-zinc-400">Fill in every variable in the prompt preview to run.</p> : null}
          {preview.length > 16000 ? <p className="text-sm text-zinc-400">Limit the composed prompt to 16,000 characters.</p> : null}
          {runError ? <p role="alert" className="text-sm text-red-400">{runError}</p> : null}
          <div aria-live="polite">
            {result ? <>
              <p className="text-xs text-zinc-400">{result.model} · {(result.elapsedMs / 1000).toFixed(1)}s{result.usage ? ` · ${result.usage.input_tokens} input / ${result.usage.output_tokens} output tokens` : ""}</p>
              {result.incomplete ? <p className="text-sm text-amber-400">Response is incomplete; it may have reached the output limit.</p> : null}
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap wrap-break-word text-sm">{result.output || "No text returned."}</pre>
              {result.fileVersion ? <a className="mt-3 inline-block text-emerald-400 underline" href={`/api/prompts/${id}/files/${result.fileVersion.id}`}>Download revised file · v{result.fileVersion.version}</a> : null}
            </> : null}
          </div>
        </section>
      ) : null}
        </PromptFiles>

      <CodeCommitLog
        promptId={id}
        promptVersionId={latest.id}
        initialCommits={commits}
        input={preview}
        editable={editable}
        blocked={
          missingVariables
            ? "Fill in every variable above to generate."
            : !preview.trim()
              ? "Write a prompt before generating."
              : preview.length > 16000
                ? "Limit the composed prompt to 16,000 characters."
                : undefined
        }
      />

      <section aria-label="Prompt history" className={`${panel} wrap-anywhere`}>
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

              {index !== 0 && editable ? (
                <button
                  type="button"
                  onClick={() => setBody(version.body)}
                  className="mt-2 text-xs text-zinc-400 underline hover:text-white"
                >
                  Load into editor
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      </aside>
    </div>
  );
}
