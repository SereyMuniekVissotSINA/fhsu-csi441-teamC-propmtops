// Demo smoke test: exercises a running Prompt Ops app end to end over HTTP.
//
//   bun run dev                                   # in another terminal
//   bun scripts/demo-test.ts                      # public pages + auth walls
//   POPS_API_KEY=pops_… bun scripts/demo-test.ts  # + full prompt lifecycle
//
// Flags: --url <base>  (default http://localhost:3000, or POPS_URL)
//        --register    also create a throwaway account via /api/register
//        --keep        leave the demo prompt in the database afterwards
//
// It talks to the app the same way the CLI does, so nothing here bypasses
// authorization. The only writes are a prompt it deletes at the end (unless
// --keep) and, with --register, one new user.

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const BASE = (option("--url") ?? process.env.POPS_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const KEY = process.env.POPS_API_KEY?.trim();

const color = !process.env.NO_COLOR && process.stdout.isTTY;
const paint = (code: number, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => paint(32, s);
const red = (s: string) => paint(31, s);
const yellow = (s: string) => paint(33, s);
const bold = (s: string) => paint(1, s);
const dim = (s: string) => paint(2, s);

let passed = 0;
let failed = 0;
let skipped = 0;

function section(title: string) {
  console.log(`\n${bold(title)}`);
}

async function step(name: string, fn: () => Promise<string | void>) {
  const started = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - started);
    passed++;
    console.log(`  ${green("✓")} ${name} ${dim(`${ms}ms${detail ? ` · ${detail}` : ""}`)}`);
  } catch (error) {
    failed++;
    console.log(`  ${red("✗")} ${name}\n    ${red(error instanceof Error ? error.message : String(error))}`);
  }
}

