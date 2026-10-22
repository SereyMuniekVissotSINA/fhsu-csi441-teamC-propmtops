import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFiles,
  commitStats,
  describeCommit,
  diffHunks,
  fileHash,
  lineStats,
  normalizePath,
  parseGeneratedFiles,
} from "./code-commits";

test("reads file paths from every fence shape models actually emit", () => {
  const output = [
    "Here you go.",
    "",
    "```ts src/lib/a.ts",
    "export const a = 1;",
    "```",
    "",
    "```tsx path=src/components/b.tsx",
    "export function B() {}",
    "```",
    "",
    "```json:package.json",
    "{}",
    "```",
    "",
    '```css title="src/app/c.css"',
    ".c {}",
    "```",
    "",
    "**src/lib/d.ts**",
    "",
    "```ts",
    "export const d = 4;",
    "```",
    "",
    "### src/lib/e.ts",
    "```ts",
    "export const e = 5;",
    "```",
  ].join("\n");

  const files = parseGeneratedFiles(output);
  assert.deepEqual(
    files.map((file) => file.path),
    ["src/lib/a.ts", "src/components/b.tsx", "package.json", "src/app/c.css", "src/lib/d.ts", "src/lib/e.ts"],
  );
  assert.equal(files[0].content, "export const a = 1;");
  assert.equal(files[1].language, "tsx");
  // Language is inferred from the extension when the fence omits it.
  assert.equal(files[4].language, "ts");
});

test("fence attributes wrapped in braces still name the file", () => {
  const files = parseGeneratedFiles("```tsx {filename=src/app/page.tsx}\nexport default function Page() {}\n```");
  assert.deepEqual(files.map((file) => file.path), ["src/app/page.tsx"]);
});

test("a leading path comment names the file, and stays in the contents", () => {
  const files = parseGeneratedFiles("```\n// src/lib/f.ts\nexport const f = 6;\n```");
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "src/lib/f.ts");
  assert.equal(files[0].content, "// src/lib/f.ts\nexport const f = 6;");
});

test("unnamed blocks are ignored next to named ones, but kept when nothing is named", () => {
  const mixed = parseGeneratedFiles(
    "```ts src/lib/g.ts\nexport const g = 7;\n```\n\nRun it:\n\n```bash\nbun run dev\n```",
  );
  assert.deepEqual(mixed.map((file) => file.path), ["src/lib/g.ts"]);

  const anonymous = parseGeneratedFiles("```python\nprint(1)\n```");
  assert.deepEqual(anonymous.map((file) => file.path), ["generated-1.py"]);
});

test("a repeated path keeps its position and takes the newer contents", () => {
  const files = parseGeneratedFiles(
    [
      "```ts src/lib/h.ts",
      "export const h = 1;",
      "```",
      "```ts src/lib/i.ts",
      "export const i = 2;",
      "```",
      "Correction:",
      "```ts src/lib/h.ts",
      "export const h = 99;",
      "```",
    ].join("\n"),
  );
  assert.deepEqual(files.map((file) => file.path), ["src/lib/h.ts", "src/lib/i.ts"]);
  assert.equal(files[0].content, "export const h = 99;");
});

test("a response cut off mid-file still commits what arrived", () => {
  const files = parseGeneratedFiles("```ts src/lib/j.ts\nexport const j = 1;\nexport const k =");
  assert.equal(files.length, 1);
  assert.equal(files[0].content, "export const j = 1;\nexport const k =");
});

test("paths that would escape the project root are rejected", () => {
  assert.equal(normalizePath("../../etc/passwd"), null);
  assert.equal(normalizePath("/etc/passwd"), "etc/passwd");
  assert.equal(normalizePath("./src/a.ts"), "src/a.ts");
  assert.equal(normalizePath("src//nested///a.ts"), "src/nested/a.ts");
  assert.equal(normalizePath("`src/a.ts`"), "src/a.ts");
  // Braced and bolded fence attributes are common in markdown-flavoured output.
  assert.equal(normalizePath("{src/a.ts}"), "src/a.ts");
  assert.equal(normalizePath("**src/a.ts**"), "src/a.ts");
  assert.equal(normalizePath("   "), null);
  assert.equal(normalizePath("a".repeat(201)), null);

  // Traversal in the fence info never becomes a committed file.
  assert.deepEqual(parseGeneratedFiles("```ts ../../secrets.ts\nconst x = 1;\n```"), [
    { path: "generated-1.ts", content: "const x = 1;", language: "ts" },
  ]);
});

test("the same contents always hash the same, different contents do not", () => {
  assert.equal(fileHash("export const a = 1;"), fileHash("export const a = 1;"));
  assert.notEqual(fileHash("export const a = 1;"), fileHash("export const a = 2;"));
  assert.equal(fileHash("x").length, 12);
});

