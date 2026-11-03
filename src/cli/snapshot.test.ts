import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  activeSnapshot,
  applyRestore,
  baselinePath,
  collect,
  compare,
  forgetSnapshot,
  indexPath,
  insideRoot,
  isIgnoredSegment,
  loadBaseline,
  loadIndex,
  localChanges,
  requireSnapshot,
  summariseSnapshots,
  takeSnapshot,
  switchSnapshot,
} from "./snapshot";

// These exercise the part of a run nothing else can: that the before/after
// contents come from the filesystem. Each test builds a throwaway tree, so the
// walk, the ignore rules and the restore are checked against real files.

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "pops-snapshot-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "const a = 1;\n");
  writeFileSync(join(root, "README.md"), "# demo\n");
  return root;
}

test("a baseline tracks text files and ignores build output", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  mkdirSync(join(root, ".next"));
  writeFileSync(join(root, ".next", "build.json"), "{}\n");
  // A dotfile is a project file, not noise: an agent edits these.
  writeFileSync(join(root, ".gitignore"), "node_modules\n");

  const { baseline } = takeSnapshot(root, "baseline check");
  assert.deepEqual(Object.keys(baseline.files).sort(), [".gitignore", "README.md", "src/a.ts"]);

  // And it is on disk under its snapshot, where the next command looks.
  const loaded = loadBaseline(root, "baseline-check");
  assert.equal(loaded?.files["src/a.ts"], "const a = 1;\n");
});

test("binary files are left untracked, and never reported as changes", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const { baseline } = takeSnapshot(root, "binary check");
  assert.deepEqual(baseline.skipped, ["logo.png"]);

  // Rewriting it must not look like a change the run could undo.
  writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]));
  assert.deepEqual(localChanges(root).changes, []);
});

test("the diff is the real difference between the baseline and the tree", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "work");

  // What an agent run looks like on disk: one edit, one new file, one deletion.
  writeFileSync(join(root, "src", "a.ts"), "const a = 2;\n");
  writeFileSync(join(root, "src", "b.ts"), "export const b = 1;\n");
  rmSync(join(root, "README.md"));

  const { changes } = localChanges(root);
  assert.deepEqual(changes, [
    { path: "README.md", before: "# demo\n", after: null },
    { path: "src/a.ts", before: "const a = 1;\n", after: "const a = 2;\n" },
    { path: "src/b.ts", before: null, after: "export const b = 1;\n" },
  ]);
});

test("a fresh baseline after a push leaves nothing to report", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "work");
  writeFileSync(join(root, "src", "a.ts"), "const a = 2;\n");
  assert.equal(localChanges(root).changes.length, 1);

  takeSnapshot(root, "work");
  assert.deepEqual(localChanges(root).changes, []);
});

test("a run is undone by writing its before-state back", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "work");
  writeFileSync(join(root, "src", "a.ts"), "const a = 2;\n");
  writeFileSync(join(root, "src", "new.ts"), "export const n = 1;\n");
  rmSync(join(root, "README.md"));

  const applied = applyRestore(root, [
    { path: "src/a.ts", action: "write", content: "const a = 1;\n" },
    { path: "src/new.ts", action: "delete" },
    { path: "README.md", action: "write", content: "# demo\n" },
    // Writing into a directory the run removed has to recreate it.
    { path: "docs/notes.md", action: "write", content: "notes\n" },
  ]);

  assert.deepEqual(
    applied.map((step) => step.action),
    ["write", "delete", "write", "write"],
  );
  assert.equal(readFileSync(join(root, "src", "a.ts"), "utf8"), "const a = 1;\n");
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "# demo\n");
  assert.equal(readFileSync(join(root, "docs", "notes.md"), "utf8"), "notes\n");
  assert.equal(collect(root).files.has("src/new.ts"), false);
});

test("a restore cannot be talked into writing outside the project", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(insideRoot(root, "src/a.ts"), join(root, "src", "a.ts"));
  assert.equal(insideRoot(root, "../escape.ts"), null);
  assert.equal(insideRoot(root, "src/../../escape.ts"), null);

  const applied = applyRestore(root, [
    { path: "../escape.ts", action: "write", content: "nope\n" },
  ]);
  assert.deepEqual(applied, [
    { path: "../escape.ts", action: "skipped", note: "path escapes the project root" },
  ]);
});

