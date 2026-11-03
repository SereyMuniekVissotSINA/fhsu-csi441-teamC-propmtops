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
  snapshotSlug,
  cleanSnapshotName,
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
// Baselines are kept per snapshot rather than one per directory, so a project
// can carry several lines of work at once: each name holds its own baseline,
// and switching between them leaves the others untouched. What a snapshot does
// *not* do is swap the files on disk — snapshots are several points of
// comparison over one working tree, not several working copies.
//
// Node builtins live here rather than in `src/lib`, because the libraries are
// shared with the browser bundle.

export const SNAPSHOT_DIR = ".pops";
const INDEX_NAME = "index.json";
const BASELINE_DIR = "baselines";
// Where a single unnamed baseline lived before snapshots existed. It is
// adopted on first use rather than abandoned: a baseline is only useful if it
// survives the upgrade that introduced names for them.
const LEGACY_NAME = "snapshot.json";
const LEGACY_SNAPSHOT = "default";

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
export const MAX_SNAPSHOTS = 50;

export type Baseline = {
  version: 2;
  /** The snapshot this baseline belongs to, as typed and as slugged. */
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

export type Snapshot = {
  name: string;
  slug: string;
  createdAt: string;
  /** Null until the snapshot has a baseline of its own. */
  takenAt: string | null;
  files: number;
  /**
   * The branch this baseline belongs to on the server.
   *
   * A snapshot is owned by a workspace, so the authority for "which branch is
   * this?" is a row in the database; what lives here is the local baseline
   * plus the id that ties it to that row. Null means the server does not know
   * about it yet — an index written before snapshots moved into the workspace,
   * or a baseline taken while the app was unreachable — and the next command
   * that can reach the app fills it in.
   */
  snapshotId: string | null;
};

export type Index = {
  version: 3;
  /**
   * Which workspace this project pushes to. Recorded when the snapshot is
   * created, because a branch cannot be named until its workspace is chosen,
   * and kept so later commands do not ask again.
   */
  workspaceId: string | null;
  active: string | null;
  snapshots: Snapshot[];
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
// The snapshot index
//
// One file lists the snapshots this project knows about and which one is
// active; each snapshot's baseline is a file of its own. Keeping them apart
// means switching snapshots rewrites a pointer rather than a copy of the
// tree, and a corrupt baseline costs one snapshot rather than all of them.
// ---------------------------------------------------------------------------

function emptyIndex(): Index {
  return { version: 3, workspaceId: null, active: null, snapshots: [] };
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`${path} is not readable. Take a fresh baseline with \`pops snapshot\`.`);
  }
}

function writeBaseline(root: string, baseline: Baseline): void {
  const target = baselinePath(root, baseline.slug);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(baseline));
}

/** Adopt a pre-snapshots baseline as a snapshot called "default". */
function adoptLegacy(root: string): Index | null {
  const legacy = join(popsDir(root), LEGACY_NAME);
  if (!existsSync(legacy)) return null;

  const parsed = readJsonFile(legacy) as Record<string, unknown>;
  const files = parsed.files;
  if (!files || typeof files !== "object") return null;

  const takenAt = typeof parsed.takenAt === "string" ? parsed.takenAt : new Date().toISOString();
  const baseline: Baseline = {
    version: 2,
    name: LEGACY_SNAPSHOT,
    slug: LEGACY_SNAPSHOT,
    root,
    takenAt,
    files: files as Record<string, string>,
    skipped: Array.isArray(parsed.skipped) ? (parsed.skipped as string[]) : [],
  };
  writeBaseline(root, baseline);
  rmSync(legacy, { force: true });

  const index: Index = {
    version: 3,
    workspaceId: null,
    active: LEGACY_SNAPSHOT,
    snapshots: [
      {
        name: LEGACY_SNAPSHOT,
        slug: LEGACY_SNAPSHOT,
        createdAt: takenAt,
        takenAt,
        files: Object.keys(baseline.files).length,
        snapshotId: null,
      },
    ],
  };
  saveIndex(root, index);
  return index;
}

