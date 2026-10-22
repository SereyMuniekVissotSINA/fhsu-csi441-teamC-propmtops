// Line diffing, shared by the API route and the commit log UI.
//
// Lives apart from `code-commits.ts` so a client component can import it:
// hashing a file needs node:crypto, diffing one does not.


/** Longest-common-subsequence table, guarded so a huge pair stays cheap. */
function commonLines(before: string[], after: string[]): number[][] | null {
  if (before.length + after.length > 1200) return null;

  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

export type DiffLine = { kind: " " | "+" | "-"; text: string };

/** Line-level diff of two file revisions, in order. */
export function diffLines(before: string, after: string): DiffLine[] {
  if (before === after) {
    return splitLines(after).map((text) => ({ kind: " " as const, text }));
  }

  const a = before ? splitLines(before) : [];
  const b = after ? splitLines(after) : [];
  const table = commonLines(a, b);

  // Too large to align: report it as a wholesale replacement rather than
  // spending seconds on a table nobody will read.
  if (!table) {
    return [
      ...a.map((text) => ({ kind: "-" as const, text })),
      ...b.map((text) => ({ kind: "+" as const, text })),
    ];
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: "-", text: a[i++] });
    } else {
      out.push({ kind: "+", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "-", text: a[i++] });
  while (j < b.length) out.push({ kind: "+", text: b[j++] });
  return out;
}

export function splitLines(value: string): string[] {
  const lines = value.split("\n");
  // A trailing newline is a line terminator, not an empty final line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** `+n / -n` counts for one file, the way git summarizes a commit. */
export function lineStats(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffLines(before, after)) {
    if (line.kind === "+") added++;
    if (line.kind === "-") removed++;
  }
  return { added, removed };
}

/**
 * Collapse a diff to changed lines plus `context` lines around them, so the UI
 * can show what moved without reprinting a 300-line file.
 */
export function diffHunks(
  before: string,
  after: string,
  context = 3,
): { lines: DiffLine[]; skippedBefore: number }[] {
  const diff = diffLines(before, after);
  const interesting = diff.map((line) => line.kind !== " ");
  const keep = diff.map((_, index) =>
    interesting.slice(Math.max(0, index - context), index + context + 1).some(Boolean),
  );

  const hunks: { lines: DiffLine[]; skippedBefore: number }[] = [];
  let skipped = 0;
  for (let index = 0; index < diff.length; index++) {
    if (!keep[index]) {
      skipped++;
      continue;
    }
    if (index === 0 || !keep[index - 1]) {
      hunks.push({ lines: [], skippedBefore: skipped });
      skipped = 0;
    }
    hunks[hunks.length - 1].lines.push(diff[index]);
  }
  return hunks;
}
