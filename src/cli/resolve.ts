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

/**
 * Naming a key to revoke. A key's plaintext is unrecoverable, so the only
 * handles a person has are the displayable `prefix` the dashboard and `pops
 * keys` print, its name, and its id.
 *
 * `pops_a1b2c3` is accepted with or without the `pops_` on the front, because
 * the listing shows it both ways depending on how wide the terminal is, and
 * because typing a secret's prefix and having it rejected is maddening.
 */
export type NamedKey = { id: string; name: string; prefix: string; revokedAt: string | null };

export function matchKey<T extends NamedKey>(keys: T[], needle: string): Match<T> {
  const term = needle.trim();
  if (!term) return { kind: "none" };

  const exactId = keys.find((key) => key.id === term);
  if (exactId) return { kind: "one", value: exactId };

  const bare = term.replace(/^pops_/, "").toLowerCase();
  const byPrefix = keys.filter((key) => key.prefix.replace(/^pops_/, "").toLowerCase() === bare);
  if (byPrefix.length === 1) return { kind: "one", value: byPrefix[0] };
  if (byPrefix.length > 1) return { kind: "many", candidates: byPrefix };

  // Names are not unique, and revoking the wrong credential is not something
  // to guess at, so two keys called "laptop" are reported as ambiguous.
  const byName = keys.filter((key) => key.name.toLowerCase() === term.toLowerCase());
  if (byName.length === 1) return { kind: "one", value: byName[0] };
  if (byName.length > 1) return { kind: "many", candidates: byName };

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

/** The letters the ref forms use: a prompt version, a code commit, an agent run. */
export type Letter = "v" | "c" | "r";

/**
 * `v2`, `2`, a commit's `c3`, or an agent run's `r7` — the numbers the history,
 * log and run views print, rather than ids nobody can remember.
 */
export function parseRef(ref: string, letter: Letter): number | null {
  const match = new RegExp(`^${letter}?(\\d+)$`, "i").exec(ref.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** `v1..v3`, the way git spells a range. */
export function parseRange(range: string, letter: Letter): [number, number] | null {
  const parts = range.split("..");
  if (parts.length !== 2) return null;
  const from = parseRef(parts[0], letter);
  const to = parseRef(parts[1], letter);
  return from !== null && to !== null ? [from, to] : null;
}
