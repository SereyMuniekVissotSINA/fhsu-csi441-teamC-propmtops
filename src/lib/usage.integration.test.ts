import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";
import { generateApiKey } from "./api-keys";
import { queryUsage, recordUsage } from "./usage-store";

// Opt-in: create ONLY a random test schema, migrate/seed it, and remove exactly
// that schema. Never reset, truncate, seed, or delete the application's tables.
test("PostgreSQL usage ingestion, concurrency, isolation, exact aggregates, and revocation", {
  skip: process.env.USAGE_DB_TESTS !== "1",
  timeout: 180_000,
}, async () => {
  const connectionString = process.env.USAGE_TEST_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  assert.ok(connectionString, "Configure a PostgreSQL URL for the isolated-schema test.");
  const schema = `promptops_usage_test_${randomBytes(8).toString("hex")}`;
  assert.match(schema, /^promptops_usage_test_[0-9a-f]{16}$/);
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
  // Transaction-pooling providers reject startup search_path options. Scope raw
  // SQL with SET LOCAL inside its transaction; Prisma model queries already use
  // the adapter's schema. No session settings leak into the application's pool.
  const db = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "$transaction") return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          return run(tx);
        }, { timeout: 30_000 });
      if (property === "$queryRaw") return (...args: Parameters<PrismaClient["$queryRaw"]>) =>
        target.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          return tx.$queryRaw(...args);
        });
      return Reflect.get(target, property, receiver);
    },
  });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (const name of ["20261010000000_postgresql_init", "20261015120000_api_key_creator", "20261016000000_prompt_files", "20261020000000_usage_analytics"]) {
      const sql = await readFile(`prisma/migrations/${name}/migration.sql`, "utf8");
      await db.$transaction(async tx => {
        for (const statement of sql.split(/;\s*(?:\r?\n|$)/).filter(s => s.trim())) {
          await tx.$executeRawUnsafe(statement);
        }
      });
    }
    await db.user.createMany({ data: [{ id: "alice", email: `${schema}-alice@test.invalid` }, { id: "bob", email: `${schema}-bob@test.invalid` }] });
    await db.workspace.createMany({ data: [{ id: "a", name: "A", slug: "a" }, { id: "b", name: "B", slug: "b" }] });
    await db.membership.createMany({ data: [
      { userId: "alice", workspaceId: "a", role: "VIEWER" }, { userId: "bob", workspaceId: "b", role: "OWNER" },
    ] });
    for (const workspaceId of ["a", "b"]) {
      await db.prompt.create({ data: { id: `p-${workspaceId}`, workspaceId, authorId: "alice", title: "Prompt",
        versions: { create: [1, 2, 3].map(n => ({ id: `${workspaceId}-v${n}`, title: "Prompt", body: `Version ${n}` })) } } });
    }
    const key = generateApiKey(), otherKey = generateApiKey();
    await db.apiKey.createMany({ data: [
      { id: "key-a", workspaceId: "a", name: "A", hashedKey: key.hashedKey, prefix: key.prefix },
      { id: "key-b", workspaceId: "b", name: "B", hashedKey: otherKey.hashedKey, prefix: otherKey.prefix },
    ] });
    const payload = {
      requestId: "r1", promptVersionId: "a-v2", inputTokens: 60, outputTokens: 40, tokenUnit: "tokens",
      latency: { value: 1.25, unit: "s" }, estimatedCost: { amount: "0.01", currency: "USD" },
      measuredAt: "2026-10-01T00:00:00Z", model: "test-model", workload: "same-fixtures-settings",
    };
    const first = await recordUsage(db, key.hashedKey, payload);
    assert.equal(first.duplicate, false);
    assert.equal(first.promptVersionId, "a-v2"); // Never substitute newest v3.
    const duplicate = await recordUsage(db, key.hashedKey, { ...payload, latency: { value: 1250, unit: "ms" }, estimatedCost: { amount: 0.01, currency: "USD" } });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.usageId, first.usageId);
    assert.equal(duplicate.acceptedAt, first.acceptedAt);
    await assert.rejects(recordUsage(db, key.hashedKey, { ...payload, model: "changed" }), { status: 409 });
    await assert.rejects(recordUsage(db, key.hashedKey, { ...payload, requestId: "foreign", promptVersionId: "b-v2" }), { status: 404 });
    await assert.rejects(recordUsage(db, "invalid-hash", payload), { status: 401 });
    await assert.rejects(recordUsage(db, key.hashedKey, { ...payload, requestId: "bad", inputTokens: -1 }), { status: 400 });
    assert.equal(await db.usageRecord.count(), 1);

    // Same client/request races cannot double-count, even on separate connections.
    const race = await Promise.all([1, 2].map(() => recordUsage(db, key.hashedKey, { ...payload, requestId: "race" })));
    assert.equal(race[0].usageId, race[1].usageId);
    assert.equal(race.filter(r => !r.duplicate).length, 1);
    const conflict = await Promise.allSettled([10, 20].map(inputTokens => recordUsage(db, key.hashedKey, { ...payload, requestId: "conflict", inputTokens })));
    assert.equal(conflict.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(conflict.filter(r => r.status === "rejected" && r.reason.status === 409).length, 1);
    // Keep concurrency rows out of fixture aggregates by using a dedicated group.
    await db.usageRecord.updateMany({ where: { requestId: { in: ["race", "conflict"] } }, data: { workload: "concurrency-fixture" } });

    await recordUsage(db, key.hashedKey, { ...payload, requestId: "r2", inputTokens: 120, outputTokens: 80,
      latency: { value: 2.75, unit: "s" }, estimatedCost: { amount: "0.02", currency: "USD" } });
    await recordUsage(db, key.hashedKey, { ...payload, requestId: "r3", promptVersionId: "a-v3", inputTokens: 80, outputTokens: 40,
      latency: { value: 1.5, unit: "s" }, estimatedCost: { amount: "0.012", currency: "USD" } });
    await recordUsage(db, key.hashedKey, { ...payload, requestId: "end-boundary", measuredAt: "2026-11-01T00:00:00Z" });
    await recordUsage(db, key.hashedKey, { ...payload, requestId: "eur", estimatedCost: { amount: "0.01", currency: "EUR" } });
    await recordUsage(db, otherKey.hashedKey, { ...payload, requestId: "other-workspace", promptVersionId: "b-v2" });
    const filters = { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z", workload: payload.workload, currency: "USD" as const };
    const rows = await queryUsage(db, "p-a", "alice", filters);
    assert.equal(rows.length, 2);
    const v2 = rows.find(row => row.promptVersionId === "a-v2")!;
    assert.equal(v2.requests, "2");
    assert.equal(v2.totalTokens, "300");
    assert.equal(Number(v2.meanLatencyMs), 2000);
    assert.equal(v2.estimatedCost, "0.03000000");
    const v3 = rows.find(row => row.promptVersionId === "a-v3")!;
    assert.equal(v3.requests, "1");
    assert.equal(v3.totalTokens, "120");
    assert.equal(Number(v3.meanLatencyMs), 1500);
    assert.equal(v3.estimatedCost, "0.01200000");
    const { currency: _currency, ...allCurrencies } = filters;
    void _currency;
    assert.equal((await queryUsage(db, "p-a", "alice", allCurrencies)).length, 3);
    assert.deepEqual(await queryUsage(db, "p-a", "bob", filters), []);
    assert.deepEqual(await queryUsage(db, "p-b", "alice", filters), []);
    assert.deepEqual(await queryUsage(db, "p-a", "alice", { ...filters, versionId: "b-v2" }), []);
    assert.deepEqual(await queryUsage(db, "p-a", "alice", { ...filters, start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" }), []);
    assert.equal((await queryUsage(db, "p-a", "alice", { ...filters, versionId: "a-v2" })).length, 1);

    // The newest prompt snapshot changing must not relabel previously recorded usage.
    await db.promptVersion.create({ data: { promptId: "p-a", title: "Changed", body: "New version" } });
    assert.equal((await db.usageRecord.findUniqueOrThrow({ where: { id: first.usageId } })).promptVersionId, "a-v2");
    await db.apiKey.update({ where: { id: "key-a" }, data: { revokedAt: new Date() } });
    await assert.rejects(recordUsage(db, key.hashedKey, payload), { status: 401 });
    assert.equal((await queryUsage(db, "p-a", "alice", filters)).length, 2); // Historical metrics survive revocation.
    await db.membership.delete({ where: { userId_workspaceId: { userId: "alice", workspaceId: "a" } } });
    assert.deepEqual(await queryUsage(db, "p-a", "alice", filters), []);
  } finally {
    await db.$disconnect();
    if (created && /^promptops_usage_test_[0-9a-f]{16}$/.test(schema)) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await admin.$disconnect();
  }
});
