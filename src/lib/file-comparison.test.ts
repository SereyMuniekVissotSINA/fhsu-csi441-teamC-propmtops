import { test } from "node:test";
import assert from "node:assert/strict";
import { fileComparisonText, fileComparisonVersions } from "./file-comparison";
import { analyzeFileChanges, MAX_FILE_COMPARISON_CHARS } from "./file-analysis";
import type { PromptFileInfo } from "./file-policy";
import { promptLineDiff } from "./prompt-history";

const file: PromptFileInfo = { id: "file-a", name: "example.ts", kind: "text", versions: [3, 1, 2].map(version => ({
  id: `v${version}`, version, sourceVersionId: null, size: 20, summary: "", model: null, createdAt: "2026-10-19T00:00:00Z",
})) };
const before = Object.freeze({ version: 1, text: "const total = 1;\n" });
const after = Object.freeze({ version: 3, text: "const total = 2;\n" });
const config = { key: "test-key", model: "configured-model", baseUrl: "http://router.test/v1" };

test("file pairs are ordered by version number, independent of list/selection order", () => {
  for (const pair of [{ firstId: "v3", secondId: "v1" }, { firstId: "v1", secondId: "v3" }]) {
    const result = fileComparisonVersions(file, { fileId: file.id, ...pair });
    assert.equal(result?.before.version, 1);
    assert.equal(result?.after.version, 3);
  }
  assert.deepEqual(file.versions.map(v => v.version), [3, 1, 2]);
});

test("UI selection rejects cross-file, missing, and identical version pairs", () => {
  for (const pair of [
    { fileId: "other", firstId: "v1", secondId: "v3" },
    { fileId: file.id, firstId: "v1", secondId: "other-version" },
    { fileId: file.id, firstId: "v1", secondId: "v1" },
  ]) assert.equal(fileComparisonVersions(file, pair), null);
});

test("code/document comparisons preserve whitespace and markup; workbook cells get readable diffs", () => {
  const text = '<script>test()</script>\r\n\t x\n';
  for (const kind of ["text", "pdf", "docx"]) assert.equal(fileComparisonText(text, kind), text);
  const oldBook = JSON.stringify({ sheets: [{ name: "Budget", rows: [["cost", 10]] }] });
  const newBook = JSON.stringify({ sheets: [{ name: "Budget", rows: [["cost", 12]] }] });
  const formatted = fileComparisonText(oldBook, "xlsx");
  assert.deepEqual(JSON.parse(formatted), JSON.parse(oldBook));
  const diff = promptLineDiff(formatted, fileComparisonText(newBook, "xlsx"));
  assert.deepEqual(diff.lines.filter(l => l.kind !== "same").map(l => [l.kind, l.text.trim()]), [["removed", "10"], ["added", "12"]]);
  assert.equal(fileComparisonText("invalid workbook", "xlsx"), "invalid workbook");
});

test("AI receives only explicit saved file fields with unchanged configuration and bounded output", async () => {
  const result = await analyzeFileChanges(file, before, after, config, async (input, key, model, baseUrl, options) => {
    assert.match(input, /untrusted data/);
    assert.match(input, /Do not execute code/);
    assert.match(input, /not formulas/);
    assert.deepEqual(JSON.parse(input.split("Snapshots (JSON):\n\n")[1]), {
      file: { name: file.name, kind: file.kind }, before, after,
    });
    assert.equal(key, config.key);
    assert.equal(model, config.model);
    assert.equal(baseUrl, config.baseUrl);
    assert.equal(options?.maxOutputTokens, 4096);
    return { output: "Changed total from 1 to 2.", model, incomplete: false, elapsedMs: 1, usage: null };
  });
  assert.match(result.output, /1 to 2/);
  assert.equal(before.text, "const total = 1;\n");
});

test("identical and oversized file contents do not call AI", async () => {
  const run = async () => { assert.fail("Provider must not be called"); };
  await assert.rejects(analyzeFileChanges(file, before, { ...before, version: 2 }, config, run), /identical/);
  await assert.rejects(analyzeFileChanges(file, before, { ...after, text: "x".repeat(MAX_FILE_COMPARISON_CHARS) }, config, run), /64,000/);
});

test("empty/partial analyses and provider failures are handled without changing file versions", async () => {
  const response = { output: "Partial", model: config.model, incomplete: true, elapsedMs: 1, usage: null };
  assert.equal((await analyzeFileChanges(file, before, after, config, async () => response)).incomplete, true);
  await assert.rejects(analyzeFileChanges(file, before, after, config, async () => ({ ...response, output: " " })), /output limit/);
  await assert.rejects(analyzeFileChanges(file, before, after, config, async () => ({ ...response, incomplete: false, output: "" })), /no analysis/);
  await assert.rejects(analyzeFileChanges(file, before, after, config, async () => { throw new Error("LLM unavailable"); }), /LLM unavailable/);
});
