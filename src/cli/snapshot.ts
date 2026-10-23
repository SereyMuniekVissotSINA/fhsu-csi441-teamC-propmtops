import {
  type Dirent,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  categorySlug,
  cleanCategoryName,
  type LocalFile,
  type RestoreStep,
} from "@/lib/agent-runs";

import { CliError } from "./client";

// The local half of an agent run: named baselines of a working directory, and
// the real diff against whichever one is active.
//
// The whole point is that the diff comes from the filesystem, not from the
// agent. A model's account of what it edited is often incomplete and sometimes
// wrong, and a record built from it would be worth nothing to restore from. So
// `pops snapshot` copies the tree first, the agent does whatever it does, and
// `pops push` compares.
//
// Baselines are kept per category rather than one per directory, so a project
// can carry several lines of work at once: each name holds its own baseline,
// and switching between them leaves the others untouched. What a category does
// *not* do is swap the files on disk — categories are several points of
// comparison over one working tree, not several working copies.
//
// Node builtins live here rather than in `src/lib`, because the libraries are
// shared with the browser bundle.

export const SNAPSHOT_DIR = ".pops";
const INDEX_NAME = "index.json";
const BASELINE_DIR = "baselines";
// Where a single unnamed baseline lived before categories existed. It is
// adopted on first use rather than abandoned: a baseline is only useful if it
// survives the upgrade that introduced names for them.
const LEGACY_NAME = "snapshot.json";
const LEGACY_CATEGORY = "default";

/**
 * Directories never worth snapshotting: version control, dependencies, and
 * build output. An agent that edits one of these has not changed the project,
 * and copying them would make a snapshot enormous.
 */
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  SNAPSHOT_DIR,
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "out",
  "build",
  "dist",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "vendor",
]);

const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);

// Per-file and whole-snapshot ceilings. A snapshot is a full copy of the tree,
// so these are what stop `pops snapshot` in a large repository from writing a
// file nobody wants and a push nobody can store.
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_SNAPSHOT_FILES = 4000;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_CATEGORIES = 50;

export type Snapshot = {
  version: 2;
  /** The category this baseline belongs to, as typed and as slugged. */
  name: string;
  slug: string;
  root: string;
  takenAt: string;
  /** Relative path → contents, for every file the snapshot tracks. */
  files: Record<string, string>;
  /**
   * Paths deliberately left untracked — too large, or not text. Kept so the
   * diff can exclude them on both sides: an untracked file must never be
   * reported as added, and a tracked one must never silently stop being
   * compared.
   */
  skipped: string[];
};

export type Category = {
  name: string;
  slug: string;
  createdAt: string;
  /** Null until the category has a baseline of its own. */
  takenAt: string | null;
  files: number;
};

export type Index = {
  version: 2;
  active: string | null;
  categories: Category[];
};

function popsDir(root: string): string {
  return join(root, SNAPSHOT_DIR);
}

export function indexPath(root: string): string {
  return join(popsDir(root), INDEX_NAME);
}

export function baselinePath(root: string, slug: string): string {
  return join(popsDir(root), BASELINE_DIR, `${slug}.json`);
}

/** True when a buffer looks like something other than text. */
function isBinary(buffer: Buffer): boolean {
  // A NUL byte in the first few KB is the same heuristic git uses, and it is
  // right far more often than any content sniffing would be.
  return buffer.subarray(0, 8000).includes(0);
}

/**
 * Only the names above are ignored, and dotfiles are not ignored as a class:
 * `.env.example`, `.gitignore` and `.vscode/mcp.json` are all project files an
 * agent legitimately edits, and a run that silently omitted them would be a
 * record of a change that cannot be undone.
 */
export function isIgnoredSegment(name: string, kind: "file" | "directory"): boolean {
  return kind === "directory" ? IGNORED_DIRECTORIES.has(name) : IGNORED_FILES.has(name);
}

export type Collected = { files: Map<string, string>; skipped: string[]; truncated: boolean };

/**
 * Read every text file under `root` that is worth tracking.
 *
 * Walks with `readdirSync` rather than a glob library so the ignore rules above
 * are the only rules in play — a surprise from a dependency's matching
 * semantics would quietly change what a run records.
 */
