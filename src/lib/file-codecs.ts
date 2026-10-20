import { z } from "zod";
import { unzipSync, zipSync } from "fflate";
import { FileInputError, fileKind, MAX_FILE_BYTES, MAX_FILE_TEXT, validateUploadSelection } from "./file-policy";

export type FileKind = ReturnType<typeof fileKind>;
export const FILE_MIME: Record<FileKind, string> = {
  text: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const workbookSchema = z.object({
  sheets: z.array(z.object({
    name: z.string().min(1).max(31).regex(/^[^\\/*?:\[\]]+$/),
    rows: z.array(z.array(z.union([z.string().max(MAX_FILE_TEXT), z.number().finite(), z.boolean(), z.null()])).max(100)).max(1000),
  }).strict()).min(1).max(10),
}).strict().refine(value => new Set(value.sheets.map(s => s.name.toLowerCase())).size === value.sheets.length, "Sheet names must be unique.");

export function validateFileText(text: string): string {
  if (!text.trim()) throw new FileInputError("No readable text found. Scanned PDFs need OCR before upload.");
  if (text.length > MAX_FILE_TEXT) throw new FileInputError("File exceeds 24,000 extracted characters. Split it into smaller files.");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new FileInputError("This file contains binary or unsupported control characters.");
  return text;
}

function validateOfficeArchive(bytes: Buffer, kind: "docx" | "xlsx") {
  let total = 0;
  let entries = 0;
  let found = false;
  // Inspect central-directory sizes before any Office parser decompresses data.
  unzipSync(bytes, { filter: entry => {
    total += entry.originalSize;
    entries++;
    if (total > 10 * 1024 * 1024 || entries > 1000) throw new FileInputError("Document expands beyond the 10 MB/1,000-entry processing limit.");
    if (entry.name === (kind === "docx" ? "word/document.xml" : "xl/workbook.xml")) found = true;
    if (/vbaProject|embeddings\//i.test(entry.name)) throw new FileInputError("Documents with macros or embedded files are not supported.");
    return false;
  } });
  if (!found) throw new FileInputError("The file contents do not match its document extension.");
  // fflate inflates into buffers bounded by the checked directory sizes.
  // Repackage that bounded result so downstream parsers never independently
  // expand a malicious stream with forged uncompressed-size metadata.
  return Buffer.from(zipSync(unzipSync(bytes), { level: 0 }));
}

export async function extractFileText(bytes: Buffer, kind: FileKind): Promise<string> {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new FileInputError("Files must contain data and be 2 MB or less.");
  try {
    let text: string;
    if (kind === "text") {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } else if (kind === "pdf") {
      if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new FileInputError("This is not a valid PDF file.");
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false });
      try {
        const info = await parser.getInfo();
        if (info.total > 50) throw new FileInputError("PDFs may contain at most 50 pages.");
        const result = await parser.getText();
        text = result.pages.map(page => page.text).join("\n\n");
      } finally {
        await parser.destroy();
      }
    } else {
      const document = validateOfficeArchive(bytes, kind);
      if (kind === "docx") {
        const { extractRawText } = await import("mammoth");
        text = (await extractRawText({ buffer: document })).value;
      } else {
        const { default: ExcelJS } = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(new Uint8Array(document).buffer);
        if (workbook.worksheets.length > 10) throw new FileInputError("Excel files may contain at most 10 sheets.");
        const sheets = workbook.worksheets.map(sheet => {
          if (sheet.rowCount > 1000 || sheet.columnCount > 100) throw new FileInputError("Excel sheets are limited to 1,000 rows and 100 columns.");
          const rows: (string | number | boolean | null)[][] = [];
          for (let r = 1; r <= sheet.rowCount; r++) {
            const row: (string | number | boolean | null)[] = [];
            for (let c = 1; c <= sheet.columnCount; c++) {
              const cell = sheet.getCell(r, c);
              row.push(cell.value == null ? null : typeof cell.value === "number" || typeof cell.value === "boolean" ? cell.value : cell.text);
            }
            rows.push(row);
          }
          return { name: sheet.name, rows };
        });
        text = JSON.stringify(workbookSchema.parse({ sheets }));
      }
    }
    return validateFileText(text);
  } catch (error) {
    if (error instanceof FileInputError) throw error;
    throw new FileInputError("Could not read this file. Use valid UTF-8 text or an unencrypted PDF, .docx, or .xlsx document.");
  }
}

export async function encodeFileText(text: string, kind: FileKind): Promise<Buffer> {
  validateFileText(text);
  let bytes: Buffer;
  if (kind === "text") {
    bytes = Buffer.from(text, "utf-8");
  } else if (kind === "docx") {
    const { Document, Packer, Paragraph, TextRun } = await import("docx");
    bytes = await Packer.toBuffer(new Document({ sections: [{ children: text.split("\n").map(line => new Paragraph({ children: [new TextRun(line)] })) }] }));
  } else if (kind === "pdf") {
    const { default: pdfmake } = await import("pdfmake");
    const { default: fonts } = await import("pdfmake/fonts/Roboto.js");
    pdfmake.addFonts(fonts);
    const fontPaths = new Set(Object.values(fonts).flatMap(font => Object.values(font)));
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy(path => fontPaths.has(path));
    bytes = await pdfmake.createPdf({ content: text.split("\n").map(line => ({ text: line || " " })), defaultStyle: { font: "Roboto", fontSize: 11 } }).getBuffer();
  } else {
    let data: z.infer<typeof workbookSchema>;
    try {
      data = workbookSchema.parse(JSON.parse(text));
    } catch {
      throw new FileInputError("The AI returned invalid Excel sheet data. No new version was saved; try again with a more specific instruction.");
    }
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    for (const sheet of data.sheets) {
      // Strings are assigned as literal values, never interpreted as formulas,
      // hyperlinks, rich text, executable code, or external data connections.
      workbook.addWorksheet(sheet.name).addRows(sheet.rows);
    }
    bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  }
  if (bytes.length > MAX_FILE_BYTES) throw new FileInputError("The revised document exceeds 2 MB. No new version was saved.");
  return bytes;
}

export async function prepareUploads(form: FormData, authorId: string) {
  const entries = form.getAll("files");
  if (entries.some(entry => typeof entry === "string")) throw new FileInputError("Invalid file upload.");
  const files = (entries as File[]).filter(file => file.name !== "");
  const error = validateUploadSelection(files);
  if (error) throw new FileInputError(error);
  const prepared = [];
  for (const file of files) {
    const kind = fileKind(file.name);
    const content = Buffer.from(await file.arrayBuffer());
    const text = await extractFileText(content, kind);
    prepared.push({ name: file.name, kind, versions: { create: {
      version: 1, content, text, mimeType: FILE_MIME[kind], size: content.length,
      authorId, summary: "Original upload",
    } } });
  }
  return prepared;
}
