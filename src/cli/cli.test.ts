import assert from "node:assert/strict";
import test from "node:test";

import { maskKey, stripTrailingSlash } from "./config";
import { box, changeCount, changeLetter, records, table, truncate } from "./format";
import { matchKey, matchPrompt, parseRange, parseRef, parseVariables } from "./resolve";
import { absorb, cookieHeader, hasSessionCookie, type Jar } from "./session";
import { tokenize } from "./shell";

const prompts = [
  { id: "cmv9v5hgw0005vnj597ysm0x9", title: "Slugify helper" },
  { id: "cmv9u99cw0000vnj54a1ioc0a", title: "Center a div" },
  { id: "abc123def456", title: "Support assistant" },
];

test("a prompt can be named by full id, long prefix, or title", () => {
  assert.equal(matchPrompt(prompts, "abc123def456").kind, "one");

  const byPrefix = matchPrompt(prompts, "cmv9v5");
  assert.equal(byPrefix.kind, "one");
  assert.equal(byPrefix.kind === "one" && byPrefix.value.title, "Slugify helper");

  const byTitle = matchPrompt(prompts, "center");
  assert.equal(byTitle.kind === "one" && byTitle.value.title, "Center a div");

  // Case-insensitive exact title wins over a substring search.
  assert.equal(matchPrompt(prompts, "SUPPORT ASSISTANT").kind, "one");
});

test("ambiguity is reported, never guessed", () => {
  // Both seeded ids share this prefix, and "cmv9" is too short to count anyway.
  const ambiguous = matchPrompt(prompts, "cmv9u99cw0000vnj54a1ioc0a".slice(0, 4));
  assert.equal(ambiguous.kind, "none");

  const many = matchPrompt(
    [
      { id: "aaa111222333", title: "Release notes" },
      { id: "bbb444555666", title: "Release checklist" },
    ],
    "release",
  );
  assert.equal(many.kind, "many");
  assert.equal(many.kind === "many" && many.candidates.length, 2);
});

test("an unmatched name is a miss, not a wrong prompt", () => {
  assert.equal(matchPrompt(prompts, "nothing like this").kind, "none");
  assert.equal(matchPrompt(prompts, "   ").kind, "none");
});

test("variables parse as name=value, and values may contain =", () => {
  assert.deepEqual(parseVariables(["name=Alex", "query=a=b"]), { name: "Alex", query: "a=b" });
  assert.deepEqual(parseVariables([]), {});
  assert.throws(() => parseVariables(["broken"]), /name=value/);
  assert.throws(() => parseVariables(["=novalue"]), /name=value/);
});

test("refs accept the numbering the UI prints", () => {
  assert.equal(parseRef("v2", "v"), 2);
  assert.equal(parseRef("2", "v"), 2);
  assert.equal(parseRef("c3", "c"), 3);
  assert.equal(parseRef("C3", "c"), 3);
  assert.equal(parseRef("v0", "v"), null);
  assert.equal(parseRef("latest", "v"), null);
});

test("ranges are git-shaped", () => {
  assert.deepEqual(parseRange("v1..v3", "v"), [1, 3]);
  assert.deepEqual(parseRange("1..2", "v"), [1, 2]);
  assert.equal(parseRange("v1", "v"), null);
  assert.equal(parseRange("v1..v2..v3", "v"), null);
  assert.equal(parseRange("..v2", "v"), null);
});

test("keys are masked wherever they are printed", () => {
  const key = "pops_abcdefghijklmnopqrstuvwxyz";
  const masked = maskKey(key);
  assert.ok(!masked.includes("klmnopqrst"), "the secret middle must not be shown");
  assert.ok(masked.startsWith("pops_abcde"));
  assert.equal(maskKey("pops_short"), "pops_s…");
});

test("urls are normalised so paths concatenate cleanly", () => {
  assert.equal(stripTrailingSlash("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(stripTrailingSlash("http://localhost:3000///"), "http://localhost:3000");
  assert.equal(stripTrailingSlash("http://localhost:3000"), "http://localhost:3000");
});

test("tables line up columns and leave the last one ragged", () => {
  const rendered = table([
    ["ID", "TITLE"],
    ["abc", "A longer title"],
    ["abcdefgh", "Short"],
  ]);
  const [header, first] = rendered.split("\n");
  assert.equal(header, "ID        TITLE");
  assert.equal(first, "abc       A longer title");
});

test("change counts omit a side that did not move", () => {
  // NO_COLOR is honoured in tests, so these compare as plain text.
  assert.equal(changeCount(0, 0), "");
  assert.match(changeCount(3, 0), /\+3/);
  assert.doesNotMatch(changeCount(3, 0), /−/);
  assert.match(changeCount(0, 2), /−2/);
  assert.deepEqual(
    [changeLetter.ADDED, changeLetter.MODIFIED, changeLetter.REMOVED, changeLetter.UNCHANGED],
    ["A", "M", "D", "·"],
  );
});

test("long titles are shortened with an ellipsis, short ones left alone", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("a".repeat(20), 10), `${"a".repeat(9)}…`);
  assert.equal(truncate("wraps\n  across   lines", 40), "wraps across lines");
});

const keys = [
  { id: "key_one", name: "laptop", prefix: "pops_a1b2c3", revokedAt: null },
  { id: "key_two", name: "ci", prefix: "pops_d4e5f6", revokedAt: null },
  { id: "key_three", name: "laptop", prefix: "pops_g7h8i9", revokedAt: "2026-10-01T00:00:00.000Z" },
];