test("untracked paths are excluded from both sides of a comparison", () => {
  const snapshot = {
    version: 2 as const,
    name: "demo",
    slug: "demo",
    root: "/tmp/demo",
    takenAt: new Date().toISOString(),
    files: { "a.ts": "one\n", "big.bin": "" },
    skipped: ["big.bin"],
  };
  const current = {
    files: new Map([["a.ts", "two\n"]]),
    skipped: ["big.bin"],
    truncated: false,
  };

  assert.deepEqual(compare(snapshot, current), [
    { path: "a.ts", before: "one\n", after: "two\n" },
  ]);
});

test("the ignore list covers directories by name and nothing else", () => {
  assert.equal(isIgnoredSegment("node_modules", "directory"), true);
  assert.equal(isIgnoredSegment(".git", "directory"), true);
  assert.equal(isIgnoredSegment(".pops", "directory"), true);
  assert.equal(isIgnoredSegment(".DS_Store", "file"), true);
  // Not ignored: a source directory whose name merely starts with a dot, and a
  // file that happens to share a name with an ignored directory.
  assert.equal(isIgnoredSegment(".vscode", "directory"), false);
  assert.equal(isIgnoredSegment("node_modules", "file"), false);
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

test("each snapshot keeps its own baseline, and switching leaves the others alone", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "Auth refactor");
  writeFileSync(join(root, "src", "a.ts"), "const a = 2;\n");

  // A second snapshot baselines the tree as it stands now, so it starts clean
  // while the first still measures the edit above.
  takeSnapshot(root, "Docs pass");
  assert.deepEqual(localChanges(root).changes, []);
  assert.equal(localChanges(root, "Auth refactor").changes.length, 1);

  // Switching back does not touch either baseline.
  switchSnapshot(root, "auth refactor");
  assert.equal(activeSnapshot(root)?.name, "Auth refactor");
  assert.equal(localChanges(root).changes.length, 1);
  assert.deepEqual(localChanges(root, "Docs pass").changes, []);
});

test("a name and its slug are the same container", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "Auth refactor");
  const again = switchSnapshot(root, "AUTH   refactor");
  assert.equal(again.created, false);
  assert.equal(again.snapshot.slug, "auth-refactor");
  assert.equal(loadIndex(root).snapshots.length, 1);
});

test("an unusable name is refused rather than stored", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(() => switchSnapshot(root, "   "), /not a usable snapshot name/);
  assert.throws(() => switchSnapshot(root, "***"), /not a usable snapshot name/);
  assert.equal(loadIndex(root).snapshots.length, 0);
});

test("naming a snapshot that does not exist says so instead of creating it", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "work");
  assert.throws(() => requireSnapshot(root, "typo"), /No snapshot "typo"/);
  // And acting with none chosen at all is its own message.
  const empty = project();
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.throws(() => requireSnapshot(empty), /No snapshot chosen/);
});

test("a snapshot with no baseline yet reports that, not an empty diff", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  switchSnapshot(root, "planned");
  assert.throws(() => localChanges(root), /has no baseline yet/);
});

test("the listing says where you are and what is outstanding elsewhere", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "first");
  takeSnapshot(root, "second");
  writeFileSync(join(root, "src", "a.ts"), "const a = 3;\n");

  const { index, rows } = summariseSnapshots(root);
  assert.equal(index.active, "second");
  assert.deepEqual(
    rows.map((row) => [row.slug, row.changed]),
    [
      ["first", 1],
      ["second", 1],
    ],
  );
  // Both see the edit: snapshots are points of comparison over one tree, not
  // separate working copies. The fixture holds two files, and both baselines
  // tracked both of them.
  assert.equal(rows[0].files, 2);
  assert.equal(rows[1].files, 2);
});

test("a pre-snapshots baseline is adopted rather than abandoned", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Exactly what the previous version of pops wrote.
  mkdirSync(join(root, ".pops"), { recursive: true });
  writeFileSync(
    join(root, ".pops", "snapshot.json"),
    JSON.stringify({
      version: 1,
      root,
      takenAt: "2026-10-22T12:00:00.000Z",
      files: { "src/a.ts": "const a = 1;\n", "README.md": "# demo\n" },
      skipped: [],
    }),
  );

  const snapshot = activeSnapshot(root);
  assert.equal(snapshot?.name, "default");
  assert.equal(snapshot?.takenAt, "2026-10-22T12:00:00.000Z");
  // The adopted baseline still measures what has happened since.
  writeFileSync(join(root, "src", "a.ts"), "const a = 2;\n");
  assert.equal(localChanges(root).changes.length, 1);
});

