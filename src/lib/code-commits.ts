import { createHash } from "node:crypto";

import { lineStats, splitLines } from "@/lib/code-diff";
import { languageForPath, normalizePath } from "@/lib/paths";

// Turning a model response into a commit.
//
// Prompt_Ops already versions prompt text (PromptVersion). This module does the
// same for the *code the prompt produces*: a generation run is parsed into
// files, compared against the previous run, and stored as an append-only
// commit attached to the prompt — a git log whose author happens to be the
// local model.
//
// Everything here is pure and has no browser or database dependency, so the API
// route, the UI, and the tests all share one implementation.

/** Status letters mirror `git status`: added, modified, unchanged, removed. */
export type FileChange = "ADDED" | "MODIFIED" | "UNCHANGED" | "REMOVED";

export type GeneratedFile = {
  path: string;
  content: string;
  language: string;
};

export type CommittedFile = GeneratedFile & {
  change: FileChange;
  hash: string;
  added: number;
  removed: number;
};

// Caps. The provider is already limited to 4,096 output tokens, so these only
// exist to keep a pathological response from writing a huge row.
export const MAX_FILES_PER_COMMIT = 40;
export const MAX_FILE_CHARS = 100_000;

// Appended to the composed prompt before it is sent. Without a convention for
// file paths there is nothing to attach a commit to, and the parser below is
// what reads this convention back.
export const CODE_OUTPUT_CONTRACT = `

---
Return the complete contents of every file you create or change. Put each file
in its own fenced code block, and start the fence with the file's path relative
to the project root, like this:

\`\`\`ts src/lib/example.ts
export const example = 1;
\`\`\`

Repeat unchanged files only if their contents change. Prose outside the code
blocks is ignored.`;

/** sha256 of the file contents, shortened the way git shows a short SHA. */
export function fileHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}

// The path rule and the syntax labels live in `@/lib/paths`, which imports
// nothing: the agent-run classifier needs the same two and cannot import this
// module, because this one reaches for node:crypto and that one is bundled for
// the browser. They are re-exported here so the callers that have always had
// them from this module keep working.
export { normalizePath, languageForPath } from "@/lib/paths";

const extensionByLanguage: Record<string, string> = {
  typescript: "ts", ts: "ts", tsx: "tsx", javascript: "js", js: "js",
  jsx: "jsx", json: "json", prisma: "prisma", sql: "sql", css: "css",
  html: "html", markdown: "md", md: "md", python: "py", ruby: "rb",
  go: "go", rust: "rs", java: "java", bash: "sh", sh: "sh", shell: "sh",
  yaml: "yml", yml: "yml", toml: "toml", text: "txt",
};

function languageOf(path: string, fenceLanguage: string): string {
  return fenceLanguage ? fenceLanguage.toLowerCase() : languageForPath(path);
}

/** A token is path-shaped if it has a directory separator or a file extension. */
function looksLikePath(token: string): boolean {
  if (!token || /\s/.test(token) || token.length > 200) return false;
  if (/^(https?|file|data):/i.test(token)) return false;
  return token.includes("/") || /\.[A-Za-z0-9]{1,12}$/.test(token);
}

/**
 * Read a path out of the fence info string — the text after ``` — which models
 * write in several shapes: `ts src/a.ts`, `ts:src/a.ts`, `ts path=src/a.ts`,
 * `ts title="src/a.ts"`, or just `src/a.ts`.
 */
