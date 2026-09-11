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
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePromptAction,
    {},
  );

  // Reused from the demo rather than reimplemented — both are pure functions
  // with no browser dependency (src/lib/demo-prompts.ts).
  const variables = useMemo(() => variableNames(body), [body]);
  const preview = useMemo(() => composePrompt(body, values), [body, values]);

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

      <aside className={panel}>
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
