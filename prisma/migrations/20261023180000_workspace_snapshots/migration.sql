-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baselinedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "snapshotId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_workspaceId_slug_key" ON "Snapshot"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "Snapshot_workspaceId_createdAt_idx" ON "Snapshot"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Snapshot_authorId_idx" ON "Snapshot"("authorId");

-- CreateIndex
CREATE INDEX "AgentRun_snapshotId_createdAt_idx" ON "AgentRun"("snapshotId", "createdAt");

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: snapshots used to be a name each run carried, so the branches that
-- already exist have to be read back out of the runs filed under them. One
-- Snapshot per (workspace, categorySlug) that any run named, attributed to the
-- author of the earliest run under it and dated from that run, so the history
-- that was pushed before this migration keeps its shape.
--
-- Hand-written rather than generated: `prisma migrate dev` writes schema
-- changes, never the data move that has to accompany one.
INSERT INTO "Snapshot" ("id", "workspaceId", "authorId", "name", "slug", "baselinedAt", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    runs."workspaceId",
    (ARRAY_AGG(runs."authorId" ORDER BY runs."createdAt" ASC))[1],
    (ARRAY_AGG(runs."category" ORDER BY runs."createdAt" DESC))[1],
    runs."categorySlug",
    MAX(runs."baselineAt"),
    MIN(runs."createdAt"),
    CURRENT_TIMESTAMP
FROM "AgentRun" runs
WHERE runs."categorySlug" <> ''
GROUP BY runs."workspaceId", runs."categorySlug";

UPDATE "AgentRun" runs
SET "snapshotId" = snapshots."id"
FROM "Snapshot" snapshots
WHERE snapshots."workspaceId" = runs."workspaceId"
  AND snapshots."slug" = runs."categorySlug";
