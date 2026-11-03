import { diffHunks } from "@/lib/code-diff";

// A unified diff of two revisions of one file, collapsed to the lines that
// changed plus a little context — the same hunks `pops status --diff` prints.
//
// A server component on purpose: `code-diff.ts` is browser-safe so this could
// run either side, but nothing here is interactive, and rendering it on the
// server keeps a large file's diff out of the client bundle.

export function FileDiff({ before, after }: { before: string; after: string }) {
  const hunks = diffHunks(before, after);

  if (hunks.length === 0) {
    return <p className="px-4 py-3 text-xs text-zinc-500">No line changes.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <pre className="min-w-full font-mono text-xs leading-relaxed">
        {hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex}>
            {hunk.skippedBefore > 0 ? (
              <div className="bg-zinc-900/60 px-4 py-1 text-zinc-500">
                … {hunk.skippedBefore} unchanged line
                {hunk.skippedBefore === 1 ? "" : "s"}
              </div>
            ) : null}
            {hunk.lines.map((line, lineIndex) => (
              <div
                key={lineIndex}
                className={
                  line.kind === "+"
                    ? "bg-emerald-950/40 px-4 text-emerald-300"
                    : line.kind === "-"
                      ? "bg-red-950/40 px-4 text-red-300"
                      : "px-4 text-zinc-500"
                }
              >
                <span aria-hidden="true" className="mr-2 select-none opacity-60">
                  {line.kind}
                </span>
                {line.text || " "}
              </div>
            ))}
          </div>
        ))}
      </pre>
    </div>
  );
}
