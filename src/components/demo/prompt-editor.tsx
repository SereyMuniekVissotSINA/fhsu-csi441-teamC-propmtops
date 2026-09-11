"use client";

import { useId, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import {
  composePrompt,
  demoContentSchema,
  variableNames,
  type DemoContent,
  type DemoPrompt,
  type DemoVersion,
} from "@/lib/demo-prompts";
import { cn } from "@/lib/utils";

const action =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";
const primary = cn(
  action,
  "border-emerald-500 bg-emerald-500 text-black hover:bg-emerald-400",
);
const field =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400";
const blank: DemoContent = { title: "", body: "", tags: "" };

function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function PromptEditor({
  prompt,
  memoryOnly,
  canEdit,
  initialView = "editor",
  onDirty,
  onSave,
  onDelete,
}: {
  prompt?: DemoPrompt;
  memoryOnly: boolean;
  canEdit: boolean;
  initialView?: "editor" | "preview" | "history";
  onDirty: (dirty: boolean) => void;
  onSave: (content: DemoContent, note: string) => DemoPrompt;
  onDelete: () => void;
}) {
  const viewId = useId();
  const latest = prompt?.versions.at(-1);
  const [draft, setDraft] = useState<DemoContent>(latest ?? blank);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"editor" | "preview" | "history">(initialView);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const isDirty =
    draft.title !== (latest?.title ?? "") ||
    draft.body !== (latest?.body ?? "") ||
    draft.tags !== (latest?.tags ?? "") ||
    !!note;
  const variables = variableNames(draft.body);

  function change(key: keyof DemoContent, value: string) {
    if (!canEdit) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    setError("");
    setCopied(false);
    onDirty(
      next.title !== (latest?.title ?? "") ||
        next.body !== (latest?.body ?? "") ||
        next.tags !== (latest?.tags ?? "") ||
        !!note,
    );
  }

  function save(content = draft, versionNote = note) {
    if (!canEdit) return;
    const parsed = demoContentSchema.safeParse(content);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      setTab("editor");
      return;
    }
    try {
      const updated = onSave(parsed.data, versionNote.trim());
      setDraft(updated.versions.at(-1)!);
      setNote("");
      setError("");
      onDirty(false);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
      aria-label="Prompt editor"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 p-5">
        <div>
          <h2 className="text-lg font-semibold">
            {prompt ? "Prompt details" : "Create a prompt"}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {isDirty
              ? "Unsaved changes"
              : prompt
                ? `Version ${prompt.versions.length} · ${memoryOnly ? "Session only" : "Saved locally"}`
                : "Start with an idea. Refine it over time."}
          </p>
        </div>
        <div className="flex gap-2">
          {!canEdit && (
            <span className="text-sm text-zinc-400">Viewer · Read only</span>
          )}
          {prompt && canEdit && (
            <button
              className={action}
              aria-label="Delete prompt"
              onClick={() => {
                try {
                  onDelete();
                } catch (reason) {
                  setError(messageOf(reason));
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
          {canEdit && (
            <button
              className={primary}
              disabled={!!prompt && !isDirty}
              onClick={() => save()}
            >
              <Check size={15} />
              {prompt ? "Save new version" : "Create prompt"}
            </button>
          )}
        </div>
      </div>
      <div
        className="flex gap-5 border-b border-zinc-800 px-5"
        role="tablist"
        aria-label="Prompt views"
        onKeyDown={(event) => {
          const tabs = ["editor", "preview", "history"] as const;
          const index = tabs.indexOf(tab);
          const next =
            event.key === "ArrowRight"
              ? tabs[(index + 1) % 3]
              : event.key === "ArrowLeft"
                ? tabs[(index + 2) % 3]
                : event.key === "Home"
                  ? tabs[0]
                  : event.key === "End"
                    ? tabs[2]
                    : null;
          if (!next) return;
          event.preventDefault();
          setTab(next);
          setCopied(false);
          document.getElementById(`${viewId}-tab-${next}`)?.focus();
        }}
      >
        {(["editor", "preview", "history"] as const).map((view) => (
          <button
            key={view}
            id={`${viewId}-tab-${view}`}
            role="tab"
            tabIndex={tab === view ? 0 : -1}
            aria-selected={tab === view}
            aria-controls={`${viewId}-panel-${view}`}
            className={`border-b-2 py-4 text-sm capitalize ${tab === view ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-400 hover:text-white"}`}
            onClick={() => {
              setTab(view);
              setCopied(false);
            }}
          >
            {view}
            {view === "history" && ` (${prompt?.versions.length ?? 0})`}
          </button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="mx-5 mt-5 rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}
      <div
        role="tabpanel"
        id={`${viewId}-panel-${tab}`}
        aria-labelledby={`${viewId}-tab-${tab}`}
        tabIndex={0}
        className="p-5 md:p-6"
      >
        {tab === "editor" && (
          <div className="space-y-5">
            <label className="block text-sm font-medium">
              Title
              <input
                className={`${field} mt-2`}
                readOnly={!canEdit}
                value={draft.title}
                maxLength={120}
                onChange={(event) => change("title", event.target.value)}
                placeholder="e.g. Customer support assistant"
              />
            </label>
            <label className="block text-sm font-medium">
              Prompt content
              <textarea
                className={`${field} mt-2 min-h-64 resize-y font-mono leading-7`}
                readOnly={!canEdit}
                value={draft.body}
                maxLength={20000}
                onChange={(event) => change("body", event.target.value)}
                placeholder={
                  "You are a helpful assistant for {{company}}.\n\nHelp the user with {{question}}."
                }
              />
              <span className="mt-2 flex justify-between gap-3 text-xs font-normal text-zinc-500">
                <span>Use {"{{variable_name}}"} for dynamic values.</span>
                <span>{draft.body.length.toLocaleString()} / 20,000</span>
              </span>
            </label>
            <label className="block text-sm font-medium">
              Tags
              <input
                className={`${field} mt-2`}
                readOnly={!canEdit}
                value={draft.tags}
                maxLength={200}
                onChange={(event) => change("tags", event.target.value)}
                placeholder="support, writing, engineering"
              />
            </label>
            {canEdit && (
              <label className="block text-sm font-medium">
                Change note{" "}
                <span className="font-normal text-zinc-500">(optional)</span>
                <input
                  className={`${field} mt-2`}
                  value={note}
                  maxLength={240}
                  onChange={(event) => {
                    setNote(event.target.value);
                    onDirty(
                      !!event.target.value ||
                        draft.title !== (latest?.title ?? "") ||
                        draft.body !== (latest?.body ?? "") ||
                        draft.tags !== (latest?.tags ?? ""),
                    );
                  }}
                  placeholder="What changed in this version?"
                />
              </label>
            )}
          </div>
        )}
        {tab === "preview" && (
          <div className="space-y-5">
            <div>
              <h3 className="font-medium">Try your variables</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Fill in sample values to see the composed prompt. Empty values
                keep their placeholders.
              </p>
            </div>
            {variables.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {variables.map((name) => (
                  <label
                    key={name}
                    className="block font-mono text-xs text-emerald-400"
                  >
                    {name}
                    <input
                      className={`${field} mt-2 font-sans`}
                      value={values[name] ?? ""}
                      onChange={(event) => {
                        setValues({ ...values, [name]: event.target.value });
                        setCopied(false);
                      }}
                      placeholder={`Value for ${name}`}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                Add a {"{{variable}}"} in the editor to try dynamic content.
              </p>
            )}
            <pre className="min-h-48 whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-[#080808] p-5 font-mono text-sm leading-7 text-zinc-300">
              {composePrompt(draft.body, values) ||
                "Your prompt preview will appear here."}
            </pre>
            <button
              className={action}
              disabled={!draft.body.trim()}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    composePrompt(draft.body, values),
                  );
                  setCopied(true);
                  setError("");
                } catch {
                  setError(
                    "Clipboard access is unavailable. Select and copy the preview text manually.",
                  );
                }
              }}
            >
              {copied ? "Copied!" : "Copy composed prompt"}
            </button>
          </div>
        )}
        {tab === "history" && (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-zinc-400">
              Each save adds a snapshot. Restoring an earlier version creates a
              new version and preserves the history.
            </p>
            {!prompt && (
              <p className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                Create your prompt to start its version history.
              </p>
            )}
            {prompt && <VersionComparison versions={prompt.versions} />}
            {prompt?.versions.toReversed().map((version, index) => (
              <article
                key={version.id}
                className="rounded-lg border border-zinc-800 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      <span className="mr-2 font-mono text-emerald-400">
                        v{prompt.versions.length - index}
                      </span>
                      {version.note}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {version.author || "Demo author"} ·{" "}
                      {new Date(version.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {index === 0 ? (
                    <span className="text-xs text-emerald-400">
                      Current version
                    </span>
                  ) : canEdit ? (
                    <button
                      className={action}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Restore version ${prompt.versions.length - index} as a new version?${isDirty ? " Unsaved edits will be discarded." : ""}`,
                          )
                        )
                          save(
                            version,
                            `Restored from v${prompt.versions.length - index}`,
                          );
                      }}
                    >
                      Restore as new version
                    </button>
                  ) : null}
                </div>
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-zinc-400 hover:text-white">
                    View snapshot
                  </summary>
                  <h4 className="mt-4 font-medium">{version.title}</h4>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-zinc-400">
                    {version.body}
                  </pre>
                  <p className="mt-3 text-xs text-zinc-500">
                    Tags: {version.tags || "None"}
                  </p>
                </details>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function VersionComparison({ versions }: { versions: DemoVersion[] }) {
  const [olderId, setOlderId] = useState(versions.at(-2)?.id ?? versions[0].id);
  // Keep the right-hand side on the latest save until a specific version is chosen.
  const [newerId, setNewerId] = useState("");
  const olderIndex = Math.max(
    0,
    versions.findIndex((version) => version.id === olderId),
  );
  const newerIndex = newerId
    ? Math.max(
        0,
        versions.findIndex((version) => version.id === newerId),
      )
    : versions.length - 1;
  const beforeIndex = Math.min(olderIndex, newerIndex);
  const afterIndex = Math.max(olderIndex, newerIndex);
  const before = versions[beforeIndex];
  const after = versions[afterIndex];
  const fields = ["title", "body", "tags"] as const;
  const changed = fields.filter((key) => before[key] !== after[key]);

  if (versions.length < 2) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-400">
        One snapshot saved. Save another version to compare changes here.
      </p>
    );
  }

  return (
    <section
      aria-label="Version comparison"
      className="rounded-lg border border-emerald-900 bg-emerald-950/10 p-4"
    >
      <h3 className="font-medium">Compare versions</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Choose two snapshots to review the changes before restoring. Saved
        snapshots stay unchanged.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          First snapshot
          <select
            className={`${field} mt-2`}
            value={olderId}
            onChange={(event) => setOlderId(event.target.value)}
          >
            {versions.map((version, index) => (
              <option key={version.id} value={version.id}>
                v{index + 1} · {version.note || "Saved version"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Second snapshot
          <select
            className={`${field} mt-2`}
            value={newerId}
            onChange={(event) => setNewerId(event.target.value)}
          >
            <option value="">Latest (v{versions.length})</option>
            {versions.map((version, index) => (
              <option key={version.id} value={version.id}>
                v{index + 1} · {version.note || "Saved version"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" className="my-4 text-sm text-emerald-300">
        {beforeIndex === afterIndex
          ? "Choose different versions to see changes."
          : changed.length
            ? `${changed.length} changed field${changed.length === 1 ? "" : "s"}: ${changed.map((key) => (key === "body" ? "content" : key)).join(", ")}.`
            : "The title, content, and tags are identical. Only the version details differ."}
      </p>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {[
          { version: before, index: beforeIndex, label: "Before" },
          { version: after, index: afterIndex, label: "After" },
        ].map(({ version, index, label }) => (
          <article
            key={label}
            className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950 p-4"
          >
            <h4 className="text-sm font-medium">
              {label} ·{" "}
              <span className="font-mono text-emerald-400">v{index + 1}</span>
            </h4>
            <p className="mt-2 break-words text-xs leading-5 text-zinc-400">
              {version.author || "Demo author"} ·{" "}
              {new Date(version.createdAt).toLocaleString()}
            </p>
            <p className="mt-1 break-words text-xs text-zinc-500">
              {version.note || "Saved version"}
            </p>
            <dl className="mt-4 space-y-4">
              {fields.map((key) => (
                <div
                  key={key}
                  className={cn(
                    "rounded-md border p-3",
                    changed.includes(key)
                      ? "border-amber-900 bg-amber-950/20"
                      : "border-zinc-800",
                  )}
                >
                  <dt className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-medium capitalize text-zinc-400">
                    {key === "body" ? "Content" : key}
                    <span
                      className={
                        changed.includes(key)
                          ? "text-amber-300"
                          : "text-zinc-500"
                      }
                    >
                      {changed.includes(key) ? "Changed" : "Unchanged"}
                    </span>
                  </dt>
                  <dd
                    className={cn(
                      "whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200",
                      key === "body" &&
                        "max-h-80 overflow-y-auto font-mono text-xs",
                    )}
                  >
                    {version[key] || "None"}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
