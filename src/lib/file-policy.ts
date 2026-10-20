// Shared upload limits and serializable metadata; no document parsers in clients.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_TEXT = 24_000;
export const MAX_UPLOAD_FILES = 3;
export const FILE_ACCEPT = ".txt,.md,.csv,.tsv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.html,.css,.scss,.sql,.yaml,.yml,.xml,.sh,.toml,.ini,.log,.pdf,.docx,.xlsx";
export const FILE_HELP = "Code/text, PDF, Word (.docx), or Excel (.xlsx). Up to 3 files, 2 MB combined and 24,000 extracted characters per file. Text-based PDFs only; scanned PDFs need OCR first. Document revisions rebuild text/cell content; layouts, images, and charts may change.";
export type FileVersionInfo = {
  id: string;
  version: number;
  sourceVersionId: string | null;
  size: number;
  summary: string;
  model: string | null;
  createdAt: string;
};
export type PromptFileInfo = {
  id: string;
  name: string;
  kind: string;
  versions: FileVersionInfo[];
};

export class FileInputError extends Error {}

export function fileKind(name: string): "text" | "pdf" | "docx" | "xlsx" {
  if (!name || name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(name)) {
    throw new FileInputError("Use a file name without folders or control characters (180 characters maximum).");
  }
  const extension = `.${name.split(".").pop()?.toLowerCase()}`;
  if (!FILE_ACCEPT.split(",").includes(extension)) {
    throw new FileInputError("Unsupported file type. Choose a code/text, PDF, .docx, or .xlsx file.");
  }
  return extension === ".pdf" ? "pdf" : extension === ".docx" ? "docx" : extension === ".xlsx" ? "xlsx" : "text";
}

export function validateUploadSelection(files: Pick<File, "name" | "size">[]): string | null {
  if (files.length > MAX_UPLOAD_FILES) return "Upload at most 3 files at a time.";
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_BYTES) return "Files must total 2 MB or less.";
  try {
    for (const file of files) {
      fileKind(file.name);
      if (file.size === 0) return "Empty files cannot be revised.";
    }
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid file.";
  }
  return null;
}
