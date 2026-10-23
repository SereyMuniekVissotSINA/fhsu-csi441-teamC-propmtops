import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RUN_FILES,
  categorySlug,
  classifyLocalChanges,
  cleanCategoryName,
  describeRestore,
  describeRun,
  parseToolEvents,
  restoreSteps,
  runCharCount,
  runStats,
} from "./agent-runs";

test("a file's fate comes from which side of it exists", () => {
  const files = classifyLocalChanges([
    { path: "src/added.ts", before: null, after: "export const a = 1;\n" },
    { path: "src/changed.ts", before: "const a = 1;\n", after: "const a = 2;\n" },
    { path: "src/gone.ts", before: "const a = 1;\n", after: null },
  ]);

  assert.deepEqual(
    files.map((file) => [file.path, file.change]),
    [
      ["src/added.ts", "ADDED"],
      ["src/changed.ts", "MODIFIED"],
      ["src/gone.ts", "REMOVED"],
    ],
  );
  // The missing side is stored as empty text; `change` is what says it was
  // absent rather than empty.
  assert.equal(files[0].before, "");
  assert.equal(files[2].after, "");
  assert.equal(files[0].language, "ts");
});

test("an empty file is still a change when it was not there before", () => {
  const files = classifyLocalChanges([
    { path: "touched", before: null, after: "" },
    { path: "emptied", before: "", after: null },
  ]);
  assert.deepEqual(
    files.map((file) => [file.path, file.change]),
    [
      ["emptied", "REMOVED"],
      ["touched", "ADDED"],
    ],
  );
});

test("identical contents are not a change", () => {
  // An agent that writes a file and then reverts it arrives looking like this.
  assert.deepEqual(classifyLocalChanges([{ path: "a.ts", before: "x\n", after: "x\n" }]), []);
  assert.deepEqual(classifyLocalChanges([{ path: "a.ts", before: null, after: null }]), []);
});

test("a path that escapes the project is dropped, not stored", () => {
  // These become writes to a real disk on restore, so they never get in.
  const files = classifyLocalChanges([
    { path: "../../etc/passwd", before: "root\n", after: "hacked\n" },
    { path: "/etc/hosts", before: "a\n", after: "b\n" },
    { path: "src/fine.ts", before: null, after: "ok\n" },
  ]);
  assert.deepEqual(
    files.map((file) => file.path),
    ["etc/hosts", "src/fine.ts"],
  );
});

test("line counts and totals describe the diff", () => {
  const files = classifyLocalChanges([
    { path: "a.ts", before: null, after: "one\ntwo\n" },
    { path: "b.ts", before: "keep\ndrop\n", after: "keep\n" },
  ]);
  assert.deepEqual(runStats(files), { files: 2, added: 2, removed: 1 });
  assert.equal(runCharCount(files), "one\ntwo\n".length + "keep\ndrop\n".length + "keep\n".length);
});

test("a run is labelled from its diff", () => {
  assert.equal(describeRun([]), "No file changes");
  assert.equal(describeRun([{ path: "a.ts", change: "ADDED" }]), "Added a.ts");
  assert.equal(describeRun([{ path: "a.ts", change: "REMOVED" }]), "Removed a.ts");
  assert.equal(
    describeRun([
      { path: "a.ts", change: "ADDED" },
      { path: "b.ts", change: "ADDED" },
    ]),
    "Added 2 files",
  );
  assert.equal(
    describeRun([
      { path: "a.ts", change: "ADDED" },
      { path: "b.ts", change: "MODIFIED" },
    ]),
    "Changed 2 files",
  );
});

test("undoing a run puts back what was there before", () => {
  const steps = restoreSteps([
    { path: "created.ts", before: "", change: "ADDED" },
    { path: "edited.ts", before: "original\n", change: "MODIFIED" },
    { path: "deleted.ts", before: "was here\n", change: "REMOVED" },
  ]);

  assert.deepEqual(steps, [
    // A file the run created has no before-state, so undoing it means removal.
    { path: "created.ts", action: "delete" },
    { path: "edited.ts", action: "write", content: "original\n" },
    { path: "deleted.ts", action: "write", content: "was here\n" },
  ]);
  assert.equal(describeRestore(steps), "2 files to rewrite, 1 file to delete");
  assert.equal(describeRestore([]), "nothing to do");
});

test("too many files is capped rather than refused", () => {
  const many = Array.from({ length: MAX_RUN_FILES + 20 }, (_, index) => ({
    path: `src/file-${String(index).padStart(4, "0")}.ts`,
    before: null,
    after: "x\n",
  }));
  assert.equal(classifyLocalChanges(many).length, MAX_RUN_FILES);
});

test("tool events are read back best-effort", () => {
  assert.deepEqual(parseToolEvents('[{"tool":"Edit"}]'), [{ tool: "Edit" }]);
  // A single object is wrapped; unreadable text renders as nothing rather than
  // breaking the page it appears on.
  assert.deepEqual(parseToolEvents('{"tool":"Edit"}'), [{ tool: "Edit" }]);
  assert.deepEqual(parseToolEvents("not json"), []);
  assert.deepEqual(parseToolEvents(""), []);
});

test("a category name and its slug are one container", () => {
  assert.equal(categorySlug("Auth refactor"), "auth-refactor");
  assert.equal(categorySlug("  AUTH   Refactor  "), "auth-refactor");
  assert.equal(categorySlug("auth-refactor"), "auth-refactor");
  // Punctuation collapses rather than leaving a trailing or doubled dash.
  assert.equal(categorySlug("fix: the  parser!!"), "fix-the-parser");
  assert.equal(categorySlug("***"), "");
});

test("a name is tidied, or refused when nothing usable is left", () => {
  assert.equal(cleanCategoryName("  Auth   refactor "), "Auth refactor");
  assert.equal(cleanCategoryName(""), null);
  assert.equal(cleanCategoryName("   "), null);
  // Punctuation only: it would be indistinguishable from any other such name.
  assert.equal(cleanCategoryName("***"), null);
  // Long names are cut, not rejected, and still slug to something.
  const long = cleanCategoryName("a".repeat(200));
  assert.equal(long?.length, 60);
  assert.equal(categorySlug(long!).length, 60);
});
