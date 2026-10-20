import type { PromptFileInfo } from "./file-policy";

export type FileComparisonPair = { fileId: string; firstId: string; secondId: string };

export function fileComparisonVersions(file: PromptFileInfo, pair: FileComparisonPair) {
  if (file.id !== pair.fileId || pair.firstId === pair.secondId) return null;
  const first = file.versions.find(version => version.id === pair.firstId);
  const second = file.versions.find(version => version.id === pair.secondId);
  if (!first || !second) return null;
  return first.version < second.version ? { before: first, after: second } : { before: second, after: first };
}

// Pretty-print extracted workbook JSON so cell changes do not become one giant
// changed line. Text/code and extracted document text remain byte-for-byte intact.
export function fileComparisonText(text: string, kind: string) {
  if (kind !== "xlsx") return text;
  try { return JSON.stringify(JSON.parse(text), null, 2); }
  catch { return text; }
}
