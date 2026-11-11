ALTER TABLE "Transaction" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MonthlySettlement" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MonthlySettlement" ADD COLUMN "categorySnapshot" JSONB;

CREATE TABLE "CreationRequest" (
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreationRequest_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "TransactionHistory" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransactionHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TransactionHistory_transactionId_version_key" ON "TransactionHistory"("transactionId", "version");
CREATE INDEX "TransactionHistory_transactionId_recordedAt_idx" ON "TransactionHistory"("transactionId", "recordedAt");

CREATE TABLE "SettlementHistory" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SettlementHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SettlementHistory_month_revision_key" ON "SettlementHistory"("month", "revision");
CREATE INDEX "SettlementHistory_month_recordedAt_idx" ON "SettlementHistory"("month", "recordedAt");
