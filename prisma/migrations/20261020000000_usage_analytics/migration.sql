CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "model" TEXT NOT NULL,
    "workload" TEXT NOT NULL,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsageRecord_nonnegative" CHECK (
      "inputTokens" >= 0 AND "outputTokens" >= 0 AND
      "latencyMs" >= 0 AND "estimatedCost" >= 0
    ),
    CONSTRAINT "UsageRecord_currency" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "UsageRecord_apiKeyId_requestId_key" ON "UsageRecord"("apiKeyId", "requestId");
CREATE INDEX "UsageRecord_promptVersionId_measuredAt_idx" ON "UsageRecord"("promptVersionId", "measuredAt");
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_promptVersionId_fkey"
  FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
