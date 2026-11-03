// Making an outside-supplied file path safe to store, display, and write.
//
// Two callers need the same rule and neither can import the other's module: the
// commit parser (`code-commits.ts`, which needs node:crypto) and the agent-run
// classifier (`agent-runs.ts`, which the commit-log and run UIs import in the
// browser). So the rule lives here, imports nothing, and is re-exported from
// `code-commits.ts` for the callers that already had it from there.

/**
 * Make a supplied path safe: relative, no traversal, no absolute roots.
 * Returns null when nothing usable is left.
 *
 * Generated code is only ever displayed, but an agent run is *restored* — the
 * before-contents are written back to disk — so a path that escapes the project
 * root has to be rejected here rather than trusted one layer down.
 */
export function normalizePath(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^[`'"<(\[{*]+|[`'">)\]},:*]+$/g, "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

  if (!cleaned || cleaned.length > 200) return null;

  const segments = cleaned.split("/").filter((segment) => segment && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return null;
  if (segments.some((segment) => /[\0\n\r]/.test(segment))) return null;

  return segments.join("/");
}

// Syntax label by extension, used to tag a file for display. Shared for the
// same reason as the rule above: the commit parser and the run classifier
// both label files, and only one of them may touch node builtins.
const languageByExtension: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  json: "json", prisma: "prisma", sql: "sql", css: "css", scss: "scss",
  html: "html", md: "md", mdx: "mdx", py: "python", rb: "ruby", go: "go",
  rs: "rust", java: "java", kt: "kotlin", swift: "swift", php: "php",
  c: "c", h: "c", cpp: "cpp", cs: "csharp", sh: "bash", bash: "bash",
  yml: "yaml", yaml: "yaml", toml: "toml", env: "dotenv", txt: "text",
};

/** Syntax label for a path's extension, or "" when it is not one we know. */
export function languageForPath(path: string): string {
  const extension = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  return languageByExtension[extension] ?? "";
}
