import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { hashKey } from "./api-keys";
import { normalizeUsage, sameUsage, UsageError, type AnalyticsFilters, type UsageGroup } from "./usage";

export function usageCredential(authorization: string | null) {
  const match = /^Bearer (pops_[A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
  if (!match) throw new UsageError(401, "Use an active workspace API key as a Bearer credential.");
  return hashKey(match[1]);
}

export async function recordUsage(db: PrismaClient, hashedKey: string, input: unknown) {
  const data = normalizeUsage(input);
  return db.$transaction(async tx => {
    // Revocation updates this same row. Locking makes authorization and insert
    // one transaction: revocation either wins first, or waits for this receipt.
    const keys = await tx.$queryRaw<{ id: string; workspaceId: string }[]>`
      SELECT "id", "workspaceId" FROM "ApiKey"
      WHERE "hashedKey" = ${hashedKey} AND "revokedAt" IS NULL FOR UPDATE`;
    const key = keys[0];
    if (!key) throw new UsageError(401, "Invalid or revoked workspace API key.");
    const version = await tx.promptVersion.findFirst({
      where: { id: data.promptVersionId, prompt: { workspaceId: key.workspaceId } },
      select: { id: true },
    });
    if (!version) throw new UsageError(404, "Prompt version not found in this workspace.");

    // ON CONFLICT avoids leaving the PostgreSQL transaction in an aborted state.
    // The unique constraint also protects callers in different server processes.
    const inserted = await tx.usageRecord.createMany({
      data: [{ ...data, apiKeyId: key.id }], skipDuplicates: true,
    });
    const stored = await tx.usageRecord.findUniqueOrThrow({
      where: { apiKeyId_requestId: { apiKeyId: key.id, requestId: data.requestId } },
    });
    if (!sameUsage(data, { ...stored, estimatedCost: stored.estimatedCost.toFixed(8) })) {
      throw new UsageError(409, "This request ID already has different measurements. Retry with the original payload or use a new request ID for a new execution.");
    }
    await tx.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return { usageId: stored.id, promptVersionId: stored.promptVersionId,
      acceptedAt: stored.receivedAt.toISOString(), duplicate: inserted.count === 0 };
  });
}

export async function queryUsage(db: PrismaClient, promptId: string, userId: string, filters: AnalyticsFilters) {
  const conditions = [
    Prisma.sql`p."id" = ${promptId}`,
    Prisma.sql`EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId" = p."workspaceId" AND m."userId" = ${userId})`,
    Prisma.sql`u."measuredAt" >= ${new Date(filters.start)}`,
    Prisma.sql`u."measuredAt" < ${new Date(filters.end)}`,
  ];
  if (filters.versionId) conditions.push(Prisma.sql`u."promptVersionId" = ${filters.versionId}`);
  if (filters.model) conditions.push(Prisma.sql`u."model" = ${filters.model}`);
  if (filters.workload) conditions.push(Prisma.sql`u."workload" = ${filters.workload}`);
  if (filters.currency) conditions.push(Prisma.sql`u."currency" = ${filters.currency}`);
  const rows = await db.$queryRaw<UsageGroup[]>(Prisma.sql`
    SELECT u."promptVersionId", u."model", u."workload", u."currency",
      COUNT(*)::text AS "requests",
      SUM(u."inputTokens")::text AS "inputTokens",
      SUM(u."outputTokens")::text AS "outputTokens",
      SUM(u."inputTokens"::bigint + u."outputTokens")::text AS "totalTokens",
      AVG(u."inputTokens"::bigint + u."outputTokens")::text AS "meanTokens",
      AVG(u."latencyMs")::text AS "meanLatencyMs",
      SUM(u."estimatedCost")::text AS "estimatedCost",
      AVG(u."estimatedCost")::text AS "meanCost"
    FROM "UsageRecord" u JOIN "PromptVersion" v ON v."id" = u."promptVersionId"
      JOIN "Prompt" p ON p."id" = v."promptId"
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY u."promptVersionId", u."model", u."workload", u."currency", v."createdAt"
    ORDER BY v."createdAt", u."promptVersionId", u."model", u."workload", u."currency"
    LIMIT 501`);
  if (rows.length > 500) throw new UsageError(400, "More than 500 result groups. Narrow the date, model, workload, or version filters.");
  return rows;
}
