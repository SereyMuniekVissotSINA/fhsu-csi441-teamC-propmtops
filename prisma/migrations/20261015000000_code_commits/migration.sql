-- CreateEnum
CREATE TYPE "CodeFileChange" AS ENUM ('ADDED', 'MODIFIED', 'UNCHANGED', 'REMOVED');

-- CreateTable
CREATE TABLE "CodeCommit" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersionId" TEXT,
    "parentId" TEXT,
    "authorId" TEXT,
    "sequence" INTEGER NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeCommit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeFile" (
    "id" TEXT NOT NULL,
    "commitId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '',
    "change" "CodeFileChange" NOT NULL DEFAULT 'ADDED',
    "added" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CodeFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeCommit_promptId_createdAt_idx" ON "CodeCommit"("promptId", "createdAt");

-- CreateIndex
CREATE INDEX "CodeCommit_promptVersionId_idx" ON "CodeCommit"("promptVersionId");

-- CreateIndex
CREATE INDEX "CodeCommit_parentId_idx" ON "CodeCommit"("parentId");

-- CreateIndex
CREATE INDEX "CodeCommit_authorId_idx" ON "CodeCommit"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeCommit_promptId_sequence_key" ON "CodeCommit"("promptId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CodeFile_commitId_path_key" ON "CodeFile"("commitId", "path");

-- AddForeignKey
ALTER TABLE "CodeCommit" ADD CONSTRAINT "CodeCommit_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeCommit" ADD CONSTRAINT "CodeCommit_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeCommit" ADD CONSTRAINT "CodeCommit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CodeCommit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeCommit" ADD CONSTRAINT "CodeCommit_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeFile" ADD CONSTRAINT "CodeFile_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "CodeCommit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
