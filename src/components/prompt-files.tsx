"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FileUploadField } from "@/components/file-upload-field";
import type { PromptFileInfo } from "@/lib/file-policy";
import { field, panel, primary } from "@/lib/ui";

export function PromptFiles({ promptId, files, selected, onSelect, onFiles, onUploadingChange, editable, busy, children }: {
  promptId: string; files: PromptFileInfo[]; selected: string;
  onSelect: (id: string) => void; onFiles: (files: PromptFileInfo[]) => void;
  onUploadingChange: (uploading: boolean) => void;
  editable: boolean; busy: boolean;
  children?: ReactNode;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: string; text: string; instruction: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    async function load() {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const response = await fetch(`/api/prompts/${promptId}/files/${selected}?preview=1`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the preview.");
        setPreview({ id: selected, text: data.text, instruction: data.instruction });
      } catch (error) {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : "Could not load preview.");
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [promptId, selected]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setUploading(true);
    onUploadingChange(true);
    setError("");
    try {
      const response = await fetch(`/api/prompts/${promptId}/files`, { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not upload files.");
      const updated = result.files as PromptFileInfo[];
      onFiles(updated);
      const added = updated.find(file => !files.some(old => old.id === file.id));
      if (added) onSelect(added.versions[0].id);
      form.reset();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not upload files.");
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  return <section className={`${panel} min-w-0 space-y-4 [overflow-wrap:anywhere]`}>
    <div>
      <h2 className="text-lg font-medium">Files &amp; versions</h2>
      <p className="text-sm text-zinc-400">Choose one file version for the next AI test. Originals and earlier revisions remain available.</p>
    </div>
    {editable ? <form onSubmit={upload} className="space-y-3">
      <FileUploadField disabled={uploading || busy} />
      <button className={primary} type="submit" disabled={uploading || busy}>{uploading ? "Reading and uploading…" : "Upload files"}</button>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
    </form> : null}
    <label className="block space-y-2 text-sm">
      <span>File version to preview / send to AI</span>
      <select className={`${field} min-w-0`} value={selected} onChange={event => onSelect(event.target.value)} disabled={busy || uploading}>
        <option value="">No file — test prompt text only</option>
        {files.map(file => <optgroup key={file.id} label={file.name}>
          {file.versions.map(version => <option key={version.id} value={version.id}>
            {file.name} · v{version.version}{version.version === 1 ? " (original)" : " (AI revision)"}
          </option>)}
        </optgroup>)}
      </select>
    </label>
    {selected ? <div aria-live="polite">
      {previewLoading ? <p className="text-sm text-zinc-400">Loading file preview…</p> : null}
      {previewError ? <p role="alert" className="text-sm text-red-400">{previewError}</p> : null}
      {preview?.id === selected ? <details>
        <summary className="cursor-pointer text-sm text-emerald-400">Preview file content</summary>
        {preview.instruction ? <p className="my-2 text-xs text-zinc-400">Revision instruction: {preview.instruction}</p> : null}
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-3 text-xs">{preview.text}</pre>
      </details> : null}
    </div> : null}
    {children}
    {files.length === 0 ? <p className="text-sm text-zinc-500">No files attached yet.</p> : files.map(file => <details key={file.id} open className="rounded-lg border border-zinc-800 p-3">
      <summary className="cursor-pointer text-sm font-medium">{file.name} · {file.versions.length} version{file.versions.length === 1 ? "" : "s"}</summary>
      <ol className="mt-3 space-y-3">
        {file.versions.map(version => {
          const source = file.versions.find(item => item.id === version.sourceVersionId);
          return <li key={version.id} className="border-l border-zinc-700 pl-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-emerald-400">v{version.version}{version.version === 1 ? " · Original" : source ? ` · From v${source.version}` : " · AI revision"}</span>
              <a className="underline underline-offset-4" href={`/api/prompts/${promptId}/files/${version.id}`}>Download v{version.version}</a>
            </div>
            <p className="mt-1 text-xs text-zinc-400">{version.summary}</p>
            <p className="mt-1 text-xs text-zinc-500">{version.createdAt.slice(0, 16).replace("T", " ")} UTC · {(version.size / 1024).toFixed(1)} KB{version.model ? ` · ${version.model}` : ""}</p>
          </li>;
        })}
      </ol>
    </details>)}
  </section>;
}