export function collect(root: string): Collected {
  const files = new Map<string, string>();
  const skipped: string[] = [];
  let bytes = 0;
  let truncated = false;

  const walk = (directory: string): void => {
    if (truncated) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      // An unreadable directory is skipped rather than fatal: a project can
      // contain one the user cannot read, and refusing to snapshot at all
      // would be worse than snapshotting the rest.
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      // Symlinks are not followed: they can point outside the project and can
      // make the walk loop, and a link's target is not this project's file.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (isIgnoredSegment(entry.name, "directory")) continue;
        walk(absolute);
        if (truncated) return;
        continue;
      }
      if (!entry.isFile() || isIgnoredSegment(entry.name, "file")) continue;

      const path = relative(root, absolute).split(sep).join("/");

      let size: number;
      try {
        size = statSync(absolute).size;
      } catch {
        continue;
      }
      if (size > MAX_FILE_BYTES) {
        skipped.push(path);
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = readFileSync(absolute);
      } catch {
        continue;
      }
      if (isBinary(buffer)) {
        skipped.push(path);
        continue;
      }

      if (files.size >= MAX_SNAPSHOT_FILES || bytes + buffer.byteLength > MAX_SNAPSHOT_BYTES) {
        // Stop rather than keep a partial tree quietly: a snapshot that is
        // missing files would report them as added on the next push.
        truncated = true;
        return;
      }

      bytes += buffer.byteLength;
      files.set(path, buffer.toString("utf8"));
    }
  };

  walk(root);
  return { files, skipped, truncated };
}

// ---------------------------------------------------------------------------
// The category index
//
// One file lists the categories this project knows about and which one is
// active; each category's baseline is a file of its own. Keeping them apart
// means switching categories rewrites a pointer rather than a copy of the
// tree, and a corrupt baseline costs one category rather than all of them.
// ---------------------------------------------------------------------------

function emptyIndex(): Index {
  return { version: 2, active: null, categories: [] };
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`${path} is not readable. Take a fresh baseline with \`pops snapshot\`.`);
  }
}

function writeBaseline(root: string, snapshot: Snapshot): void {
  const target = baselinePath(root, snapshot.slug);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(snapshot));
}

/** Adopt a pre-categories baseline as a category called "default". */
function adoptLegacy(root: string): Index | null {
  const legacy = join(popsDir(root), LEGACY_NAME);
  if (!existsSync(legacy)) return null;

  const parsed = readJsonFile(legacy) as Record<string, unknown>;
  const files = parsed.files;
  if (!files || typeof files !== "object") return null;

  const takenAt = typeof parsed.takenAt === "string" ? parsed.takenAt : new Date().toISOString();
  const snapshot: Snapshot = {
    version: 2,
    name: LEGACY_CATEGORY,
    slug: LEGACY_CATEGORY,
    root,
    takenAt,
    files: files as Record<string, string>,
    skipped: Array.isArray(parsed.skipped) ? (parsed.skipped as string[]) : [],
  };
  writeBaseline(root, snapshot);
  rmSync(legacy, { force: true });

  const index: Index = {
    version: 2,
    active: LEGACY_CATEGORY,
    categories: [
      {
        name: LEGACY_CATEGORY,
        slug: LEGACY_CATEGORY,
        createdAt: takenAt,
        takenAt,
        files: Object.keys(snapshot.files).length,
      },
    ],
  };
  saveIndex(root, index);
  return index;
}

export function loadIndex(root: string): Index {
  const path = indexPath(root);
  if (!existsSync(path)) return adoptLegacy(root) ?? emptyIndex();

  const parsed = readJsonFile(path) as Partial<Index>;
  if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.categories)) {
    throw new CliError(
      `${path} was written by a different version of pops. Take a fresh baseline with \`pops snapshot\`.`,
    );
  }
  return {
    version: 2,
    active: typeof parsed.active === "string" ? parsed.active : null,
    categories: parsed.categories.filter(
      (entry): entry is Category => Boolean(entry && typeof entry.slug === "string"),
    ),
  };
}

export function saveIndex(root: string, index: Index): void {
  mkdirSync(popsDir(root), { recursive: true });
  // Readable on purpose: this one is small, and a developer looking into
  // `.pops` should be able to see which categories exist without a parser.
  writeFileSync(indexPath(root), `${JSON.stringify(index, null, 2)}\n`);
}

export function findCategory(index: Index, needle: string): Category | null {
  const slug = categorySlug(needle);
  return index.categories.find((entry) => entry.slug === slug) ?? null;
}

export function activeCategory(root: string): Category | null {
  const index = loadIndex(root);
  return index.categories.find((entry) => entry.slug === index.active) ?? null;
}