export function loadIndex(root: string): Index {
  const path = indexPath(root);
  if (!existsSync(path)) return adoptLegacy(root) ?? emptyIndex();

  const parsed = readJsonFile(path) as Partial<Index> & {
    version?: number;
    /** What version 2 called the list, before a snapshot was a branch. */
    categories?: Snapshot[];
  };

  // Version 2 is adopted rather than rejected: its baselines are still valid
  // copies of a tree, they just predate belonging to a workspace. It spelled
  // the list `categories`, so both keys are read — an index written before the
  // rename must keep working, because the alternative is telling someone their
  // four baselines are unreadable when they are sitting right there.
  const entries = Array.isArray(parsed?.snapshots)
    ? parsed.snapshots
    : Array.isArray(parsed?.categories)
      ? parsed.categories
      : null;

  if (!parsed || (parsed.version !== 3 && parsed.version !== 2) || !entries) {
    throw new CliError(
      `${path} was written by a different version of pops. Take a fresh baseline with \`pops snapshot\`.`,
    );
  }

  return {
    version: 3,
    workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : null,
    active: typeof parsed.active === "string" ? parsed.active : null,
    snapshots: entries
      .filter((entry): entry is Snapshot => Boolean(entry && typeof entry.slug === "string"))
      // A v2 entry has no branch id: nothing on the server knew about it. The
      // next command that reaches the app registers it under the same name.
      .map((entry) => ({ ...entry, snapshotId: entry.snapshotId ?? null })),
  };
}

export function saveIndex(root: string, index: Index): void {
  mkdirSync(popsDir(root), { recursive: true });
  // Readable on purpose: this one is small, and a developer looking into
  // `.pops` should be able to see which snapshots exist without a parser.
  writeFileSync(indexPath(root), `${JSON.stringify(index, null, 2)}\n`);
}

/**
 * Record which workspace this project pushes to.
 *
 * Asked once, at `pops snapshot`, because a branch has to belong to a
 * workspace before it can be named. Changing it later is allowed and simply
 * means the next push lands elsewhere — the baselines on disk are unaffected,
 * since they are compared against this machine's files and nothing else.
 */
export function setWorkspace(root: string, workspaceId: string): void {
  const index = loadIndex(root);
  index.workspaceId = workspaceId;
  saveIndex(root, index);
}

export function storedWorkspace(root: string): string | null {
  return existsSync(indexPath(root)) ? loadIndex(root).workspaceId : null;
}

/**
 * Tie a local baseline to the branch the server created for it.
 *
 * Kept separate from taking the baseline so the two can fail independently:
 * the copy of the tree is what a push diffs against and is worth having even
 * if the app was unreachable when it was taken, and the id can be filled in
 * afterwards by any command that does reach it.
 */
export function linkSnapshot(root: string, slug: string, snapshotId: string): void {
  const index = loadIndex(root);
  const entry = index.snapshots.find((candidate) => candidate.slug === slug);
  if (!entry) return;
  entry.snapshotId = snapshotId;
  saveIndex(root, index);
}

export function findSnapshot(index: Index, needle: string): Snapshot | null {
  const slug = snapshotSlug(needle);
  return index.snapshots.find((entry) => entry.slug === slug) ?? null;
}

export function activeSnapshot(root: string): Snapshot | null {
  const index = loadIndex(root);
  return index.snapshots.find((entry) => entry.slug === index.active) ?? null;
}

/**
 * Which snapshot a command acts on: the one named, or the active one.
 *
 * A name that does not exist is an error rather than a silent creation —
 * `pops push --snapshot typo` quietly opening an empty container would be
 * worse than being told the name is unknown.
 */
