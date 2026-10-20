import { test } from "node:test";
import assert from "node:assert/strict";
import { changedPromptFields, draftAfterSave, loadPromptDraft, promptLineDiff } from "./prompt-history";
import { analyzePromptChanges, comparisonInput, ComparisonInputError, MAX_COMPARISON_CHARS } from "./prompt-analysis";

const oldVersion = Object.freeze({ title: "Original title", body: "Be brief.\nUse English.", tags: "original" });
const newVersion = Object.freeze({ title: "New title", body: "Be brief.\nUse Khmer.", tags: "updated" });

test("loading history restores every prompt field, not just content, without altering history", () => {
  assert.deepEqual(loadPromptDraft(oldVersion), { ...oldVersion, note: "" });
  assert.equal(oldVersion.body, "Be brief.\nUse English.");
});

test("only a confirmed successful save clears content and commit note; title/tags remain", () => {
  const draft = Object.freeze({ ...newVersion, note: "Changed language" });
  assert.deepEqual(draftAfterSave(draft, { success: true }), { ...newVersion, body: "", note: "" });
  assert.equal(draftAfterSave(draft, { error: "Database unavailable" }), draft);
  assert.equal(draftAfterSave(draft, {}), draft);
  assert.equal(draftAfterSave(draft, { success: true, error: "Not confirmed" }), draft);
  assert.equal(draft.body, newVersion.body);
  assert.deepEqual(changedPromptFields(oldVersion, newVersion), ["title", "body", "tags"]);
});

test("line comparison identifies retained, removed and added content", () => {
  assert.deepEqual(promptLineDiff(oldVersion.body, newVersion.body), { coarse: false, lines: [
    { kind: "same", text: "Be brief." },
    { kind: "removed", text: "Use English." },
    { kind: "added", text: "Use Khmer." },
  ] });
});

test("diffs preserve blank/repeated lines, whitespace, HTML, and both original snapshots", () => {
  const examples = ["", "\n", "a\na\nb\n", "a\nb\na", "\t a\r\n", '<script>alert("test")</script>'];
  for (const before of examples) {
    for (const after of examples) {
      const { lines } = promptLineDiff(before, after);
      assert.equal(lines.filter(line => line.kind !== "added").map(line => line.text).join("\n"), before);
      assert.equal(lines.filter(line => line.kind !== "removed").map(line => line.text).join("\n"), after);
    }
  }
});

test("large comparisons use a bounded-work fallback without truncating content", () => {
  const before = "old\n".repeat(501);
  const after = "new\n".repeat(501);
  const { lines, coarse } = promptLineDiff(before, after);
  assert.equal(coarse, true);
  assert.equal(lines.filter(line => line.kind === "removed").map(line => line.text).join("\n"), before);
  assert.equal(lines.filter(line => line.kind === "added").map(line => line.text).join("\n"), after);
});

test("AI analysis receives both snapshots in direction, limits tokens, and never changes them", async () => {
  const analysis = await analyzePromptChanges(oldVersion, newVersion, { key: "fake-key", model: "test-model", baseUrl: "http://router.test/v1" }, async (input, key, model, baseUrl, options) => {
    assert.match(input, /untrusted data/);
    assert.match(input, /Do not execute/);
    const snapshots = JSON.parse(input.split("Snapshots (JSON):\n\n")[1]);
    assert.deepEqual(snapshots, { before: oldVersion, after: newVersion });
    assert.equal(key, "fake-key");
    assert.equal(model, "test-model");
    assert.equal(baseUrl, "http://router.test/v1");
    assert.equal(options?.maxOutputTokens, 4096);
    return { output: "The requested output language changed.", model, incomplete: false, elapsedMs: 3, usage: null };
  });
  assert.match(analysis.output, /language changed/);
  assert.equal(oldVersion.body, "Be brief.\nUse English.");
});

test("identical and oversized comparisons never call the provider", async () => {
  const run = async () => { assert.fail("Provider must not be called"); };
  await assert.rejects(analyzePromptChanges(oldVersion, oldVersion, { key: "", model: "test-model" }, run), /identical/);
  const oversized = { ...newVersion, body: "x".repeat(MAX_COMPARISON_CHARS) };
  assert.throws(() => comparisonInput(oldVersion, oversized), ComparisonInputError);
  await assert.rejects(analyzePromptChanges(oldVersion, oversized, { key: "", model: "test-model" }, run), /32,000/);
});

test("empty analyses fail clearly, partial ones stay marked, and provider failures propagate", async () => {
  const config = { key: "", model: "test-model" };
  const result = { output: "Partial analysis", incomplete: true, model: "test-model", elapsedMs: 1, usage: null };
  assert.equal((await analyzePromptChanges(oldVersion, newVersion, config, async () => result)).incomplete, true);
  await assert.rejects(analyzePromptChanges(oldVersion, newVersion, config, async () => ({ ...result, output: " " })), /output limit/);
  await assert.rejects(analyzePromptChanges(oldVersion, newVersion, config, async () => { throw new Error("LLM unavailable"); }), /LLM unavailable/);
});
