-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "category" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "categorySlug" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "baselineAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_categorySlug_createdAt_idx" ON "AgentRun"("workspaceId", "categorySlug", "createdAt");