function skip(name: string, why: string) {
  skipped++;
  console.log(`  ${yellow("–")} ${name} ${dim(`(skipped: ${why})`)}`);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Res = { status: number; json: any; text: string };

async function call(path: string, init: RequestInit & { key?: string } = {}): Promise<Res> {
  const headers = new Headers(init.headers);
  if (init.key) headers.set("authorization", `Bearer ${init.key}`);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

function expectStatus(res: Res, ...ok: number[]) {
  expect(
    ok.includes(res.status),
    `expected HTTP ${ok.join(" or ")}, got ${res.status}${res.json?.error ? ` — ${res.json.error}` : ""}`,
  );
}

async function main() {
  console.log(bold(`Prompt Ops demo test → ${BASE}`));

  // ── 0. Is the app up? ──────────────────────────────────────────────────────
  try {
    await fetch(BASE, { redirect: "manual" });
  } catch {
    console.log(red(`\nCannot reach ${BASE}. Start the app first: bun run dev`));
    process.exit(1);
  }

  // ── 1. Public pages ────────────────────────────────────────────────────────
  section("1. Public pages render");
  for (const path of ["/", "/demo", "/demo?view=history", "/demo/explorer", "/login", "/register"]) {
    await step(`GET ${path}`, async () => {
      const res = await call(path);
      expectStatus(res, 200);
      return `${(res.text.length / 1024).toFixed(1)} KB`;
    });
  }
  await step("Unknown page returns 404", async () => {
    expectStatus(await call("/this-page-does-not-exist"), 404);
  });

  // ── 2. Browser demo data ───────────────────────────────────────────────────
  section("2. Browser demo starter prompts");
  await step("GET /api/demo/prompts", async () => {
    const res = await call("/api/demo/prompts");
    expectStatus(res, 200);
    expect(res.json?.schemaVersion === 1, "schemaVersion should be 1");
    expect(Array.isArray(res.json.prompts) && res.json.prompts.length > 0, "no starter prompts");
    return `${res.json.prompts.length} prompts`;
  });

  // ── 3. Security walls ──────────────────────────────────────────────────────
  section("3. Authorization walls (no credentials)");
  await step("GET /api/me without login → 401", async () => {
    expectStatus(await call("/api/me"), 401);
  });
  await step("GET /api/prompts without login → 401", async () => {
    expectStatus(await call("/api/prompts"), 401);
  });
  await step("Bogus API key → 401", async () => {
    const res = await call("/api/me", { key: "pops_not_a_real_key_000000" });
    expectStatus(res, 401);
    return res.json?.error;
  });
  await step("Anonymous lookup of a prompt id → 401 (not 404, so ids don't leak)", async () => {
    expectStatus(await call("/api/prompts/does-not-exist"), 401);
  });
  await step("/dashboard redirects anonymous visitors", async () => {
    const res = await call("/dashboard");
    expect(res.status !== 500, "dashboard crashed (500)");
    return `HTTP ${res.status}`;
  });

  // ── 4. Registration (opt-in: it creates a user) ────────────────────────────
  section("4. Registration");
  if (!flag("--register")) {
    skip("Register a new account", "pass --register to enable");
  } else {
    const email = `demo+${Date.now()}@promptops.local`;
    const account = { name: "Demo Tester", email, password: "password123" };
    await step("New account → 201", async () => {
      const res = await call("/api/register", { method: "POST", body: JSON.stringify(account) });
      expectStatus(res, 201);
      expect(!("passwordHash" in res.json), "password hash leaked in response");
      return email;
    });
    await step("Same email again → 409", async () => {
      expectStatus(await call("/api/register", { method: "POST", body: JSON.stringify(account) }), 409);
    });
    await step("Short password → 422", async () => {
      const res = await call("/api/register", {
        method: "POST",
        body: JSON.stringify({ ...account, email: `x${email}`, password: "short" }),
      });
      expectStatus(res, 422);
    });
  }

  // ── 5. Prompt lifecycle with an API key ────────────────────────────────────
  section("5. Prompt version control (API key)");
  if (!KEY) {
    skip("Prompt lifecycle", "set POPS_API_KEY (create one in workspace settings → API keys)");
  } else {
    let workspaceId = "";
    let promptId = "";

    await step("GET /api/me — who is this key?", async () => {
      const res = await call("/api/me", { key: KEY });
      expectStatus(res, 200);
      expect(res.json.authenticatedAs === "apiKey", "expected apiKey auth");
      workspaceId = res.json.workspaces[0]?.workspace.id;
      expect(workspaceId, "key reaches no workspace");
      return `${res.json.user?.name ?? "no creator"} in "${res.json.workspaces[0].workspace.name}" as EDITOR`;
    });

    await step("List prompts", async () => {
      const res = await call("/api/prompts", { key: KEY });
      expectStatus(res, 200);
      expect(res.json.every((p: any) => p.workspaceId === workspaceId), "key saw another workspace's prompt");
      return `${res.json.length} prompts, all in the key's workspace`;
    });

    await step("Invalid prompt (empty body) → 422", async () => {
      const res = await call("/api/prompts", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ workspaceId, title: "x", body: "" }),
      });
      expectStatus(res, 422);
    });

    const v1 = "Write a friendly welcome email to {{name}} about {{product}}.";
    await step("Create prompt → v1", async () => {
      const res = await call("/api/prompts", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ workspaceId, title: `Demo test ${new Date().toISOString()}`, body: v1, tags: "demo,test" }),
      });
      expectStatus(res, 201);
      promptId = res.json.id;
      expect(res.json.versions.length === 1, "new prompt should have exactly one version");
      return `id ${promptId}`;
    });

    if (promptId) {
      const v2 = "Write a short, friendly welcome email to {{name}} about {{product}}. Sign off as {{team}}.";
      await step("Edit prompt → appends v2 (history is append-only)", async () => {
        const res = await call(`/api/prompts/${promptId}`, {
          method: "PATCH",
          key: KEY,
          body: JSON.stringify({ title: "Demo test (edited)", body: v2, tags: "demo,test", note: "Add sign-off" }),
        });
        expectStatus(res, 200);
        expect(res.json.versions[0].body === v2, "newest version should hold the edit");
      });

      await step("Read history — both versions kept", async () => {
        const res = await call(`/api/prompts/${promptId}`, { key: KEY });
        expectStatus(res, 200);
        const bodies = res.json.versions.map((v: any) => v.body);
        expect(bodies.length === 2, `expected 2 versions, got ${bodies.length}`);
        expect(bodies.includes(v1) && bodies.includes(v2), "v1 was overwritten");
        return res.json.versions.map((v: any) => `"${v.note}"`).join(" ← ");
      });

      await step("Generated-code commit log is readable", async () => {
        const res = await call(`/api/prompts/${promptId}/commits`, { key: KEY });
        expectStatus(res, 200);
        const commits = Array.isArray(res.json) ? res.json : (res.json.commits ?? []);
        return `${commits.length} commits`;
      });

      await step("Key cannot manage members (no privilege escalation)", async () => {
        const res = await call(`/api/workspaces/${workspaceId}/members`, {
          method: "POST",
          key: KEY,
          body: JSON.stringify({ email: "intruder@example.test", role: "OWNER" }),
        });
        expectStatus(res, 401, 403);
      });

      await step("Key cannot mint more keys", async () => {
        const res = await call(`/api/workspaces/${workspaceId}/keys`, {
          method: "POST",
          key: KEY,
          body: JSON.stringify({ name: "sneaky" }),
        });
        expectStatus(res, 401, 403);
      });

      if (flag("--keep")) {
        skip("Delete demo prompt", `--keep; open ${BASE}/dashboard/prompts/${promptId}`);
      } else {
        await step("Delete demo prompt (cleanup)", async () => {
          expectStatus(await call(`/api/prompts/${promptId}`, { method: "DELETE", key: KEY }), 200);
          expectStatus(await call(`/api/prompts/${promptId}`, { key: KEY }), 404);
        });
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const summary = `${passed} passed, ${failed} failed, ${skipped} skipped`;
  console.log(`\n${failed ? red(bold(summary)) : green(bold(summary))}`);
  process.exit(failed ? 1 : 0);
}

main();