function pathFromFenceInfo(info: string): { path: string | null; language: string } {
  const trimmed = info.trim();
  if (!trimmed) return { path: null, language: "" };

  const attribute = /(?:path|file|filename|title|name)\s*=\s*("[^"]+"|'[^']+'|\S+)/i.exec(trimmed);
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);

  // A leading bare word with no slash or dot is the language, not a path.
  const first = tokens[0] ?? "";
  const colonSplit = first.includes(":") ? first.split(":") : null;
  const language = colonSplit
    ? colonSplit[0]
    : looksLikePath(first)
      ? ""
      : first.replace(/^\{\.?|\}$/g, "");

  if (attribute) {
    return { path: attribute[1].replace(/^["']|["']$/g, ""), language };
  }
  if (colonSplit && looksLikePath(colonSplit.slice(1).join(":"))) {
    return { path: colonSplit.slice(1).join(":"), language };
  }

  const candidate = tokens.find(looksLikePath);
  return { path: candidate ?? null, language };
}

/**
 * Fall back to the prose right above the fence: a bold path, a heading, a
 * "File: x" line, or an inline-code path are all common.
 */
function pathFromHeading(lines: string[]): string | null {
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    const match =
      /^(?:#{1,6}\s*)?(?:\*{1,2}|`)?\s*(?:file|filename|path)\s*[:=]\s*(?:\*{1,2}|`)?([^`*\s]+)/i.exec(text) ??
      /^#{1,6}\s+`?([^`\s]+)`?\s*$/.exec(text) ??
      /^\*{2}([^*\s]+)\*{2}:?\s*$/.exec(text) ??
      /^`([^`\s]+)`:?\s*$/.exec(text) ??
      /^([^\s`*]+):\s*$/.exec(text);
    if (match && looksLikePath(match[1])) return match[1];
  }
  return null;
}

/**
 * A path on the first line *inside* the block, which is where models put it
 * when they leave it off the fence. Two shapes show up:
 *
 *   ```ts            ```ts
 *   // src/a.ts      src/a.ts
 *   export …         export …
 *
 * The comment form is idiomatic and stays in the file. The bare form is not
 * valid code in any language, so `stripPathLine` removes it below.
 */
