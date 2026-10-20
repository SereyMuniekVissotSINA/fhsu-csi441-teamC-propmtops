const languages = {
  js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
  py: "python", java: "java", c: "c", h: "c", cpp: "cpp", cs: "csharp",
  go: "go", rs: "rust", rb: "ruby", php: "php", html: "html",
  css: "css", scss: "scss", json: "json", sql: "sql", md: "markdown",
  yaml: "yaml", yml: "yaml", xml: "xml", sh: "shellscript",
  toml: "toml", ini: "ini",
} as const;

export type PreviewLanguage = (typeof languages)[keyof typeof languages] | "text";

export function filePreviewLanguage(name: string, kind: string): PreviewLanguage {
  // Excel previews contain the app's extracted sheet/cell JSON, not XLSX bytes.
  if (kind === "xlsx") return "json";
  if (kind !== "text") return "text";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(languages, extension) ? languages[extension as keyof typeof languages] : "text";
}
