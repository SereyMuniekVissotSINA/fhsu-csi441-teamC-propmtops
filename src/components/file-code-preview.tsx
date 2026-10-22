"use client";

import { useEffect, useState } from "react";
import type { ThemedToken } from "shiki/types";
import { filePreviewLanguage } from "@/lib/file-preview-language";

export function FileCodePreview({ text, name, kind }: { text: string; name: string; kind: string }) {
  const language = filePreviewLanguage(name, kind);
  const [wrap, setWrap] = useState(false);
  const [highlighted, setHighlighted] = useState<{
    text: string; language: string; tokens: ThemedToken[][] | null;
  } | null>(null);

  useEffect(() => {
    if (language === "text") return;
    let cancelled = false;
    import("@/lib/file-highlight")
      .then(({ highlightFile }) => highlightFile(text, language))
      .then(tokens => {
        if (!cancelled) setHighlighted({ text, language, tokens });
      })
      .catch(() => {
        if (!cancelled) setHighlighted({ text, language, tokens: null });
      });
    return () => { cancelled = true; };
  }, [text, language]);

  const current = highlighted?.text === text && highlighted.language === language ? highlighted : null;
  const lines = current?.tokens ?? text.split(/\r\n|\r|\n/).map(line => [{ content: line }]);

  return <div className="mt-3 min-w-0 overflow-hidden rounded-lg border border-zinc-700 bg-[#1e1e1e] text-[#d4d4d4]">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-700 bg-[#252526] px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate font-mono" title={name}>{name}</span>
      <span className="text-zinc-400">{language === "text" ? "Plain text" : language} · Read-only</span>
      <button type="button" aria-pressed={wrap} onClick={() => setWrap(value => !value)}
        className="rounded px-2 py-1 text-zinc-300 hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-emerald-400">
        Wrap lines
      </button>
    </div>
    <pre tabIndex={0} aria-label={`${name} file content, read-only`}
      className="max-h-96 overflow-auto py-3 font-mono text-xs leading-5 focus-visible:outline-2 focus-visible:outline-emerald-400"
      style={{ tabSize: 4 }}>
      <code className={wrap ? "block" : "block min-w-max"}>
        {lines.map((line, index) => <span key={index} className="grid grid-cols-[3rem_minmax(0,1fr)]">
          <span aria-hidden="true" className="sticky left-0 select-none bg-[#1e1e1e] pr-3 text-right text-[#858585]">{index + 1}</span>
          <span className={wrap ? "min-w-0 whitespace-pre-wrap pr-3 [overflow-wrap:anywhere]" : "whitespace-pre pr-3"}>
            {line.map((token: Pick<ThemedToken, "content" | "color" | "fontStyle">, tokenIndex) => <span key={tokenIndex} style={{
              color: token.color,
              fontStyle: (token.fontStyle ?? 0) & 1 ? "italic" : undefined,
              fontWeight: (token.fontStyle ?? 0) & 2 ? "bold" : undefined,
              textDecoration: (token.fontStyle ?? 0) & 4 ? "underline" : undefined,
            }}>{token.content}</span>)}
          </span>
        </span>)}
      </code>
    </pre>
    {language !== "text" ? <p role="status" className="border-t border-zinc-700 px-3 py-1 text-xs text-zinc-400">
      {!current ? "Loading syntax colors…" : current.tokens ? "Syntax highlighted" : "Syntax colors unavailable — showing plain text."}
    </p> : null}
  </div>;
}