function pathFromBody(body: string): string | null {
  const first = body.split("\n").find((line) => line.trim())?.trim();
  if (!first) return null;

  const comment = /^(?:\/\/+|#+|--|\/\*+|<!--)\s*([^\s*]+?)\s*(?:\*\/|-->)?$/.exec(first);
  if (comment && looksLikePath(comment[1])) return comment[1];

  return isBarePath(first) ? first : null;
}

/**
 * A line that is nothing but a file path. Deliberately strict: punctuation that
 * appears in real code disqualifies it, and the name must start with a word
 * character and end in an extension, so a CSS selector or a lone statement is
 * never mistaken for a filename.
 */
function isBarePath(line: string): boolean {
  if (!looksLikePath(line) || /[=;(){}<>"'`,:!?]/.test(line)) return false;
  return /^[A-Za-z0-9_][\w.\-/@]*\.[A-Za-z0-9]{1,12}$/.test(line) || /^\.\/[\w.\-/@]+$/.test(line);
}

/**
 * Drop a first line that merely repeats the path we just resolved. It names the
 * file; it is not part of it. Harmless when the model also wrote the path on
 * the fence and then restated it.
 */
function stripPathLine(body: string, path: string): string {
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.trim());
  if (index === -1) return body;
  return lines[index].trim() === path.trim() ? lines.slice(index + 1).join("\n") : body;
}

/**
 * Pull files out of a model response.
 *
 * Named blocks win. Unnamed blocks are kept only when the response named none
 * of its blocks — otherwise they are almost always illustrative shell snippets
 * sitting next to the real files, and committing them as code would be wrong.
 */
export function parseGeneratedFiles(output: string): GeneratedFile[] {
  const lines = output.split(/\r?\n/);
  const blocks: { path: string | null; language: string; content: string }[] = [];
  const prose: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (!open) {
      prose.push(lines[index]);
      continue;
    }

    const [, fence, info] = open;
    const close = new RegExp(`^\\s*${fence[0] === "\`" ? "`" : "~"}{${fence.length},}\\s*$`);
    const body: string[] = [];
    let closed = false;
    for (index++; index < lines.length; index++) {
      if (close.test(lines[index])) {
        closed = true;
        break;
      }
      body.push(lines[index]);
    }
    // An unterminated fence still carries its content; the model ran out of
    // output tokens, and dropping the partial file would hide that.
    if (!closed) index = lines.length;

    const content = body.join("\n");
    const fromInfo = pathFromFenceInfo(info);
    const raw =
      fromInfo.path ??
      pathFromHeading(prose.slice(-4).reverse()) ??
      pathFromBody(content);

    blocks.push({
      path: raw ? normalizePath(raw) : null,
      language: fromInfo.language.toLowerCase(),
      content: raw ? stripPathLine(content, raw) : content,
    });
    prose.length = 0;
  }

  const named = blocks.filter((block) => block.path);
  const chosen = named.length > 0 ? named : blocks;

  const files = new Map<string, GeneratedFile>();
  chosen.forEach((block, position) => {
    const content = block.content.slice(0, MAX_FILE_CHARS);
    if (!content.trim()) return;
    const path =
      block.path ??
      `generated-${position + 1}.${extensionByLanguage[block.language] ?? "txt"}`;
    // Last block wins on a repeated path, but keeps its original position —
    // models often restate a file after explaining a correction.
    files.set(path, { path, content, language: languageOf(path, block.language) });
  });

  return [...files.values()].slice(0, MAX_FILES_PER_COMMIT);
}

export { diffHunks, diffLines, lineStats } from "@/lib/code-diff";
export type { DiffLine } from "@/lib/code-diff";

// ---------------------------------------------------------------------------
// Comparing one generation against the previous one
// ---------------------------------------------------------------------------

/**
 * Compare a fresh generation against the previous commit's files.
 *
 * Every file the model returned gets a status, and files the previous commit
 * had but this one does not are recorded as REMOVED with empty contents — the
 * commit then describes the whole tree at that point, not just the additions.
 */
export function classifyFiles(
  previous: { path: string; content: string }[],
  next: GeneratedFile[],
): CommittedFile[] {
  const before = new Map(previous.map((file) => [file.path, file.content]));

  const committed: CommittedFile[] = next.map((file) => {
    const old = before.get(file.path);
    const change: FileChange =
      old === undefined ? "ADDED" : old === file.content ? "UNCHANGED" : "MODIFIED";
    return { ...file, change, hash: fileHash(file.content), ...lineStats(old ?? "", file.content) };
  });

  const kept = new Set(next.map((file) => file.path));
  for (const file of previous) {
    if (kept.has(file.path)) continue;
    committed.push({
      path: file.path,
      content: "",
      language: languageOf(file.path, ""),
      change: "REMOVED",
      hash: fileHash(""),
      added: 0,
      removed: splitLines(file.content).length,
    });
  }

  return committed;
}

/** One-line `3 files · +120 −4` summary for a commit row. */
export function commitStats(files: Pick<CommittedFile, "change" | "added" | "removed">[]) {
  return {
    files: files.filter((file) => file.change !== "REMOVED").length,
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
    changed: files.filter((file) => file.change !== "UNCHANGED").length,
  };
}

/**
 * Default commit message when the author did not write one, derived from what
 * actually changed rather than from the prompt text.
 */
export function describeCommit(files: Pick<CommittedFile, "path" | "change">[]): string {
  const changed = files.filter((file) => file.change !== "UNCHANGED");
  if (changed.length === 0) return files.length > 0 ? "Regenerated with no changes" : "No files returned";
  if (changed.length === 1) {
    const [file] = changed;
    const verb = file.change === "ADDED" ? "Add" : file.change === "REMOVED" ? "Remove" : "Update";
    return `${verb} ${file.path}`;
  }
  const added = changed.filter((file) => file.change === "ADDED").length;
  return added === changed.length
    ? `Add ${changed.length} files`
    : `Update ${changed.length} files`;
}
