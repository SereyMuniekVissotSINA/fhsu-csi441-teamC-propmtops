-- CreateEnum
CREATE TYPE "AgentFileChange" AS ENUM ('ADDED', 'MODIFIED', 'REMOVED');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT,
    "sequence" INTEGER NOT NULL,
    "agent" TEXT NOT NULL DEFAULT '',
    "root" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "response" TEXT NOT NULL DEFAULT '',
    "toolEvents" TEXT NOT NULL DEFAULT '[]',
    "restoreRequestedAt" TIMESTAMP(3),
    "restoreRequestedById" TEXT,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunFile" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "beforeHash" TEXT NOT NULL,
    "afterHash" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '',
    "change" "AgentFileChange" NOT NULL,
    "added" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentRunFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_createdAt_idx" ON "AgentRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_authorId_idx" ON "AgentRun"("authorId");

-- CreateIndex
CREATE INDEX "AgentRun_restoreRequestedById_idx" ON "AgentRun"("restoreRequestedById");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_workspaceId_sequence_key" ON "AgentRun"("workspaceId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunFile_runId_path_key" ON "AgentRunFile"("runId", "path");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_restoreRequestedById_fkey" FOREIGN KEY ("restoreRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunFile" ADD CONSTRAINT "AgentRunFile_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