export function requireSnapshot(root: string, named?: string): Snapshot {
  const index = loadIndex(root);

  if (named) {
    const found = findSnapshot(index, named);
    if (found) return found;
    const known = index.snapshots.map((entry) => entry.name).join(", ") || "none yet";
    throw new CliError(
      `No snapshot "${named}" in ${root}.\n` +
        `  This project has: ${known}.\n` +
        `  Start one with \`pops snapshot "${named}"\`.`,
    );
  }

  const active = index.snapshots.find((entry) => entry.slug === index.active);
  if (active) return active;

  throw new CliError(
    `No snapshot chosen for ${root}.\n` +
      "Run `pops snapshot` before the agent works, and name the snapshot when asked.",
  );
}

/**
 * Create a snapshot if the name is new, without changing which one is active.
 * Returns the entry and whether it had to be created.
 */
function ensureSnapshot(root: string, rawName: string): { snapshot: Snapshot; created: boolean } {
  const name = cleanSnapshotName(rawName);
  if (!name) {
    throw new CliError(
      `"${rawName}" is not a usable snapshot name. Use letters or numbers, like "auth refactor".`,
    );
  }

  const index = loadIndex(root);
  const slug = snapshotSlug(name);
  const existing = index.snapshots.find((entry) => entry.slug === slug);
  if (existing) return { snapshot: existing, created: false };

  if (index.snapshots.length >= MAX_SNAPSHOTS) {
    throw new CliError(
      `${root} already has ${MAX_SNAPSHOTS} snapshots. Prune ${indexPath(root)} first.`,
    );
  }

  const snapshot: Snapshot = {
    name,
    slug,
    createdAt: new Date().toISOString(),
    takenAt: null,
    files: 0,
    snapshotId: null,
  };
  index.snapshots.push(snapshot);
  saveIndex(root, index);
  return { snapshot, created: true };
}

/**
 * Create the snapshot if it is new, and make it the one later commands act on
 * when none is named.
 */
export function switchSnapshot(
  root: string,
  rawName: string,
): { snapshot: Snapshot; created: boolean } {
  const result = ensureSnapshot(root, rawName);
  const index = loadIndex(root);
  index.active = result.snapshot.slug;
  saveIndex(root, index);
  return result;
}

