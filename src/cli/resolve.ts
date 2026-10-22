// Turning what a user typed into one record.
//
// Typing a full cuid is miserable, so a prompt can be named by id, by a
// distinctive id prefix, or by part of its title — the way git lets you
// abbreviate a commit. Ambiguity is reported rather than guessed at, because
// silently picking one of two prompts is how the wrong one gets edited.

export type Named = { id: string; title: string };

export type Match<T> =
  | { kind: "one"; value: T }
  | { kind: "none" }
  | { kind: "many"; candidates: T[] };

export function matchPrompt<T extends Named>(prompts: T[], needle: string): Match<T> {
  const term = needle.trim();
  if (!term) return { kind: "none" };

  const exactId = prompts.find((prompt) => prompt.id === term);
  if (exactId) return { kind: "one", value: exactId };

  const exactTitle = prompts.filter((prompt) => prompt.title.toLowerCase() === term.toLowerCase());
  if (exactTitle.length === 1) return { kind: "one", value: exactTitle[0] };
  if (exactTitle.length > 1) return { kind: "many", candidates: exactTitle };

  // An id prefix has to be long enough to mean something: four characters of a
  // cuid is not an identifier, it is a coincidence waiting to happen.
  const byPrefix = term.length >= 6 ? prompts.filter((p) => p.id.startsWith(term)) : [];
  if (byPrefix.length === 1) return { kind: "one", value: byPrefix[0] };
  if (byPrefix.length > 1) return { kind: "many", candidates: byPrefix };

  const byTitle = prompts.filter((prompt) =>
    prompt.title.toLowerCase().includes(term.toLowerCase()),
  );
  if (byTitle.length === 1) return { kind: "one", value: byTitle[0] };
  if (byTitle.length > 1) return { kind: "many", candidates: byTitle };

  return { kind: "none" };
}

/** `-v name=value`, repeated. A value may contain `=`; the first one splits. */
export function parseVariables(pairs: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new Error(`Variables look like name=value; got "${pair}".`);
    values[pair.slice(0, at).trim()] = pair.slice(at + 1);
  }
  return values;
}

/**
 * `v2`, `2`, or a commit's `c3` — the numbers the history and log views print,
 * rather than ids nobody can remember.
 */
export function parseRef(ref: string, letter: "v" | "c"): number | null {
  const match = new RegExp(`^${letter}?(\\d+)$`, "i").exec(ref.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** `v1..v3`, the way git spells a range. */
export function parseRange(range: string, letter: "v" | "c"): [number, number] | null {
  const parts = range.split("..");
  if (parts.length !== 2) return null;
  const from = parseRef(parts[0], letter);
  const to = parseRef(parts[1], letter);
  return from !== null && to !== null ? [from, to] : null;
}
