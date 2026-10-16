import { diffHunks } from "@/lib/code-diff";

// Rendering. Pure string work, kept apart from the commands so it can be tested
// without a server, and so colour decisions live in one place.

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

const codes = {
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  reset: "\u001b[0m",
} as const;

export function paint(text: string, color: keyof Omit<typeof codes, "reset">): string {
  return useColor ? `${codes[color]}${text}${codes.reset}` : text;
}

/** Fixed-width columns, sized to the content. Narrow terminals wrap; that's fine. */
export function table(rows: string[][]): string {
  if (rows.length === 0) return "";
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(...rows.map((row) => visibleLength(row[column] ?? ""))),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : pad(cell ?? "", widths[column])))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** Width as the terminal sees it: colour codes take up no space on screen. */
function visibleLength(text: string): number {
  return text.replace(/\u001b\[\d+m/g, "").length;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

/** `+12 −3`, omitting a side that did not change. */
export function changeCount(added: number, removed: number): string {
  const parts: string[] = [];
  if (added) parts.push(paint(`+${added}`, "green"));
  if (removed) parts.push(paint(`−${removed}`, "red"));
  return parts.join(" ");
}

export const changeLetter: Record<string, string> = {
  ADDED: "A",
  MODIFIED: "M",
  REMOVED: "D",
  UNCHANGED: "·",
};

export function paintChange(change: string): string {
  const letter = changeLetter[change] ?? "?";
  if (change === "ADDED") return paint(letter, "green");
  if (change === "MODIFIED") return paint(letter, "yellow");
  if (change === "REMOVED") return paint(letter, "red");
  return paint(letter, "dim");
}

/** A unified diff, showing the same hunks the web UI does. */
export function renderDiff(before: string, after: string, context = 3): string {
  const hunks = diffHunks(before, after, context);
  if (hunks.length === 0) return paint("  no line changes", "dim");

  const out: string[] = [];
  for (const hunk of hunks) {
    if (hunk.skippedBefore > 0) {
      const plural = hunk.skippedBefore === 1 ? "" : "s";
      out.push(paint(`  … ${hunk.skippedBefore} unchanged line${plural}`, "dim"));
    }
    for (const line of hunk.lines) {
      const text = `${line.kind}${line.text}`;
      out.push(
        line.kind === "+"
          ? paint(text, "green")
          : line.kind === "-"
            ? paint(text, "red")
            : paint(text, "dim"),
      );
    }
  }
  return out.join("\n");
}

/** Local date and time, trimmed to the minute — enough to order a log by eye. */
export function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function truncate(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}…`;
}
