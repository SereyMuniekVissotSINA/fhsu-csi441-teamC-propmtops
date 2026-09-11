"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock3, Code2, FileText, Plus, Search } from "lucide-react";
import {
  appendVersion,
  demoStoreSchema,
  type DemoPrompt,
} from "@/lib/demo-prompts";
import {
  demoWorkspaceStorageKey,
  readDemo,
  writeDemo,
} from "@/lib/demo-storage";
import { cn } from "@/lib/utils";
import { PromptEditor } from "./prompt-editor";
import { useDemoAccount } from "./account-provider";

const action =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";
const primary = cn(
  action,
  "border-emerald-500 bg-emerald-500 text-black hover:bg-emerald-400",
);
const field =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400";

function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function DemoWorkspace({
  initialView = "editor",
}: {
  initialView?: "editor" | "history";
}) {
  const { user, workspace, canEdit, assertCanEdit } = useDemoAccount();
  const [prompts, setPrompts] = useState<DemoPrompt[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editorKey, setEditorKey] = useState(0);
  const snapshot = useRef<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let active = true;
    async function load() {
      try {
        const saved = readDemo(window.localStorage, workspace.id);
        let initial = saved.prompts;
        let initialSnapshot = saved.snapshot;
        if (initial === null) {
          if (workspace.id !== "personal") {
            initial = [];
          } else {
            const response = await fetch("/api/demo/prompts", {
              signal: controller.signal,
              cache: "no-store",
            });
            if (!response.ok)
              throw new Error(
                "The sample prompts couldn’t load. Retry, or start an empty session without saving.",
              );
            initial = demoStoreSchema.parse(await response.json()).prompts;
          }
          if (!active) return;
          initialSnapshot = writeDemo(
            window.localStorage,
            initial,
            saved.snapshot,
            workspace.id,
          );
        }
        if (!active) return;
        snapshot.current = initialSnapshot;
        setPrompts(initial);
        setSelected(initial[0]?.id ?? null);
        setLoading(false);
      } catch (reason) {
        if (!active) return;
        setError(
          controller.signal.aborted
            ? "Loading took too long. Check your connection and retry, or start an empty session without saving."
            : messageOf(reason),
        );
        setLoading(false);
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [attempt, workspace.id]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const guard = (event: Event) => {
      if (
        dirty.current &&
        !window.confirm("Discard your unsaved prompt edits?")
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("promptops:before-context-change", guard);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("promptops:before-context-change", guard);
    };
  }, []);

  function mayLeave() {
    return !dirty.current || window.confirm("Discard your unsaved edits?");
  }

  function open(id: string | null, isNew = false) {
    if (isNew && !canEdit) return;
    if (!mayLeave()) return;
    dirty.current = false;
    setSelected(id);
    setCreating(isNew);
    setEditorKey((value) => value + 1);
    setNotice("");
  }

  function commit(next: DemoPrompt[], success: string) {
    assertCanEdit();
    if (!memoryOnly)
      snapshot.current = writeDemo(
        window.localStorage,
        next,
        snapshot.current,
        workspace.id,
      );
    setPrompts(next);
    setNotice(
      memoryOnly
        ? `${success} Kept for this session only.`
        : `${success} Saved in this browser.`,
    );
    dirty.current = false;
  }

  function retry() {
    setLoading(true);
    setError("");
    setAttempt((value) => value + 1);
  }

  function reset() {
    if (
      !window.confirm(
        "Delete all locally saved demo prompts and their history, and load the samples again?",
      )
    )
      return;
    try {
      assertCanEdit();
      window.localStorage.removeItem(demoWorkspaceStorageKey(workspace.id));
      retry();
    } catch {
      setError(
        "Local storage is unavailable. Enable browser storage or continue without saving.",
      );
    }
  }

  const current = prompts.find((prompt) => prompt.id === selected);
  const visible = prompts.filter((prompt) => {
    const latest = prompt.versions.at(-1)!;
    return `${latest.title} ${latest.tags} ${latest.body}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });

  return (
    <main className="min-h-screen bg-[#080808] text-zinc-100 selection:bg-emerald-500/30">
      <header className="border-b border-zinc-800">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-5"
        >
          <Link
            href="/"
            onClick={(event) => {
              if (!mayLeave()) event.preventDefault();
            }}
            className="flex items-center gap-3 font-semibold"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500 font-mono text-black">
              &gt;_
            </span>{" "}
            PromptOps
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <span className="rounded-full border border-emerald-900 bg-emerald-950/40 px-3 py-1 text-xs text-emerald-400">
              {workspace.name} · {workspace.role.toLowerCase()}
            </span>
            <Link
              href="/"
              onClick={(event) => {
                if (!mayLeave()) event.preventDefault();
              }}
              className="flex items-center gap-2 text-zinc-400 hover:text-white"
            >
              <ArrowLeft size={14} /> Home
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-[1440px] px-6 py-8 md:px-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 font-mono text-xs tracking-widest text-emerald-400">
              YOUR PROMPT WORKBENCH
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {workspace.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              Write, refine, and revisit every version. This demo saves to this
              browser. Prompt libraries and histories are separate for each
              workspace.
            </p>
          </div>
          <button
            className={primary}
            disabled={loading || !!error || !canEdit}
            onClick={() => open(null, true)}
          >
            <Plus size={16} /> New prompt
          </button>
        </div>

        {loading ? (
          <div
            role="status"
            className="animate-pulse rounded-xl border border-zinc-800 p-12 text-center text-zinc-400"
          >
            Loading your prompts…
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-900 bg-amber-950/20 p-8"
          >
            <h2 className="mb-2 text-lg font-medium">
              We couldn’t open your saved workspace
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-zinc-300">{error}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className={primary} onClick={retry}>
                Retry loading
              </button>
              <button
                className={action}
                onClick={() => {
                  setMemoryOnly(true);
                  setError("");
                  setCreating(canEdit);
                }}
              >
                Continue without saving
              </button>
              <button className={action} onClick={reset} disabled={!canEdit}>
                Reset saved demo
              </button>
            </div>
          </div>
        ) : (
          <>
            {!canEdit && (
              <p className="mb-5 rounded-lg border border-zinc-700 p-4 text-sm text-zinc-300">
                Viewer access: explore prompts, compare versions, and preview
                variables. Ask a workspace owner for editing access.
              </p>
            )}
            {memoryOnly && (
              <p
                role="status"
                className="mb-5 rounded-lg border border-amber-900 bg-amber-950/20 p-4 text-sm text-amber-200"
              >
                Temporary session: changes will be lost when you reload or leave
                this page.
              </p>
            )}
            <div className="mb-7 grid grid-cols-3 gap-3">
              {[
                {
                  label: "Stored prompts",
                  value: prompts.length,
                  icon: FileText,
                },
                {
                  label: "Saved versions",
                  value: prompts.reduce(
                    (total, p) => total + p.versions.length,
                    0,
                  ),
                  icon: Clock3,
                },
                {
                  label: "Storage",
                  value: memoryOnly ? "Session" : "Local",
                  icon: Code2,
                },
              ].map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 md:p-5"
                >
                  <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
                    <Icon size={14} />
                    <span>{label}</span>
                  </div>
                  <p className="text-xl font-semibold md:text-2xl">{value}</p>
                </div>
              ))}
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mb-3 min-h-5 text-sm text-emerald-400"
            >
              {notice}
            </p>
            <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
                aria-label="Prompt library"
              >
                <div className="border-b border-zinc-800 p-4">
                  <h2 className="mb-4 text-sm font-semibold">
                    Prompt library{" "}
                    <span className="ml-2 text-zinc-500">{prompts.length}</span>
                  </h2>
                  <label className="relative block">
                    <Search
                      className="absolute left-3 top-3 text-zinc-500"
                      size={16}
                    />
                    <span className="sr-only">Search prompts</span>
                    <input
                      className={`${field} pl-9`}
                      placeholder="Search prompts…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </div>
                <div className="max-h-[560px] overflow-y-auto p-2">
                  {visible.map((prompt) => {
                    const latest = prompt.versions.at(-1)!;
                    return (
                      <button
                        key={prompt.id}
                        aria-current={
                          selected === prompt.id ? "true" : undefined
                        }
                        onClick={() => open(prompt.id)}
                        className={`mb-1 w-full rounded-lg border p-4 text-left transition ${selected === prompt.id ? "border-emerald-800 bg-emerald-950/30" : "border-transparent hover:bg-zinc-900"}`}
                      >
                        <p className="break-words text-sm font-medium">
                          {latest.title}
                        </p>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                          {latest.body}
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-zinc-400">
                            {latest.tags || "Untagged"}
                          </span>
                          <span className="shrink-0 font-mono text-emerald-400">
                            v{prompt.versions.length}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {!visible.length && (
                    <div className="p-6 text-center text-sm text-zinc-400">
                      <p>
                        {query
                          ? "No matching prompts."
                          : "Your library is empty."}
                      </p>
                      {query ? (
                        <button
                          className="mt-3 text-emerald-400"
                          onClick={() => setQuery("")}
                        >
                          Clear search
                        </button>
                      ) : (
                        <button
                          className="mt-3 text-emerald-400 disabled:opacity-40"
                          disabled={!canEdit}
                          onClick={() => open(null, true)}
                        >
                          Create your first prompt
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </aside>
              {current || creating ? (
                <PromptEditor
                  key={`${current?.id ?? "new"}-${editorKey}`}
                  prompt={current}
                  memoryOnly={memoryOnly}
                  canEdit={canEdit}
                  initialView={creating ? "editor" : initialView}
                  onDirty={(value) => {
                    dirty.current = value;
                  }}
                  onSave={(content, note) => {
                    const base = current ?? {
                      id: crypto.randomUUID(),
                      versions: [],
                    };
                    const updated = appendVersion(
                      base,
                      content,
                      note || (current ? "Updated prompt" : "Initial version"),
                      user.name,
                    );
                    commit(
                      current
                        ? prompts.map((p) =>
                            p.id === current.id ? updated : p,
                          )
                        : [updated, ...prompts],
                      current ? "New version created." : "Prompt created.",
                    );
                    setSelected(updated.id);
                    setCreating(false);
                    return updated;
                  }}
                  onDelete={() => {
                    if (
                      !current ||
                      !window.confirm(
                        `Delete “${current.versions.at(-1)!.title}” and all its versions? This cannot be undone.`,
                      )
                    )
                      return;
                    const remaining = prompts.filter(
                      (p) => p.id !== current.id,
                    );
                    commit(remaining, "Prompt deleted.");
                    setSelected(remaining[0]?.id ?? null);
                    setCreating(false);
                  }}
                />
              ) : (
                <section className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-6 text-center">
                  <FileText className="mb-4 text-emerald-400" size={30} />
                  <h2 className="text-xl font-medium">
                    Make room for your next idea.
                  </h2>
                  <p className="mb-6 mt-2 text-sm text-zinc-400">
                    {canEdit
                      ? "Create a prompt and start building its history."
                      : "This workspace has no prompts yet. An owner or editor can create one."}
                  </p>
                  <button
                    className={primary}
                    disabled={!canEdit}
                    onClick={() => open(null, true)}
                  >
                    <Plus size={16} /> Create a prompt
                  </button>
                </section>
              )}
            </div>
            <p className="mt-8 text-center text-xs leading-5 text-zinc-500">
              Demo mode · Prompts stay on this device · Preview composes text
              without calling an AI model
            </p>
          </>
        )}
      </div>
    </main>
  );
}
