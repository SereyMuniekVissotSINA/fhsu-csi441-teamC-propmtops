import assert from "node:assert/strict";
import test from "node:test";

import { maskKey, stripTrailingSlash } from "./config";
import { changeCount, changeLetter, table, truncate } from "./format";
import { matchKey, matchPrompt, parseRange, parseRef, parseVariables } from "./resolve";
import { absorb, cookieHeader, hasSessionCookie, type Jar } from "./session";

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
