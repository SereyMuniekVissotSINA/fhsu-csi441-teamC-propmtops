import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { encodeFileText, extractFileText, prepareUploads } from "./file-codecs";
import { FileInputError, fileKind, MAX_FILE_BYTES, MAX_FILE_TEXT, validateUploadSelection } from "./file-policy";
import { generateFileRevision } from "./file-revisions";
import type { runOpenAI } from "./openai-run";

const result = (output: string, incomplete = false) => ({ output, incomplete, model: "test-model", elapsedMs: 10, usage: null });

test("uploads preserve exact original bytes, including UTF-8 BOM and line endings", async () => {
  const bytes = Buffer.from("\uFEFFconst n = 1;\r\n");
  const form = new FormData();
  form.append("files", new File([bytes], "example.ts"));
  const [prepared] = await prepareUploads(form, "editor-id");
  assert.deepEqual(prepared.versions.create.content, bytes);
  assert.equal(prepared.versions.create.version, 1);
  assert.equal(prepared.versions.create.authorId, "editor-id");
  assert.equal(prepared.versions.create.text, "const n = 1;\r\n");
});

test("rejects traversal, unsupported files, oversized uploads, binary text and excessive extracted text", async () => {
  for (const name of ["../secret.txt", "x\\bad.py", "bad\nname.txt", "program.exe", "macro.xlsm"]) assert.throws(() => fileKind(name), FileInputError);
  assert.ok(validateUploadSelection([{ name: "x.pdf", size: MAX_FILE_BYTES + 1 }]));
  assert.ok(validateUploadSelection(Array.from({ length: 4 }, () => ({ name: "x.txt", size: 1 }))));
  assert.ok(validateUploadSelection([{ name: "x.txt", size: 0 }]));
  await assert.rejects(extractFileText(Buffer.from([0, 255, 0]), "text"), FileInputError);
  await assert.rejects(extractFileText(Buffer.from("a".repeat(MAX_FILE_TEXT + 1)), "text"), /24,000/);
  await assert.rejects(extractFileText(Buffer.from("not a PDF"), "pdf"), /valid PDF/);
});

test("Office archive expansion is checked before parsing", async () => {
  const bytes = Buffer.from(zipSync({ "word/document.xml": strToU8("x".repeat(10 * 1024 * 1024 + 1)) }));
  await assert.rejects(extractFileText(bytes, "docx"), /processing limit/);
  const macro = Buffer.from(zipSync({ "word/document.xml": strToU8("hello"), "word/vbaProject.bin": strToU8("macro") }));
  await assert.rejects(extractFileText(macro, "docx"), /macros/);
});

test("Word and PDF revisions are valid files with extractable revised text", async () => {
  for (const kind of ["docx", "pdf"] as const) {
    const bytes = await encodeFileText("Corrected report\nThe total is 42.", kind);
    assert.ok(bytes.length > 100);
    const text = await extractFileText(bytes, kind);
    assert.match(text, /Corrected report/);
    assert.match(text, /The total is 42/);
  }
});

test("Excel round trips sheets, rows and literal cells without evaluating formulas", async () => {
  const workbook = { sheets: [
    { name: "Totals", rows: [["Label", "Amount"], ["Revenue", 42], ["=HYPERLINK(\"https://example.test\")", true]] },
    { name: "Notes", rows: [["keep me"]] },
  ] };
  const bytes = await encodeFileText(JSON.stringify(workbook), "xlsx");
  assert.deepEqual(JSON.parse(await extractFileText(bytes, "xlsx")), workbook);
  await assert.rejects(encodeFileText('{"sheets":[{"name":"Sheet1","rows":[[{"formula":"WEBSERVICE(x)"}]]}]}', "xlsx"), /invalid Excel/);
  await assert.rejects(encodeFileText('{"sheets":[]}', "xlsx"), /invalid Excel/);
});

test("AI receives selected source contents and instruction, returns a new file without mutating source", async () => {
  const source = Object.freeze({ name: "bug.py", kind: "text" as const, text: "print(1 / 0)\n" });
  const run: typeof runOpenAI = async (input, key, model, baseUrl, options) => {
    assert.match(input, /Fix division by zero/);
    assert.match(input, /print\(1 \/ 0\)/);
    assert.match(input, /untrusted data/);
    assert.equal(options?.maxOutputTokens, 16384);
    assert.equal(key, "fake-key");
    assert.equal(model, "test-model");
    assert.equal(baseUrl, "http://router.test/v1");
    return result(JSON.stringify({ summary: "Avoided division by zero.", content: "print(1 / 1)\n" }));
  };
  const revision = await generateFileRevision("Fix division by zero", source, { key: "fake-key", model: "test-model", baseUrl: "http://router.test/v1" }, run);
  assert.equal(source.text, "print(1 / 0)\n");
  assert.equal(revision.content.toString(), "print(1 / 1)\n");
  assert.equal(revision.summary, "Avoided division by zero.");
});

test("failed, truncated, malformed and empty AI results never produce a file revision", async () => {
  const source = { name: "original.txt", kind: "text" as const, text: "Original unchanged" };
  const config = { key: "fake-key", model: "test-model" };
  for (const response of [result('{"summary":"Partial","content":"truncated"}', true), result("I cannot do that"), result('{"summary":"OK","content":""}'), result('{"summary":"OK","content":"   "}')]) {
    await assert.rejects(generateFileRevision("Fix it", source, config, async () => response), FileInputError);
    assert.equal(source.text, "Original unchanged");
  }
  await assert.rejects(generateFileRevision("Fix it", source, config, async () => { throw new Error("LLM unavailable"); }), /LLM unavailable/);
});