/** The name to offer when asking the user to name a snapshot. */
export function suggestedName(root: string): string {
  return activeSnapshot(root)?.name ?? cleanSnapshotName(basename(root)) ?? "default";
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

/** Take a baseline for one snapshot, replacing whatever that name held. */
export function takeSnapshot(
  root: string,
  rawName: string,
  { makeActive = true }: { makeActive?: boolean } = {},
): { baseline: Baseline; snapshot: Snapshot; created: boolean } {
  // `makeActive` is false where the baseline moves as a side effect — after a
  // push or a restore that named `--snapshot` — so a one-off override stays a
  // one-off rather than quietly becoming the new working snapshot.
  const { snapshot, created } = makeActive
    ? switchSnapshot(root, rawName)
    : ensureSnapshot(root, rawName);
  const { files, skipped, truncated } = collect(root);
  if (truncated) {
    throw new CliError(
      `${root} has more than ${MAX_SNAPSHOT_FILES} text files or ${Math.round(
        MAX_SNAPSHOT_BYTES / (1024 * 1024),
      )} MB of them.\n` +
        "Point --root at the part of the project the agent will work in.",
    );
  }

  const baseline: Baseline = {
    version: 2,
    name: snapshot.name,
    slug: snapshot.slug,
    root,
    takenAt: new Date().toISOString(),
    files: Object.fromEntries(files),
    skipped: skipped.sort(),
  };
  writeBaseline(root, baseline);

  // Re-read rather than mutate the copy above: the snapshot was written to the
  // index a moment ago, and writing a stale object back would drop that.
  const index = loadIndex(root);
  const entry = index.snapshots.find((candidate) => candidate.slug === snapshot.slug);
  if (entry) {
    entry.takenAt = baseline.takenAt;
    entry.files = files.size;
  }
  if (makeActive) index.active = snapshot.slug;
  saveIndex(root, index);

  return { baseline, snapshot: entry ?? snapshot, created };
}

/**
 * Forget a snapshot: its baseline copy and its entry in the index.
 *
 * Local only, and deliberately so. Runs already pushed under this name are a
 * record of what an agent did and stay in the log — a baseline is the thing
 * that says "compare against here", and deleting one only means this project
 * stops tracking that line of work.
 *
 * What is actually lost is the pre-run contents of files not yet pushed, which
 * is why the caller asks first.
 */
export function forgetSnapshot(
  root: string,
  named: string,
): { snapshot: Snapshot; hadBaseline: boolean; remaining: Snapshot[] } {
  const index = loadIndex(root);
  const snapshot = findSnapshot(index, named);
  if (!snapshot) {
    const known = index.snapshots.map((entry) => entry.name).join(", ") || "none yet";
    throw new CliError(
      `No snapshot "${named}" in ${root}.\n  This project has: ${known}.`,
    );
  }

  const baseline = baselinePath(root, snapshot.slug);
  const hadBaseline = existsSync(baseline);
  rmSync(baseline, { force: true });

  index.snapshots = index.snapshots.filter((entry) => entry.slug !== snapshot.slug);
  // Nothing is promoted in its place. Which of the remaining names should
  // become the working one is not something this command can know, and
  // guessing would have the next `pops push` measure against a baseline the
  // developer did not choose; `pops status` says so plainly instead.
  if (index.active === snapshot.slug) index.active = null;
  saveIndex(root, index);

  return { snapshot, hadBaseline, remaining: index.snapshots };
}

export function loadBaseline(root: string, slug: string): Baseline | null {
  const target = baselinePath(root, slug);
  if (!existsSync(target)) return null;

  const parsed = readJsonFile(target) as Partial<Baseline>;
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
export function compare(baseline: Baseline, current: Collected): LocalFile[] {
  const untracked = new Set([...baseline.skipped, ...current.skipped]);
  const changes: LocalFile[] = [];

  for (const [path, after] of current.files) {
    if (untracked.has(path)) continue;
    const before = Object.prototype.hasOwnProperty.call(baseline.files, path)
      ? baseline.files[path]
      : null;
    if (before === after) continue;
    changes.push({ path, before, after });
  }

  for (const path of Object.keys(baseline.files)) {
    if (untracked.has(path) || current.files.has(path)) continue;
    changes.push({ path, before: baseline.files[path], after: null });
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

/** What changed under `root` since one snapshot's baseline. */
export function localChanges(
  root: string,
  named?: string,
): { snapshot: Snapshot; baseline: Baseline; changes: LocalFile[] } {
  const snapshot = requireSnapshot(root, named);
  const baseline = loadBaseline(root, snapshot.slug);
  if (!baseline) {
    throw new CliError(
      `"${snapshot.name}" has no baseline yet in ${root}.\n` +
        `Run \`pops snapshot "${snapshot.name}"\` before the agent works, so there is a before to compare against.`,
    );
  }
  return { snapshot, baseline, changes: compare(baseline, collect(root)) };
}

/**
 * Every snapshot, with how far its baseline has drifted from the tree.
 *
 * The tree is walked once and compared against each baseline: the point of the
 * listing is to answer "where am I, and what is outstanding elsewhere?" in one
 * pass, and snapshots share one working tree.
 */
export function summariseSnapshots(
  root: string,
): { index: Index; rows: (Snapshot & { changed: number | null })[] } {
  const index = loadIndex(root);
  const current = index.snapshots.some((entry) => entry.takenAt) ? collect(root) : null;

  const rows = index.snapshots.map((entry) => {
    if (!current || !entry.takenAt) return { ...entry, changed: null };
    const baseline = loadBaseline(root, entry.slug);
    return { ...entry, changed: baseline ? compare(baseline, current).length : null };
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