test("a one-off --snapshot does not become the working snapshot", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "first");
  takeSnapshot(root, "second");
  assert.equal(activeSnapshot(root)?.slug, "second");

  // What `pops push --snapshot first` does when it re-baselines afterwards.
  takeSnapshot(root, "first", { makeActive: false });
  assert.equal(activeSnapshot(root)?.slug, "second");

  // And a snapshot created that way still exists, without stealing the pointer.
  takeSnapshot(root, "third", { makeActive: false });
  assert.equal(activeSnapshot(root)?.slug, "second");
  assert.equal(loadIndex(root).snapshots.length, 3);
});

test("deleting a baseline forgets it and leaves no snapshot active", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "keep this");
  takeSnapshot(root, "throw away");
  assert.equal(activeSnapshot(root)?.slug, "throw-away");

  const { snapshot, hadBaseline, remaining } = forgetSnapshot(root, "Throw Away");
  // Found by slug, so the name as typed does not have to match character for
  // character.
  assert.equal(snapshot.slug, "throw-away");
  assert.equal(hadBaseline, true);
  assert.deepEqual(
    remaining.map((entry) => entry.slug),
    ["keep-this"],
  );

  // The copy on disk is gone, and nothing was promoted in its place.
  assert.equal(existsSync(baselinePath(root, "throw-away")), false);
  assert.equal(activeSnapshot(root), null);
  assert.throws(() => localChanges(root), /No snapshot chosen/);

  // The snapshot that was not named is untouched and still measures drift.
  writeFileSync(join(root, "src", "a.ts"), "const a = 2;\n");
  assert.equal(localChanges(root, "keep this").changes.length, 1);
});

test("deleting a snapshot that was never baselined, or does not exist", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Created as a side effect of a `--snapshot` push that never ran.
  takeSnapshot(root, "real");
  switchSnapshot(root, "named but empty");
  rmSync(baselinePath(root, "named-but-empty"), { force: true });

  const { hadBaseline } = forgetSnapshot(root, "named but empty");
  assert.equal(hadBaseline, false);
  assert.equal(loadIndex(root).snapshots.length, 1);

  // A typo names what the project does have rather than silently doing nothing.
  assert.throws(() => forgetSnapshot(root, "nmaed but empty"), /This project has: real/);
});

test("a version 2 index is adopted, spelling and all", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Exactly what the version before workspace-owned snapshots wrote: the list
  // under `categories`, and no ids, because nothing on the server knew about
  // these yet.
  takeSnapshot(root, "Ice-cream webpage");
  takeSnapshot(root, "TEST-snapshot");
  const v2 = {
    version: 2,
    active: "test-snapshot",
    categories: loadIndex(root).snapshots.map((entry) => ({
      name: entry.name,
      slug: entry.slug,
      createdAt: entry.createdAt,
      takenAt: entry.takenAt,
      files: entry.files,
    })),
  };
  writeFileSync(indexPath(root), JSON.stringify(v2, null, 2));

  const index = loadIndex(root);
  assert.equal(index.version, 3);
  assert.equal(index.workspaceId, null);
  assert.equal(index.active, "test-snapshot");
  assert.deepEqual(
    index.snapshots.map((entry) => entry.slug),
    ["ice-cream-webpage", "test-snapshot"],
  );
  // Unregistered, so the next command that can reach the app creates the
  // branch — and the baselines still measure what has happened since.
  assert.deepEqual(
    index.snapshots.map((entry) => entry.snapshotId),
    [null, null],
  );
  assert.equal(activeSnapshot(root)?.name, "TEST-snapshot");

  writeFileSync(join(root, "src", "a.ts"), "const a = 2;\n");
  assert.equal(localChanges(root).changes.length, 1);
});

test("an index from a future version is refused rather than guessed at", (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  takeSnapshot(root, "work");
  writeFileSync(indexPath(root), JSON.stringify({ version: 9, snapshots: [] }));
  assert.throws(() => loadIndex(root), /written by a different version of pops/);
});
