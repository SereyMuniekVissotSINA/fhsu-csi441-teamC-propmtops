"use client";

import { useCallback, useState } from "react";

import { diffHunks } from "@/lib/code-diff";
import type { FileChange } from "@/lib/code-commits";
import { action, field, panel, primary } from "@/lib/ui";

// The generated-code history for one prompt: a commit log, where each commit is
// one run of the prompt against the configured model.
//
// Commits are read from the database on the server and handed down as
// `initialCommits`; generating appends to that list in place, so the log reads
// like `git log` without a round trip through the page.

export type CommitFile = {
  path: string;
  hash: string;
  language: string;
  change: FileChange;
  added: number;
  removed: number;
};

export type CommitSummary = {
  id: string;
  sequence: number;
  message: string;
  parentId: string | null;
  promptVersionId: string | null;
  model: string;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  incomplete: boolean;
  createdAt: string;
  authorName: string | null;
  stats: { files: number; added: number; removed: number; changed: number };
  files: CommitFile[];
};

type CommitFileContents = CommitFile & { id: string; content: string };

// `files` is widened, not intersected: a detail response carries the same files
// as the summary plus their contents.
type CommitDetail = Omit<CommitSummary, "files"> & {
  input: string;
  output: string;
  files: CommitFileContents[];
};

const changeLabel: Record<FileChange, { letter: string; className: string; title: string }> = {
  ADDED: { letter: "A", className: "text-emerald-400", title: "Added" },
  MODIFIED: { letter: "M", className: "text-amber-400", title: "Modified" },
  REMOVED: { letter: "D", className: "text-red-400", title: "Removed" },
  UNCHANGED: { letter: "·", className: "text-zinc-600", title: "Unchanged" },
};

