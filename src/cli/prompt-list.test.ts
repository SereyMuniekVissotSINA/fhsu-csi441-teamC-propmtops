import assert from "node:assert/strict";
import test from "node:test";

import { promptListQuerySchema } from "../lib/validations";
import { CliError, type Client } from "./client";
import { fetchAllPrompts } from "./prompt-list";
import { matchPrompt } from "./resolve";
import type { PromptSummary } from "./types";

function fixtures(count: number): PromptSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `prompt-${String(index).padStart(4, "0")}`,
    title: `Prompt ${index}`,
    updatedAt: "2026-11-11T00:00:00.000Z",
    workspace: { name: "Team", slug: "team" },
    versions: [],
    _count: { versions: 1 },
  }));
}

function pagedClient(prompts: PromptSummary[]) {
  const requests: URL[] = [];
  const client: Pick<Client, "request"> = {
    async request<T>(path: string): Promise<T> {
      const url = new URL(path, "http://localhost");
      requests.push(url);
      const offset = Number(url.searchParams.get("offset"));
      return prompts.slice(offset, offset + 50) as T;
    },
  };
  return { client, requests };
}

test("prompts beyond the first 50 resolve by full id, title and prefix", async () => {
  const records = fixtures(121);
  records[120] = { ...records[120], id: "older-unique-id", title: "Legacy assistant" };
  const { client, requests } = pagedClient(records);
  const prompts = await fetchAllPrompts(client, "workspace & one");
  assert.deepEqual(prompts, records);
  assert.deepEqual(requests.map((url) => url.searchParams.get("offset")), ["0", "50", "100"]);
  assert.ok(requests.every((url) => url.searchParams.get("workspaceId") === "workspace & one"));
  for (const query of ["older-unique-id", "Legacy assistant", "older-unique", "legacy"]) {
    assert.deepEqual(matchPrompt(prompts, query), { kind: "one", value: records[120] });
  }
});

test("matching sees ambiguous titles and prefixes across page boundaries", async () => {
  const records = fixtures(51);
  records[0] = { ...records[0], id: "shared-prefix-first", title: "Release notes" };
  records[50] = { ...records[50], id: "shared-prefix-last", title: "Release notes" };
  const { client } = pagedClient(records);
  const prompts = await fetchAllPrompts(client);
  for (const query of ["Release notes", "release", "shared-prefix"]) {
    assert.deepEqual(matchPrompt(prompts, query), {
      kind: "many", candidates: [records[0], records[50]],
    });
  }
});

test("an exact page boundary requests the final empty page", async () => {
  const records = fixtures(100);
  const { client, requests } = pagedClient(records);
  assert.deepEqual(await fetchAllPrompts(client), records);
  assert.deepEqual(requests.map((url) => url.searchParams.get("offset")), ["0", "50", "100"]);
  assert.ok(requests.every((url) => !url.searchParams.has("workspaceId")));
});

test("an empty workspace finishes after one request", async () => {
  const { client, requests } = pagedClient([]);
  assert.deepEqual(await fetchAllPrompts(client), []);
  assert.equal(requests.length, 1);
});

test("a later-page failure rejects instead of returning an incomplete list", async () => {
  const failure = new CliError("Workspace is unavailable", 404);
  let calls = 0;
  const client: Pick<Client, "request"> = {
    async request<T>(): Promise<T> {
      if (++calls === 2) throw failure;
      return fixtures(50) as T;
    },
  };
  await assert.rejects(fetchAllPrompts(client), (error) => error === failure);
  assert.equal(calls, 2);
});

test("servers ignoring offset fail clearly instead of looping or resolving partial results", async () => {
  let calls = 0;
  const client: Pick<Client, "request"> = {
    async request<T>(): Promise<T> {
      calls++;
      return fixtures(50) as T;
    },
  };
  await assert.rejects(fetchAllPrompts(client), /pagination did not advance/);
  assert.equal(calls, 2);
});

test("offset defaults to zero and accepts bounded nonnegative integers only", () => {
  assert.deepEqual(promptListQuerySchema.parse({}), { offset: 0 });
  for (const offset of ["0", "50", "2147483647"]) {
    assert.deepEqual(promptListQuerySchema.parse({ offset }), { offset: Number(offset) });
  }
  for (const offset of ["", "-1", "1.5", "NaN", "Infinity", "1e2", " 50 ", "2147483648", "999999999999999999999", null]) {
    assert.equal(promptListQuerySchema.safeParse({ offset }).success, false, String(offset));
  }
});
