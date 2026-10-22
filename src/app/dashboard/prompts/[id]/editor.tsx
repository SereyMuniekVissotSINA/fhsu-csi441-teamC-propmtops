"use client";

import { useActionState, useMemo, useState } from "react";

import { composePrompt, variableNames } from "@/lib/demo-prompts";
import { field, panel, primary } from "@/lib/ui";

import { savePromptAction, type FormState } from "../../actions";

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
  editable,
}: {
  id: string;
  versions: Version[];
  editable: boolean;
}) {
  const latest = versions[0];
  const [body, setBody] = useState(latest.body);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [result, setResult] = useState<{ output: string; model: string; elapsedMs: number; incomplete: boolean; usage?: { input_tokens: number; output_tokens: number } | null } | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePromptAction,
    {},
  );

  // Reused from the demo rather than reimplemented — both are pure functions
  // with no browser dependency (src/lib/demo-prompts.ts).
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
        body: JSON.stringify({ input: preview }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not run this prompt.");
      setResult(data);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Could not run this prompt.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
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

      {process.env.NODE_ENV === "development" && editable ? (
        <section className={`${panel} space-y-3 lg:col-start-1 lg:row-start-2`}>
          <h2 className="text-lg font-medium">Test with AI</h2>
          <p className="text-sm text-zinc-400">Sends the current draft and variable values to your configured AI provider. Provider usage limits and pricing apply. Results are not saved.</p>
          <button type="button" className={primary} onClick={runPrompt} disabled={running || missingVariables || !preview.trim() || preview.length > 16000}>
            {running ? "Running…" : "Run test"}
          </button>
          {missingVariables ? <p className="text-sm text-zinc-400">Fill in every variable above to run.</p> : null}
          {preview.length > 16000 ? <p className="text-sm text-zinc-400">Limit the composed prompt to 16,000 characters.</p> : null}
          {runError ? <p role="alert" className="text-sm text-red-400">{runError}</p> : null}
          <div aria-live="polite">
            {result ? <>
              <p className="text-xs text-zinc-400">{result.model} · {(result.elapsedMs / 1000).toFixed(1)}s{result.usage ? ` · ${result.usage.input_tokens} input / ${result.usage.output_tokens} output tokens` : ""}</p>
              {result.incomplete ? <p className="text-sm text-amber-400">Response is incomplete; it may have reached the output limit.</p> : null}
              <pre className="mt-3 whitespace-pre-wrap break-words text-sm">{result.output || "No text returned."}</pre>
            </> : null}
          </div>
        </section>
      ) : null}

      <aside className={`${panel} lg:col-start-2 lg:row-start-1`}>
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
      </aside>
    </div>
  );
}
