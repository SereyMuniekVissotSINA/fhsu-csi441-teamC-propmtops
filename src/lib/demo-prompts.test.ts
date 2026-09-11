import assert from "node:assert/strict";
import test from "node:test";
import {
  appendVersion,
  composePrompt,
  demoSamples,
  variableNames,
} from "./demo-prompts";
import { demoWorkspaceStorageKey, readDemo, writeDemo } from "./demo-storage";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

test("editing and restoring append snapshots without modifying history", () => {
  const original = structuredClone(demoSamples[0]);
  const before = structuredClone(original);
  const edited = appendVersion(original, {
    ...original.versions[0],
    body: "Changed content",
  });
  const restored = appendVersion(
    edited,
    original.versions[0],
    "Restored from v1",
  );
  assert.deepEqual(original, before);
  assert.equal(restored.versions.length, 3);
  assert.equal(restored.versions[1].body, "Changed content");
  assert.equal(restored.versions[2].body, original.versions[0].body);
  assert.notEqual(restored.versions[2].id, original.versions[0].id);
});

test("local storage round-trips history and preserves an intentionally empty library", () => {
  const local = storage();
  const snapshot = writeDemo(local, demoSamples, null);
  assert.deepEqual(readDemo(local).prompts, demoSamples);
  writeDemo(local, [], snapshot);
  assert.deepEqual(readDemo(local).prompts, []);
});

test("malformed storage is rejected without overwriting it", () => {
  for (const raw of [
    "not JSON",
    '{"schemaVersion":1,"prompts":[{"id":"broken","versions":[]}]}',
  ]) {
    const local = storage(raw);
    assert.throws(() => readDemo(local), /could not be read/);
    assert.equal(local.getItem(), raw);
  }
});

test("stale tabs cannot overwrite another tab's save", () => {
  const local = storage();
  writeDemo(local, demoSamples, null);
  assert.throws(() => writeDemo(local, [], null), /another tab/);
  assert.deepEqual(readDemo(local).prompts, demoSamples);
});

test("failed writes surface an actionable error and retain stored prompts", () => {
  const local = storage();
  const snapshot = writeDemo(local, demoSamples, null);
  const full = {
    ...local,
    setItem: () => {
      throw new Error("Quota exceeded");
    },
  };
  assert.throws(() => writeDemo(full, [], snapshot), /could not save/);
  assert.deepEqual(readDemo(local).prompts, demoSamples);
});

test("preview replaces repeated variables literally and retains unfilled placeholders", () => {
  const body = "Hello {{ name }} / {{name}} / {{missing}}";
  assert.deepEqual(variableNames(body), ["name", "missing"]);
  assert.equal(
    composePrompt(body, { name: "$& <script>" }),
    "Hello $& <script> / $& <script> / {{missing}}",
  );
});

test("workspace libraries remain isolated and the original library is preserved", () => {
  const data = new Map<string, string>();
  const local = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  writeDemo(local, demoSamples, null);
  const other = writeDemo(local, [], null, "other-team");
  assert.equal(demoWorkspaceStorageKey("personal"), "promptops.demo.v1");
  assert.deepEqual(readDemo(local, "personal").prompts, demoSamples);
  assert.deepEqual(readDemo(local, "other-team").prompts, []);
  writeDemo(local, [demoSamples[1]], other, "other-team");
  assert.deepEqual(readDemo(local).prompts, demoSamples);
  assert.equal(readDemo(local, "other-team").prompts?.length, 1);
});

test("a restored snapshot records its new author without rewriting the original author", () => {
  const original = appendVersion(
    demoSamples[0],
    demoSamples[0].versions[0],
    "Saved by owner",
    "Alex Owner",
  );
  const restored = appendVersion(
    original,
    original.versions.at(-1)!,
    "Restored from v2",
    "Sam Editor",
  );
  assert.equal(original.versions.at(-1)?.author, "Alex Owner");
  assert.equal(restored.versions.at(-1)?.author, "Sam Editor");
  assert.equal(restored.versions.at(-2)?.author, "Alex Owner");
});
