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

// --- result sets ------------------------------------------------------------
//
// The interactive shell prints result sets the way a database client does,
// because that is what it is: a terminal pointed at records someone wants to
// read a column at a time. `table` above stays as it is — the one-shot
// commands are a transcript, and boxing their output would be noise — while
// these two are the shell's aligned and expanded displays, the pair `\x`
// switches between.

export type Column = {
  name: string;
  /** Counts and sequence numbers read better flush right, as in psql. */
  align?: "left" | "right";
};

/**
 * The aligned display: centered headers, a `+`-jointed rule, a space either
 * side of every `|`, and the row count underneath.
 *
 * Trailing spaces are trimmed where psql keeps them — they are invisible, and
 * leaving them in makes a copied transcript ragged.
 */
export function box(columns: Column[], rows: string[][], title?: string): string {
  return aligned(columns, rows, title, true);
}

/**
 * One record read as a list of its fields: what `\d` prints about a prompt, and
 * what `\conninfo` prints about the connection.
 *
 * The same aligned display, without the row count — the lines are one thing's
 * fields, so counting them says nothing. psql's `\d` leaves it off for exactly
 * that reason.
 */
export function fields(rows: string[][], title?: string): string {
  return aligned([{ name: "Field" }, { name: "Value" }], rows, title, false);
}

function aligned(
  columns: Column[],
  rows: string[][],
  title: string | undefined,
  count: boolean,
): string {
  const widths = columns.map((column, index) =>
    Math.max(visibleLength(column.name), ...rows.map((row) => visibleLength(row[index] ?? ""))),
  );
  // Each cell is padded to its column and wrapped in one space, so the rule
  // under the header is two characters wider than the content.
  const span = widths.reduce((total, width) => total + width + 2, 0) + widths.length - 1;

  const lines: string[] = [];
  if (title) lines.push(centre(paint(title, "bold"), span).trimEnd());
  lines.push(
    columns.map((column, index) => ` ${centre(column.name, widths[index])} `).join("|").trimEnd(),
  );
  lines.push(widths.map((width) => "-".repeat(width + 2)).join("+"));
  for (const row of rows) {
    lines.push(
      columns
        .map((column, index) => {
          const cell = row[index] ?? "";
          return ` ${column.align === "right" ? padStart(cell, widths[index]) : pad(cell, widths[index])} `;
        })
        .join("|")
        .trimEnd(),
    );
  }
  if (count) {
    lines.push(paint(`(${rows.length} ${rows.length === 1 ? "row" : "rows"})`, "dim"));
  }
  return lines.join("\n");
}

/**
 * The expanded display: one record at a time, one field per line.
 *
 * This is what `\x` is for. A prompt carries more fields than a terminal is
 * wide — a body, a note, an author, a tag list — and reading them down the
 * page beats scrolling sideways through a truncated row.
 */
export function records(columns: Column[], rows: string[][]): string {
  if (rows.length === 0) return paint("(0 rows)", "dim");

  const label = Math.max(...columns.map((column) => visibleLength(column.name)));
  const value = Math.max(
    ...rows.flatMap((row) => row.map((cell) => visibleLength(firstLine(cell)))),
  );
  // Wide enough to sit over the values, and never so wide it wraps on its own.
  const rule = Math.min(label + value + 4, 72);

  const out: string[] = [];
  rows.forEach((row, index) => {
    const head = `-[ RECORD ${index + 1} ]`;
    out.push(paint(`${head}${"-".repeat(Math.max(3, rule - head.length))}`, "dim"));
    columns.forEach((column, position) => {
      const cell = row[position] ?? "";
      // A body or a note runs to several lines; psql indents the continuation
      // under the value column, which is what makes it readable at all.
      const [first, ...continued] = cell.split("\n");
      out.push(`${pad(column.name, label)} | ${first}`);
      for (const line of continued) out.push(`${" ".repeat(label)} | ${line}`);
    });
  });
  return out.join("\n");
}

function firstLine(text: string): string {
  const at = text.indexOf("\n");
  return at === -1 ? text : text.slice(0, at);
}

function padStart(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - visibleLength(text))) + text;
}

function centre(text: string, width: number): string {
  const slack = Math.max(0, width - visibleLength(text));
  const left = Math.floor(slack / 2);
  return `${" ".repeat(left)}${text}${" ".repeat(slack - left)}`;
}