/**
 * Which category a command acts on: the one named, or the active one.
 *
 * A name that does not exist is an error rather than a silent creation —
 * `pops push --category typo` quietly opening an empty container would be
 * worse than being told the name is unknown.
 */
export function requireCategory(root: string, named?: string): Category {
  const index = loadIndex(root);

  if (named) {
    const found = findCategory(index, named);
    if (found) return found;
    const known = index.categories.map((entry) => entry.name).join(", ") || "none yet";
    throw new CliError(
      `No snapshot category "${named}" in ${root}.\n` +
        `  This project has: ${known}.\n` +
        `  Start one with \`pops snapshot "${named}"\`.`,
    );
  }

  const active = index.categories.find((entry) => entry.slug === index.active);
  if (active) return active;

  throw new CliError(
    `No snapshot category chosen for ${root}.\n` +
      "Run `pops snapshot` before the agent works, and name the snapshot when asked.",
  );
}

/**
 * Create a category if the name is new, without changing which one is active.
 * Returns the entry and whether it had to be created.
 */
function ensureCategory(root: string, rawName: string): { category: Category; created: boolean } {
  const name = cleanCategoryName(rawName);
  if (!name) {
    throw new CliError(
      `"${rawName}" is not a usable snapshot name. Use letters or numbers, like "auth refactor".`,
    );
  }

  const index = loadIndex(root);
  const slug = categorySlug(name);
  const existing = index.categories.find((entry) => entry.slug === slug);
  if (existing) return { category: existing, created: false };

  if (index.categories.length >= MAX_CATEGORIES) {
    throw new CliError(
      `${root} already has ${MAX_CATEGORIES} snapshot categories. Prune ${indexPath(root)} first.`,
    );
  }

  const category: Category = {
    name,
    slug,
    createdAt: new Date().toISOString(),
    takenAt: null,
    files: 0,
  };
  index.categories.push(category);
  saveIndex(root, index);
  return { category, created: true };
}

/**
 * Create the category if it is new, and make it the one later commands act on
 * when none is named.
 */
export function switchCategory(
  root: string,
  rawName: string,
): { category: Category; created: boolean } {
  const result = ensureCategory(root, rawName);
  const index = loadIndex(root);
  index.active = result.category.slug;
  saveIndex(root, index);
  return result;
}

