import { lineStats, splitLines } from "@/lib/code-diff";
import { languageForPath, normalizePath } from "@/lib/paths";

// An agent run: what a coding agent actually did to a local project.
//
// This is the other half of the product from `code-commits.ts`. There, a prompt
// is sent to a model and the files it *returns* become a commit. Here, an agent
// has already edited files on someone's disk, and the record is built from the
// filesystem instead: a baseline snapshot taken before the run, compared
// against the real tree afterwards. The model's own account of what it changed
// is never the source of truth — it is stored as `response`, beside the diff
// that says what happened.
//
// Everything in this module is pure and imports no node builtin, because three
// places need it: the CLI that builds a run, the API route that stores one, and
// the dashboard components that render one in the browser.

/**
 * A file's fate in one run. There is no UNCHANGED: a run records changes, and
 * a file nobody touched is not part of the record.
 */
export type AgentChange = "ADDED" | "MODIFIED" | "REMOVED";

/**
 * One file as the CLI observed it. `null` means the file was not on disk at
 * that point, which is what separates "added" from "was empty".
 */
export type LocalFile = {
  path: string;
  before: string | null;
  after: string | null;
};

export type RunFile = {
  path: string;
  before: string;
  after: string;
  language: string;
  change: AgentChange;
  added: number;
  removed: number;
};

// Caps. A run carries both sides of every file it touched, so an unbounded one
// could be enormous; these keep a single row readable and a single request
// finite. They are generous for a human-sized change and small enough that a
// runaway agent is refused rather than stored.
export const MAX_RUN_FILES = 200;
export const MAX_RUN_FILE_CHARS = 200_000;
export const MAX_RUN_TOTAL_CHARS = 4_000_000;
export const MAX_RUN_TEXT_CHARS = 100_000;
export const MAX_TOOL_EVENTS_CHARS = 200_000;
export const MAX_CATEGORY_CHARS = 60;

// ---------------------------------------------------------------------------
// Categories
//
// Runs are grouped inside a workspace by a name the developer chooses when
// they take a baseline — usually the prompt or the piece of work the agent is
// being pointed at. One category, one baseline: switching between them leaves
// each one's baseline alone, so what changed under one name stays measured
// against that name.
//
// The display name is kept as typed and a slug is stored beside it, because
// the slug is what groups, filters and appears in a URL. Both the CLI and the
// server derive the slug here, so "Auth refactor" and "auth-refactor" are
// never two different containers.
// ---------------------------------------------------------------------------

/** Shown wherever a run predates categories, or was pushed without one. */
export const UNCATEGORISED = "Uncategorised";

export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CATEGORY_CHARS)
    .replace(/-+$/, "");
}

/**
 * Tidy a name the user typed, or null when nothing usable is left.
 *
 * A name that slugifies to nothing — punctuation only — is refused rather than
 * stored, because it could not be told apart from any other such name.
 */
export function cleanCategoryName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_CATEGORY_CHARS);
  return name && categorySlug(name) ? name : null;
}

/**
 * Turn what the CLI observed into the rows a run stores.
 *
 * The server classifies rather than trusting a client-sent status, so a record
 * can never claim a change its own contents contradict. Paths are normalized
 * here too: these are the paths a restore will later write back to disk.
 */
export function classifyLocalChanges(files: LocalFile[]): RunFile[] {
  const byPath = new Map<string, RunFile>();

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path) continue;

    const before = file.before ?? null;
    const after = file.after ?? null;
    if (before === null && after === null) continue;
    // A file present on both sides with identical contents is not a change.
    // The CLI filters these out; the server drops them anyway, because a file
    // written and reverted during the run arrives looking exactly like this.
    if (before !== null && after !== null && before === after) continue;

    const change: AgentChange =
      before === null ? "ADDED" : after === null ? "REMOVED" : "MODIFIED";

    byPath.set(path, {
      path,
      before: before ?? "",
      after: after ?? "",
      language: languageForPath(path),
      change,
      ...lineStats(before ?? "", after ?? ""),
    });
  }

  // Sorted by path so a run reads the same way everywhere, and capped so one
  // pathological run cannot fill the table.
  return [...byPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_RUN_FILES);
}

/** `3 files · +120 −4` for a run row. */
export function runStats(files: Pick<RunFile, "added" | "removed">[]) {
  return {
    files: files.length,
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
  };
}

/** A one-line label for a run, derived from the diff rather than the prompt. */
export function describeRun(files: Pick<RunFile, "path" | "change">[]): string {
  if (files.length === 0) return "No file changes";
  if (files.length === 1) {
    const [file] = files;
    const verb =
      file.change === "ADDED" ? "Added" : file.change === "REMOVED" ? "Removed" : "Changed";
    return `${verb} ${file.path}`;
  }
  const added = files.filter((file) => file.change === "ADDED").length;
  return added === files.length
    ? `Added ${files.length} files`
    : `Changed ${files.length} files`;
}

/** The total char count of a run's file contents, for the cap above. */
export function runCharCount(files: Pick<RunFile, "before" | "after">[]): number {
  return files.reduce((total, file) => total + file.before.length + file.after.length, 0);
}

export type RestoreStep =
  | { path: string; action: "write"; content: string }
  | { path: string; action: "delete" };

/**
 * What undoing a run means, file by file: put back what was there before.
 *
 * A file the run created is deleted; one it changed or deleted is written back
 * from `before`. Deriving this instead of storing it keeps the run a plain
 * record of what happened, with the undo computed from it on demand.
 */
export function restoreSteps(
  files: Pick<RunFile, "path" | "before" | "change">[],
): RestoreStep[] {
  return files.map((file) =>
    file.change === "ADDED"
      ? { path: file.path, action: "delete" as const }
      : { path: file.path, action: "write" as const, content: file.before },
  );
}

/** How a restore reads before it is applied: `2 to rewrite, 1 to delete`. */
export function describeRestore(steps: RestoreStep[]): string {
  const writes = steps.filter((step) => step.action === "write").length;
  const deletes = steps.length - writes;
  const parts: string[] = [];
  if (writes) parts.push(`${writes} file${writes === 1 ? "" : "s"} to rewrite`);
  if (deletes) parts.push(`${deletes} file${deletes === 1 ? "" : "s"} to delete`);
  return parts.join(", ") || "nothing to do";
}

/**
 * Tool events are stored verbatim as the JSON text the agent reported, because
 * their shape belongs to whichever agent produced them and this project is not
 * the place that defines it. Parsing is therefore best-effort: a record that
 * cannot be read back still has to render.
 */
export function parseToolEvents(raw: string): unknown[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** Line count of a side of a file, for the "N lines" labels. */
export function lineCount(content: string): number {
  return content ? splitLines(content).length : 0;
}
