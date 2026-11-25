-- CreateTable
CREATE TABLE "AiAction" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "localOperations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lease" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "resultRef" TEXT,
    "replayBytes" BYTEA,
    "replayType" TEXT,
    "replayUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderAttempt" (
    "id" TEXT NOT NULL,
    "actionId" TEXT,
    "ownerId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "rateScope" TEXT,
    "rateLimitCategory" TEXT,
    "retryAt" TIMESTAMP(3),
    "remainingRequests" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderCooldown" (
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "retryCategory" TEXT,

    CONSTRAINT "AiProviderCooldown_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE INDEX "AiAction_ownerId_kind_createdAt_idx" ON "AiAction"("ownerId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiAction_ownerId_resultRef_idx" ON "AiAction"("ownerId", "resultRef");

-- CreateIndex
CREATE UNIQUE INDEX "AiAction_ownerId_kind_requestKey_key" ON "AiAction"("ownerId", "kind", "requestKey");

-- CreateIndex
CREATE INDEX "AiProviderAttempt_ownerId_createdAt_idx" ON "AiProviderAttempt"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "AiProviderAttempt_actionId_idx" ON "AiProviderAttempt"("actionId");

-- CreateIndex
CREATE INDEX "AiProviderAttempt_provider_createdAt_idx" ON "AiProviderAttempt"("provider", "createdAt");

-- AddForeignKey
ALTER TABLE "AiAction" ADD CONSTRAINT "AiAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderAttempt" ADD CONSTRAINT "AiProviderAttempt_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AiAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderAttempt" ADD CONSTRAINT "AiProviderAttempt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