test("a key can be named by id, prefix, or name, with or without pops_", () => {
  assert.equal(matchKey(keys, "key_two").kind, "one");

  const byPrefix = matchKey(keys, "pops_a1b2c3");
  assert.equal(byPrefix.kind === "one" && byPrefix.value.name, "laptop");

  // The listing abbreviates, so the bare prefix has to work too.
  const bare = matchKey(keys, "d4e5f6");
  assert.equal(bare.kind === "one" && bare.value.id, "key_two");

  assert.equal(matchKey(keys, "ci").kind, "one");
  // Two keys are called "laptop": revoking one of them is not a guess to make.
  assert.equal(matchKey(keys, "laptop").kind, "many");
  assert.equal(matchKey(keys, "nothing").kind, "none");
  assert.equal(matchKey(keys, "  ").kind, "none");
});

test("the cookie jar keeps values, drops attributes, and honours clearing", () => {
  const jar: Jar = new Map();
  absorb(jar, [
    "authjs.csrf-token=abc%7Cdef; Path=/; HttpOnly; SameSite=Lax",
    "authjs.callback-url=http%3A%2F%2Flocalhost%3A3000; Path=/",
  ]);
  assert.equal(hasSessionCookie(jar), false);

  absorb(jar, ["authjs.session-token=jwt.one.two; Path=/; HttpOnly"]);
  assert.equal(hasSessionCookie(jar), true);
  assert.equal(cookieHeader(jar).includes("authjs.session-token=jwt.one.two"), true);
  assert.equal(cookieHeader(jar).includes("HttpOnly"), false);

  // Auth.js clears a cookie by setting it empty; that must not read as a session.
  absorb(jar, ["authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
  assert.equal(hasSessionCookie(jar), false);
});

test("a chunked or secure session cookie still counts as a session", () => {
  const chunked: Jar = absorb(new Map(), ["__Secure-authjs.session-token.0=head"]);
  assert.equal(hasSessionCookie(chunked), true);
});

// --- the shell --------------------------------------------------------------

test("a result set is rendered the way a database client renders one", () => {
  const rendered = box(
    [{ name: "Slug" }, { name: "Name" }, { name: "Prompts", align: "right" }],
    [
      ["csi441", "Team C", "12"],
      ["scratch", "Scratch pad", "3"],
    ],
    "Workspaces",
  ).split("\n");

  // Centred headers, a `+`-jointed rule, and the row count underneath.
  assert.equal(rendered[1], "  Slug   |    Name     | Prompts");
  assert.equal(rendered[2], "---------+-------------+---------");
  assert.equal(rendered[3], " csi441  | Team C      |      12");
  assert.equal(rendered.at(-1), "(2 rows)");
  assert.ok(rendered[0].includes("Workspaces"));
});

test("an empty result set still says so", () => {
  const rendered = box([{ name: "Slug" }], []);
  assert.equal(rendered.split("\n").at(-1), "(0 rows)");
  assert.equal(records([{ name: "Slug" }], []), "(0 rows)");
});

test("expanded output puts one field per line, and indents a wrapped value", () => {
  const rendered = records(
    [{ name: "Field" }, { name: "Value" }],
    [["note", "first line\nsecond line"]],
  ).split("\n");

  assert.match(rendered[0], /^-\[ RECORD 1 \]-+$/);
  assert.equal(rendered[1], "Field | note");
  assert.equal(rendered[2], "Value | first line");
  // The continuation lines up under the value, as psql does, rather than
  // starting at the left margin where it would read as another field.
  assert.equal(rendered[3], "      | second line");
});

test("a typed line splits like a shell, and quotes group words", () => {
  assert.deepEqual(tokenize("\\dp").tokens, ["\\dp"]);
  assert.deepEqual(tokenize("  show   slugify  ").tokens, ["show", "slugify"]);
  assert.deepEqual(tokenize('show "Center a div"').tokens, ["show", "Center a div"]);
  assert.deepEqual(tokenize("run x -v name=Alex").tokens, ["run", "x", "-v", "name=Alex"]);
  // An empty argument is a real argument: `--tags ""` clears the tags.
  assert.deepEqual(tokenize('edit x --tags ""').tokens, ["edit", "x", "--tags", ""]);
  // Double quotes take escapes; single quotes keep the backslash, so a Windows
  // path survives being pasted in.
  assert.deepEqual(tokenize('new --title "a \\"quoted\\" one"').tokens, [
    "new",
    "--title",
    'a "quoted" one',
  ]);
  assert.deepEqual(tokenize("push --root 'C:\\work'").tokens, ["push", "--root", "C:\\work"]);
});

test("an unclosed quote is reported, so the shell can keep reading", () => {
  const open = tokenize('new --body "first paragraph');
  assert.equal(open.open, true);

  // What the shell does next: join the lines and try again. The newline stays
  // inside the quoted argument, which is how a multi-line body gets typed.
  const closed = tokenize('new --body "first paragraph\nsecond paragraph"');
  assert.equal(closed.open, false);
  assert.deepEqual(closed.tokens, ["new", "--body", "first paragraph\nsecond paragraph"]);
  assert.deepEqual(tokenize("").tokens, []);
});