test("classify marks files added, modified, unchanged, and removed", () => {
  const previous = [
    { path: "src/a.ts", content: "one\ntwo\n" },
    { path: "src/b.ts", content: "same\n" },
    { path: "src/gone.ts", content: "bye\nbye\n" },
  ];
  const next = [
    { path: "src/a.ts", content: "one\ntwo\nthree\n", language: "ts" },
    { path: "src/b.ts", content: "same\n", language: "ts" },
    { path: "src/new.ts", content: "fresh\n", language: "ts" },
  ];

  const files = classifyFiles(previous, next);
  const byPath = Object.fromEntries(files.map((file) => [file.path, file]));

  assert.equal(byPath["src/a.ts"].change, "MODIFIED");
  assert.deepEqual([byPath["src/a.ts"].added, byPath["src/a.ts"].removed], [1, 0]);
  assert.equal(byPath["src/b.ts"].change, "UNCHANGED");
  assert.equal(byPath["src/new.ts"].change, "ADDED");
  assert.equal(byPath["src/new.ts"].added, 1);
  assert.equal(byPath["src/gone.ts"].change, "REMOVED");
  assert.equal(byPath["src/gone.ts"].content, "");
  assert.equal(byPath["src/gone.ts"].removed, 2);
});

test("the first commit treats everything as added", () => {
  const files = classifyFiles([], [{ path: "src/a.ts", content: "one\ntwo\n", language: "ts" }]);
  assert.equal(files[0].change, "ADDED");
  assert.deepEqual([files[0].added, files[0].removed], [2, 0]);
});

test("line stats count only what changed", () => {
  assert.deepEqual(lineStats("a\nb\nc\n", "a\nb\nc\n"), { added: 0, removed: 0 });
  assert.deepEqual(lineStats("a\nb\nc\n", "a\nB\nc\n"), { added: 1, removed: 1 });
  assert.deepEqual(lineStats("", "a\nb\n"), { added: 2, removed: 0 });
  assert.deepEqual(lineStats("a\nb\n", ""), { added: 0, removed: 2 });
});

test("hunks keep context around changes and report what they skipped", () => {
  const before = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
  const after = before.replace("line 15", "changed 15");

  const hunks = diffHunks(before, after, 2);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].skippedBefore, 13);
  assert.deepEqual(
    hunks[0].lines.map((line) => line.kind),
    [" ", " ", "-", "+", " ", " "],
  );
});

test("commit stats and default messages describe the change", () => {
  const files = classifyFiles(
    [{ path: "src/a.ts", content: "one\n" }],
    [
      { path: "src/a.ts", content: "one\ntwo\n", language: "ts" },
      { path: "src/b.ts", content: "new\n", language: "ts" },
    ],
  );

  assert.deepEqual(commitStats(files), { files: 2, added: 2, removed: 0, changed: 2 });
  assert.equal(describeCommit(files), "Update 2 files");
  assert.equal(
    describeCommit([{ path: "src/only.ts", change: "ADDED" }]),
    "Add src/only.ts",
  );
  assert.equal(
    describeCommit([{ path: "src/same.ts", change: "UNCHANGED" }]),
    "Regenerated with no changes",
  );
  assert.equal(describeCommit([]), "No files returned");
});

test("a bare path on the first line inside the block names the file and is removed", () => {
  // The shape nemotron actually produced: language on the fence, path inside.
  const files = parseGeneratedFiles(
    [
      "```ts",
      "src/lib/slugify.ts",
      "export function slugify(input: string): string {",
      "  return input.toLowerCase();",
      "}",
      "```",
      "",
      "```ts",
      "src/lib/slugify.test.ts",
      'import { slugify } from "./slugify";',
      "```",
    ].join("\n"),
  );

  assert.deepEqual(
    files.map((file) => file.path),
    ["src/lib/slugify.ts", "src/lib/slugify.test.ts"],
  );
  // The path line names the file; it is not part of it.
  assert.equal(
    files[0].content,
    'export function slugify(input: string): string {\n  return input.toLowerCase();\n}',
  );
  assert.equal(files[1].content, 'import { slugify } from "./slugify";');
});

test("a path restated inside a block that already named itself is not duplicated", () => {
  const files = parseGeneratedFiles("```ts src/lib/a.ts\nsrc/lib/a.ts\nexport const a = 1;\n```");
  assert.equal(files[0].path, "src/lib/a.ts");
  assert.equal(files[0].content, "export const a = 1;");
});

test("code on the first line is never mistaken for a path", () => {
  const cases = [
    ['import { a } from "./a";', 'import { a } from "./a";'],
    ["const x = 1.5;", "const x = 1.5;"],
    [".card { color: red }", ".card { color: red }"],
    ["print(obj.attr)", "print(obj.attr)"],
    ["example.com", ""], // bare hostname: path-shaped, so it does name the file
  ];
  for (const [first, expectedContent] of cases) {
    const files = parseGeneratedFiles(`\`\`\`\n${first}\nrest\n\`\`\``);
    assert.equal(files.length, 1, first);
    if (expectedContent) {
      assert.match(files[0].path, /^generated-1\./, `should stay unnamed: ${first}`);
      assert.equal(files[0].content, `${first}\nrest`);
    }
  }
});
