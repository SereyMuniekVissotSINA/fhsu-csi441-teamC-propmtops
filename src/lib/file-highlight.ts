import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { PreviewLanguage } from "./file-preview-language";

// Only load the selected grammar, not every language or theme in Shiki.
const loaders = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
} satisfies Record<Exclude<PreviewLanguage, "text">, unknown>;

let highlighter: ReturnType<typeof createHighlighterCore> | undefined;

export async function highlightFile(text: string, language: PreviewLanguage) {
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/dark-plus.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).catch(error => {
    highlighter = undefined;
    throw error;
  });
  const instance = await highlighter;
  if (language !== "text" && !instance.getLoadedLanguages().includes(language)) {
    await instance.loadLanguage(await loaders[language]());
  }
  // Return tokens, never HTML. React escapes all uploaded content when rendered.
  return instance.codeToTokens(text, { lang: language, theme: "dark-plus" }).tokens;
}
