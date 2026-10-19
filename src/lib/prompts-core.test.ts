import assert from "node:assert/strict";
import test from "node:test";

import { composePrompt, samplePrompts, variableNames } from "./prompts-core";

test("preview replaces repeated variables literally and retains unfilled placeholders", () => {
  const body = "Hello {{ name }} / {{name}} / {{missing}}";
  assert.deepEqual(variableNames(body), ["name", "missing"]);
  // `$&` is a replacement pattern in String.replace: a value containing it must
  // still be inserted verbatim rather than expanding to the match.
  assert.equal(
    composePrompt(body, { name: "$& <script>" }),
    "Hello $& <script> / $& <script> / {{missing}}",
  );
});

test("an empty value leaves the placeholder standing", () => {
  // A half-filled preview should show what it is still waiting for, not a gap.
  assert.equal(composePrompt("Hi {{name}}", { name: "" }), "Hi {{name}}");
});

test("variable names ignore malformed placeholders", () => {
  assert.deepEqual(variableNames("{{ok}} {{1bad}} {{ with-dash }} {{}}"), ["ok"]);
});

test("sample prompts are seedable: every prompt has history in chronological order", () => {
  assert.ok(samplePrompts.length > 0);

  const ids = new Set<string>();
  for (const prompt of samplePrompts) {
    assert.ok(prompt.versions.length > 0, `${prompt.id} has no versions`);
    assert.ok(!ids.has(prompt.id), `duplicate prompt id ${prompt.id}`);
    ids.add(prompt.id);

    // `prisma/seed.ts` treats the first version as the oldest when it sets the
    // prompt's createdAt, so the fixture has to already be in order.
    const times = prompt.versions.map((version) => Date.parse(version.createdAt));
    assert.ok(
      times.every((time) => Number.isFinite(time)),
      `${prompt.id} has an unparseable createdAt`,
    );
    assert.deepEqual(times, [...times].sort((a, b) => a - b), `${prompt.id} is out of order`);
  }
});
