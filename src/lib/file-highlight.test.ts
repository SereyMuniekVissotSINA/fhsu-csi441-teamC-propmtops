import { test } from "node:test";
import assert from "node:assert/strict";
import { filePreviewLanguage } from "./file-preview-language";
import { highlightFile } from "./file-highlight";
import { FILE_ACCEPT } from "./file-policy";

test("preview detects code languages and uses extracted text for documents", () => {
  assert.equal(filePreviewLanguage("INDEX.HTML", "text"), "html");
  assert.equal(filePreviewLanguage("component.tsx", "text"), "tsx");
  assert.equal(filePreviewLanguage("config.yml", "text"), "yaml");
  assert.equal(filePreviewLanguage("totals.xlsx", "xlsx"), "json");
  for (const name of ["notes.txt", "table.csv", "output.log", "unknown", "constructor"]) {
    assert.equal(filePreviewLanguage(name, "text"), "text");
  }
  assert.equal(filePreviewLanguage("report.pdf", "pdf"), "text");
  assert.equal(filePreviewLanguage("report.docx", "docx"), "text");
});

test("syntax colors preserve source, indentation, blank lines, and trailing newline", async () => {
  const source = '// comment\nconst message = "Hello";\n\n\tconsole.log(message);\n';
  const lines = await highlightFile(source, "javascript");
  assert.equal(lines.map(line => line.map(token => token.content).join("")).join("\n"), source);
  assert.ok(new Set(lines.flat().map(token => token.color)).size >= 3);
});

test("HTML is tokenized as source, including scripts and event handlers", async () => {
  const source = '<script>alert("test")</script>\n<img src=x onerror="alert(1)">';
  const lines = await highlightFile(source, "html");
  assert.equal(lines.map(line => line.map(token => token.content).join("")).join("\n"), source);
  assert.ok(lines.flat().some(token => token.color));
});

test("every supported upload language loads successfully and plain text is preserved", async () => {
  const languages = new Set(FILE_ACCEPT.split(",").map(ext => filePreviewLanguage(`file${ext}`, "text")));
  for (const language of languages) {
    const lines = await highlightFile("example", language);
    assert.equal(lines.flat().map(token => token.content).join(""), "example", language);
  }
});
