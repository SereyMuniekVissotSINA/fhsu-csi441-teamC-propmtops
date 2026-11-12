import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { saveConfig, updateConfig } from "./config";
import { createShell, executeShellCommand, type Dispatch } from "./shell";

const workspace = {
  id: "workspace-one", name: "Team", slug: "team", members: [], _count: { prompts: 0 },
};

function setup(t: TestContext, session?: string, overrides: { url?: string; key?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pops-shell-"));
  const names = ["XDG_CONFIG_HOME", "POPS_URL", "POPS_API_KEY"] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.XDG_CONFIG_HOME = root;
  delete process.env.POPS_URL;
  delete process.env.POPS_API_KEY;
  t.after(() => {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
    rmSync(root, { recursive: true, force: true });
  });
  saveConfig({ url: "http://old.test", key: "pops_test", session });
  const requests: { url: string; headers: Headers }[] = [];
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    requests.push({ url: input, headers: new Headers(init.headers) });
    if (url.pathname === "/api/me") {
      return Response.json({
        authenticatedAs: "key", user: null,
        workspaces: [{ role: "EDITOR", workspace }],
      });
    }
    if (url.pathname === "/api/workspaces") return Response.json([workspace]);
    if (url.pathname.endsWith("/keys")) return Response.json([]);
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const make = (dispatch: Dispatch) => {
    const shell = createShell({ dispatch, overrides, root, help: "" });
    shell.workspace = workspace;
    return shell;
  };
  return { make, requests };
}

for (const prior of [undefined, "authjs.session-token=expired"]) {
  test(`login refreshes the owner cookie with an unchanged key (${prior ? "expired" : "absent"} session)`, async (t) => {
    const { make, requests } = setup(t, prior);
    const shell = make(async () => {
      updateConfig({ session: "authjs.session-token=fresh" });
      return 0;
    });
    await executeShellCommand(shell, ["auth", "login", "--email", "owner@example.test"]);
    await executeShellCommand(shell, ["\\dk"]);
    const request = requests.find(({ url }) => url.endsWith("/keys"));
    assert.ok(request, "owner command should send a request without restarting the shell");
    assert.equal(request.headers.get("cookie"), "authjs.session-token=fresh");
    assert.equal(request.headers.get("authorization"), null);
  });
}

test("session logout removes the client's cached owner cookie", async (t) => {
  const { make, requests } = setup(t, "authjs.session-token=old");
  const shell = make(async () => { updateConfig({ session: undefined }); return 0; });
  await executeShellCommand(shell, ["auth", "logout"]);
  await assert.rejects(executeShellCommand(shell, ["\\dk"]), /Sign in first/);
  assert.equal(requests.some(({ url }) => url.endsWith("/keys")), false);
});

test("server changes take effect and explicit shell overrides remain authoritative", async (t) => {
  const { make, requests } = setup(t, undefined, { key: "pops_override" });
  const shell = make(async () => { updateConfig({ url: "http://new.test", key: "pops_new" }); return 0; });
  await executeShellCommand(shell, ["auth", "login"]);
  assert.equal(shell.client.url, "http://new.test");
  assert.ok(requests.length > 0);
  assert.ok(requests.every(({ url, headers }) =>
    url.startsWith("http://new.test/") && headers.get("authorization") === "Bearer pops_override"));
});

test("removing the key clears workspace state and prompt completion", async (t) => {
  const { make } = setup(t);
  const shell = make(async () => { updateConfig({ key: undefined }); return 0; });
  shell.role = "EDITOR";
  shell.workspaces = [workspace];
  shell.prompts = [{
    id: "old", title: "Old prompt", updatedAt: "", workspace, versions: [], _count: { versions: 0 },
  }];
  await executeShellCommand(shell, ["auth", "logout"]);
  assert.equal(shell.client.hasKey, false);
  assert.equal(shell.workspace, null);
  assert.equal(shell.role, null);
  assert.deepEqual(shell.workspaces, []);
  assert.deepEqual(shell.prompts, []);
});
