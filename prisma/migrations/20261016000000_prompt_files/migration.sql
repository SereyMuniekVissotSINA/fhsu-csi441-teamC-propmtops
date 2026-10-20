CREATE TABLE "PromptFile" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "versionCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromptFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptFileVersion" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "text" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sourceVersionId" TEXT,
    "instruction" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromptFileVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromptFile_promptId_createdAt_idx" ON "PromptFile"("promptId", "createdAt");
CREATE UNIQUE INDEX "PromptFileVersion_fileId_version_key" ON "PromptFileVersion"("fileId", "version");
CREATE INDEX "PromptFileVersion_sourceVersionId_idx" ON "PromptFileVersion"("sourceVersionId");
ALTER TABLE "PromptFile" ADD CONSTRAINT "PromptFile_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptFileVersion" ADD CONSTRAINT "PromptFileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "PromptFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptFileVersion" ADD CONSTRAINT "PromptFileVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "PromptFileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