/** The name to offer when asking the user to name a snapshot. */
export function suggestedName(root: string): string {
  return activeCategory(root)?.name ?? cleanCategoryName(basename(root)) ?? "default";
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

/** Take a baseline for one category, replacing whatever that name held. */
export function takeSnapshot(
  root: string,
  rawName: string,
  { makeActive = true }: { makeActive?: boolean } = {},
): { snapshot: Snapshot; category: Category; created: boolean } {
  // `makeActive` is false where the baseline moves as a side effect — after a
  // push or a restore that named `--category` — so a one-off override stays a
  // one-off rather than quietly becoming the new working category.
  const { category, created } = makeActive
    ? switchCategory(root, rawName)
    : ensureCategory(root, rawName);
  const { files, skipped, truncated } = collect(root);
  if (truncated) {
    throw new CliError(
      `${root} has more than ${MAX_SNAPSHOT_FILES} text files or ${Math.round(
        MAX_SNAPSHOT_BYTES / (1024 * 1024),
      )} MB of them.\n` +
        "Point --root at the part of the project the agent will work in.",
    );
  }

  const snapshot: Snapshot = {
    version: 2,
    name: category.name,
    slug: category.slug,
    root,
    takenAt: new Date().toISOString(),
    files: Object.fromEntries(files),
    skipped: skipped.sort(),
  };
  writeBaseline(root, snapshot);

  // Re-read rather than mutate the copy above: the category was written to the
  // index a moment ago, and writing a stale object back would drop that.
  const index = loadIndex(root);
  const entry = index.categories.find((candidate) => candidate.slug === category.slug);
  if (entry) {
    entry.takenAt = snapshot.takenAt;
    entry.files = files.size;
  }
  if (makeActive) index.active = category.slug;
  saveIndex(root, index);

  return { snapshot, category: entry ?? category, created };
}

export function loadBaseline(root: string, slug: string): Snapshot | null {
  const target = baselinePath(root, slug);
  if (!existsSync(target)) return null;

  const parsed = readJsonFile(target) as Partial<Snapshot>;
  if (!parsed || parsed.version !== 2 || typeof parsed.files !== "object" || parsed.files === null) {
    throw new CliError(
      `${target} was written by a different version of pops. Take a fresh baseline with \`pops snapshot\`.`,
    );
  }
  return {
    version: 2,
    name: typeof parsed.name === "string" ? parsed.name : slug,
    slug,
    root: typeof parsed.root === "string" ? parsed.root : root,
    takenAt: typeof parsed.takenAt === "string" ? parsed.takenAt : "",
    files: parsed.files as Record<string, string>,
    skipped: Array.isArray(parsed.skipped) ? (parsed.skipped as string[]) : [],
  };
}

/**
 * The real difference between a baseline and the tree as it stands now.
 *
 * Paths either side left untracked are excluded from both, so a 4 MB asset or a
 * binary never shows up as a change it is not possible to restore.
 */
export function compare(snapshot: Snapshot, current: Collected): LocalFile[] {
  const untracked = new Set([...snapshot.skipped, ...current.skipped]);
  const changes: LocalFile[] = [];

  for (const [path, after] of current.files) {
    if (untracked.has(path)) continue;
    const before = Object.prototype.hasOwnProperty.call(snapshot.files, path)
      ? snapshot.files[path]
      : null;
    if (before === after) continue;
    changes.push({ path, before, after });
  }

  for (const path of Object.keys(snapshot.files)) {
    if (untracked.has(path) || current.files.has(path)) continue;
    changes.push({ path, before: snapshot.files[path], after: null });
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

/** What changed under `root` since one category's baseline. */
export function localChanges(
  root: string,
  named?: string,
): { category: Category; snapshot: Snapshot; changes: LocalFile[] } {
  const category = requireCategory(root, named);
  const snapshot = loadBaseline(root, category.slug);
  if (!snapshot) {
    throw new CliError(
      `"${category.name}" has no baseline yet in ${root}.\n` +
        `Run \`pops snapshot "${category.name}"\` before the agent works, so there is a before to compare against.`,
    );
  }
  return { category, snapshot, changes: compare(snapshot, collect(root)) };
}

/**
 * Every category, with how far its baseline has drifted from the tree.
 *
 * The tree is walked once and compared against each baseline: the point of the
 * listing is to answer "where am I, and what is outstanding elsewhere?" in one
 * pass, and categories share one working tree.
 */
export function summariseCategories(
  root: string,
): { index: Index; rows: (Category & { changed: number | null })[] } {
  const index = loadIndex(root);
  const current = index.categories.some((entry) => entry.takenAt) ? collect(root) : null;

  const rows = index.categories.map((entry) => {
    if (!current || !entry.takenAt) return { ...entry, changed: null };
    const snapshot = loadBaseline(root, entry.slug);
    return { ...entry, changed: snapshot ? compare(snapshot, current).length : null };
  });

  return { index, rows };
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

/**
 * Make sure a path from the server stays inside the directory being restored.
 *
 * The paths were normalized when the run was stored, but this is the moment
 * they turn into writes on a real disk, so they are checked again here against
 * the resolved root rather than trusted across the network.
 */
export function insideRoot(root: string, path: string): string | null {
  const absolute = resolve(root, path);
  const within = relative(root, absolute);
  if (!within || within.startsWith("..") || within.split(sep).includes("..")) return null;
  return absolute;
}

export type AppliedStep = { path: string; action: "write" | "delete" | "skipped"; note?: string };

/**
 * Put a run's `before` state back on disk.
 *
 * Deliberately not clever: it writes the recorded contents and deletes the
 * files the run created, and it does not try to merge with whatever has
 * happened since. The caller is expected to have shown the plan and asked
 * first, because this overwrites the developer's working directory.
 */
export function applyRestore(root: string, steps: RestoreStep[]): AppliedStep[] {
  const applied: AppliedStep[] = [];

  for (const step of steps) {
    const absolute = insideRoot(root, step.path);
    if (!absolute) {
      applied.push({ path: step.path, action: "skipped", note: "path escapes the project root" });
      continue;
    }

    if (step.action === "delete") {
      try {
        rmSync(absolute, { force: true });
        // Empty directories are left behind on purpose: removing them could
        // take out a directory that was there before the run.
        applied.push({ path: step.path, action: "delete" });
      } catch (error) {
        applied.push({
          path: step.path,
          action: "skipped",
          note: error instanceof Error ? error.message : "could not delete",
        });
      }
      continue;
    }

    try {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, step.content, "utf8");
      applied.push({ path: step.path, action: "write" });
    } catch (error) {
      applied.push({
        path: step.path,
        action: "skipped",
        note: error instanceof Error ? error.message : "could not write",
      });
    }
  }

  return applied;
}