export function CodeCommitLog({
  promptId,
  promptVersionId,
  initialCommits,
  input,
  blocked,
  editable,
}: {
  promptId: string;
  promptVersionId: string;
  initialCommits: CommitSummary[];
  /** The composed prompt from the editor — exactly what gets sent. */
  input: string;
  /** Why generating is unavailable right now, if it is. */
  blocked?: string;
  editable: boolean;
}) {
  const [commits, setCommits] = useState(initialCommits);
  const [details, setDetails] = useState<Record<string, CommitDetail>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<Record<string, string>>({});
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const loadDetail = useCallback(
    async (commitId: string) => {
      if (details[commitId]) return details[commitId];
      setLoadingId(commitId);
      try {
        const response = await fetch(`/api/prompts/${promptId}/commits/${commitId}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load this commit.");
        setDetails((previous) => ({ ...previous, [commitId]: data }));
        return data as CommitDetail;
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load this commit.");
        return null;
      } finally {
        setLoadingId(null);
      }
    },
    [details, promptId],
  );

  async function toggleCommit(commit: CommitSummary) {
    setError("");
    if (openId === commit.id) {
      setOpenId(null);
      return;
    }
    setOpenId(commit.id);
    const detail = await loadDetail(commit.id);
    const firstChanged =
      detail?.files.find((file) => file.change !== "UNCHANGED" && file.change !== "REMOVED") ??
      detail?.files[0];
    if (firstChanged) {
      setActivePath((previous) => ({ ...previous, [commit.id]: firstChanged.path }));
    }
  }

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const response = await fetch(`/api/prompts/${promptId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, message, promptVersionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not generate code.");

      const { files, ...summary } = data as CommitDetail;
      setCommits((previous) => [{ ...summary, files }, ...previous]);
      setDetails((previous) => ({ ...previous, [data.id]: data }));
      setOpenId(data.id);
      const first = files.find((file) => file.change !== "UNCHANGED") ?? files[0];
      if (first) setActivePath((previous) => ({ ...previous, [data.id]: first.path }));
      setMessage("");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Could not generate code.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className={`${panel} space-y-4 lg:col-start-1`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">Generated code</h2>
        <p className="text-xs text-zinc-500">
          {commits.length === 0
            ? "No commits yet"
            : `${commits.length} commit${commits.length === 1 ? "" : "s"}`}
        </p>
      </header>

      <p className="text-sm text-zinc-400">
        Every run commits what the model wrote: files, a diff against the run
        before it, and the prompt version that produced it. Nothing is written to
        your working tree.
      </p>

      {process.env.NODE_ENV === "development" && editable ? (
        <div className="space-y-2">
          <input
            className={field}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Commit message (optional — one is written from the diff)"
            maxLength={240}
            aria-label="Commit message"
          />
          <button
            type="button"
            className={primary}
            onClick={generate}
            disabled={generating || Boolean(blocked)}
          >
            {generating ? "Generating…" : "Generate code"}
          </button>
          {blocked ? <p className="text-sm text-zinc-400">{blocked}</p> : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}

      <ol className="space-y-3" aria-live="polite">
        {commits.map((commit) => {
          const detail = details[commit.id];
          const open = openId === commit.id;
          const selected = activePath[commit.id];
          const file = detail?.files.find((candidate) => candidate.path === selected);
          const diffKey = `${commit.id}:${selected}`;
          const parent = commit.parentId ? details[commit.parentId] : undefined;

          return (
            <li key={commit.id} className="rounded-lg border border-zinc-800 bg-black/30">
              <button
                type="button"
                onClick={() => toggleCommit(commit)}
                aria-expanded={open}
                className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition hover:bg-zinc-900/60"
              >
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-emerald-400">c{commit.sequence}</span>
                  <span className="text-sm text-zinc-200">{commit.message}</span>
                  {commit.incomplete ? (
                    <span className="text-xs text-amber-400">truncated</span>
                  ) : null}
                </span>
                <span className="font-mono text-xs text-zinc-500">
                  {commit.stats.files} file{commit.stats.files === 1 ? "" : "s"}
                  {commit.stats.changed < commit.stats.files
                    ? ` · ${commit.stats.changed} changed`
                    : ""}
                  {commit.stats.added ? (
                    <span className="text-emerald-500"> +{commit.stats.added}</span>
                  ) : null}
                  {commit.stats.removed ? (
                    <span className="text-red-400"> −{commit.stats.removed}</span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-600">
                  {commit.authorName ?? "Unknown"} · {commit.createdAt.slice(0, 16).replace("T", " ")}{" "}
                  · {commit.model} · {(commit.elapsedMs / 1000).toFixed(1)}s
                  {commit.outputTokens
                    ? ` · ${commit.inputTokens ?? 0} in / ${commit.outputTokens} out`
                    : ""}
                </span>
              </button>

              {open ? (
                <div className="space-y-3 border-t border-zinc-800 px-4 py-3">
                  {loadingId === commit.id && !detail ? (
                    <p className="text-sm text-zinc-400">Loading commit…</p>
                  ) : null}

                  {detail && detail.files.length === 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm text-zinc-400">
                        This run returned no files. The raw response is kept so you can see why.
                      </p>
                      <pre className="max-h-64 overflow-auto rounded border border-zinc-800 bg-black/60 p-3 font-mono text-xs whitespace-pre-wrap text-zinc-400">
                        {detail.output || "Empty response."}
                      </pre>
                    </div>
                  ) : null}

                  {detail && detail.files.length > 0 ? (
                    <>
                      <ul className="flex flex-wrap gap-2">
                        {detail.files.map((entry) => {
                          const badge = changeLabel[entry.change];
                          return (
                            <li key={entry.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePath((previous) => ({
                                    ...previous,
                                    [commit.id]: entry.path,
                                  }))
                                }
                                className={`rounded border px-2 py-1 font-mono text-xs transition ${
                                  entry.path === selected
                                    ? "border-emerald-500 text-white"
                                    : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                                }`}
                              >
                                <span className={badge.className} title={badge.title}>
                                  {badge.letter}
                                </span>{" "}
                                {entry.path}
                                {entry.added || entry.removed ? (
                                  <span className="text-zinc-600">
                                    {" "}
                                    +{entry.added} −{entry.removed}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>

                      {file ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-zinc-500">
                              {changeLabel[file.change].title} · {file.hash}
                              {file.language ? ` · ${file.language}` : ""}
                            </span>
                            {file.change === "MODIFIED" && commit.parentId ? (
                              <button
                                type="button"
                                className={`${action} px-2 py-1 text-xs`}
                                onClick={async () => {
                                  if (!parent && commit.parentId) await loadDetail(commit.parentId);
                                  setDiffOpen((previous) => ({
                                    ...previous,
                                    [diffKey]: !previous[diffKey],
                                  }));
                                }}
                              >
                                {diffOpen[diffKey] ? "Show file" : "Show diff"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={`${action} px-2 py-1 text-xs`}
                              onClick={() => navigator.clipboard?.writeText(file.content)}
                            >
                              Copy
                            </button>
                          </div>

                          {diffOpen[diffKey] && parent ? (
                            <FileDiff
                              before={
                                parent.files.find((entry) => entry.path === file.path)?.content ?? ""
                              }
                              after={file.content}
                            />
                          ) : (
                            <pre className="max-h-96 overflow-auto rounded border border-zinc-800 bg-black/60 p-3 font-mono text-xs whitespace-pre text-zinc-300">
                              {file.change === "REMOVED"
                                ? "This file is gone as of this commit."
                                : file.content}
                            </pre>
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Changed lines plus three lines of context, the way `git diff` shows them. */
function FileDiff({ before, after }: { before: string; after: string }) {
  const hunks = diffHunks(before, after);

  return (
    <div className="max-h-96 overflow-auto rounded border border-zinc-800 bg-black/60 font-mono text-xs">
      {hunks.length === 0 ? (
        <p className="p-3 text-zinc-500">No line changes.</p>
      ) : (
        hunks.map((hunk, index) => (
          <div key={index}>
            {hunk.skippedBefore > 0 ? (
              <p className="bg-zinc-900/80 px-3 py-1 text-zinc-600">
                … {hunk.skippedBefore} unchanged line{hunk.skippedBefore === 1 ? "" : "s"}
              </p>
            ) : null}
            {hunk.lines.map((line, lineIndex) => (
              <p
                key={lineIndex}
                className={`px-3 whitespace-pre ${
                  line.kind === "+"
                    ? "bg-emerald-500/10 text-emerald-300"
                    : line.kind === "-"
                      ? "bg-red-500/10 text-red-300"
                      : "text-zinc-500"
                }`}
              >
                {line.kind}
                {line.text}
              </p>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
