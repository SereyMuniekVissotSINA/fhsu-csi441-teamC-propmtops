"use client";

import Link from "next/link";
import { useState } from "react";
import { Search, Copy, FileText } from "lucide-react";

import { variableNames, type PromptRecord } from "@/lib/prompts-core";
import { action, field } from "@/lib/ui";

import { PromptGraph } from "./prompt-graph";

/**
 * The workspace library: search prompts, read any saved version, explore the
 * graph.
 *
 * `prompts` is rendered as given. The page is a server component that already
 * scoped the query by membership, so there is no loading or error state to
 * carry here — if the caller could not read the workspace, this never renders.
 */
export function PromptLibrary({
  workspace,
  prompts,
}: {
  workspace: { id: string; name: string };
  prompts: PromptRecord[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [versionId, setVersionId] = useState("");
  const [notice, setNotice] = useState("");
  const [graphView, setGraphView] = useState(false);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = prompts.filter((prompt) => {
    const latest = prompt.versions.at(-1)!;
    const text = `${prompt.id} ${latest.title} ${latest.body} ${latest.tags}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const prompt = results.find((item) => item.id === selected) ?? results[0];
  const version = prompt?.versions.find((item) => item.id === versionId) ?? prompt?.versions.at(-1);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice("Clipboard unavailable. Select the content below and copy it manually.");
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs tracking-widest text-emerald-400">
            PROMPT LIBRARY / {workspace.name}
          </p>
          <h1 className="text-3xl font-semibold">Find the right prompt.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
            Search your workspace’s database, retrieve prompts, and explore saved versions and
            connections.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={action} href="/dashboard">
            Back to dashboard
          </Link>
          <button className={action} onClick={() => window.location.reload()}>
            Refresh library
          </button>
        </div>
      </div>

      <label className="mb-2 block text-sm" htmlFor="prompt-search">
        Search prompts
      </label>
      <div className="relative">
        <Search className="absolute left-3 top-3 text-zinc-500" size={18} aria-hidden="true" />
        <input
          id="prompt-search"
          type="search"
          className={`${field} pl-10`}
          placeholder="Search title, content, tags, or prompt ID…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVersionId("");
            setNotice("");
          }}
        />
      </div>
      <p role="status" className="my-4 text-sm text-zinc-400">
        {results.length} of {prompts.length} prompts · Search matches the latest saved version
      </p>

      <div className="mb-4 flex gap-2" aria-label="Library view">
        <button className={action} aria-pressed={!graphView} onClick={() => setGraphView(false)}>
          List view
        </button>
        <button className={action} aria-pressed={graphView} onClick={() => setGraphView(true)}>
          Graph view
        </button>
      </div>

      {graphView && (
        <PromptGraph
          prompts={results}
          onSelect={(id, version) => {
            setSelected(id);
            setVersionId(version ?? "");
            setNotice("");
          }}
        />
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside aria-label="Search results" className="space-y-2">
          {results.map((item) => {
            const latest = item.versions.at(-1)!;
            return (
              <button
                key={item.id}
                aria-pressed={item.id === prompt?.id}
                onClick={() => {
                  setSelected(item.id);
                  setVersionId("");
                  setNotice("");
                }}
                className={`w-full rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-emerald-400 ${
                  item.id === prompt?.id
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-zinc-800 hover:bg-zinc-900"
                }`}
              >
                <span className="block font-medium">{latest.title}</span>
                <span className="mt-2 block text-xs text-zinc-400">{latest.tags || "No tags"}</span>
                <span className="mt-3 block text-xs text-emerald-400">
                  {item.versions.length} saved {item.versions.length === 1 ? "version" : "versions"}
                </span>
              </button>
            );
          })}
          {!results.length && (
            <div className="rounded-xl border border-dashed border-zinc-700 p-6">
              <FileText className="mb-3 text-zinc-500" aria-hidden="true" />
              <p>{prompts.length ? "No prompts match your search." : "This workspace has no prompts yet."}</p>
              {query && (
                <button className={`${action} mt-3`} onClick={() => setQuery("")}>
                  Clear search
                </button>
              )}
            </div>
          )}
        </aside>

        {prompt && version && (
          <article className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{version.title}</h2>
                <p className="mt-2 break-all font-mono text-xs text-zinc-500">
                  Prompt ID: {prompt.id}
                </p>
              </div>
              <div className="flex gap-2">
                <Link className={action} href={`/dashboard/prompts/${prompt.id}`}>
                  Open editor
                </Link>
                <button className={action} onClick={() => copy(version.body)}>
                  <Copy size={14} />
                  Copy prompt
                </button>
              </div>
            </div>

            <label className="mb-2 mt-6 block text-sm" htmlFor="prompt-version">
              Saved version
            </label>
            <select
              id="prompt-version"
              className={field}
              value={version.id}
              onChange={(event) => {
                setVersionId(event.target.value);
                setNotice("");
              }}
            >
              {prompt.versions
                .map((item, index) => (
                  <option key={item.id} value={item.id}>
                    v{index + 1}
                    {index === prompt.versions.length - 1 ? " · Latest" : ""} —{" "}
                    {item.note || "Saved version"}
                  </option>
                ))
                .reverse()}
            </select>
            <p className="mt-3 text-xs text-zinc-400">
              {version.author || "Unknown author"} · {new Date(version.createdAt).toLocaleString()}
            </p>
            <p className="mt-2 break-all font-mono text-xs text-zinc-500">
              Version ID: {version.id}
            </p>
            <p className="mt-3 text-sm text-zinc-300">{version.note}</p>
            <pre className="my-5 whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-5 font-mono text-sm leading-7">
              {version.body}
            </pre>
            <p className="text-sm text-zinc-400">Tags: {version.tags || "None"}</p>
            <p className="mt-2 break-words text-sm text-zinc-400">
              Variables: {variableNames(version.body).join(", ") || "None"}
            </p>
            <button
              className={`${action} mt-5`}
              onClick={() => copy(JSON.stringify({ promptId: prompt.id, ...version }, null, 2))}
            >
              Copy version as JSON
            </button>
            {notice && (
              <p role="status" className="mt-3 text-sm text-emerald-300">
                {notice}
              </p>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
