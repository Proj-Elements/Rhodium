-- Reorder the soft-delete index: every list/aggregate query pins `deletedAt IS
-- NULL` and then ranges over `occurredOn`, so the equality column belongs first.
-- Measured neutral on month-range reads at 40k rows; it additionally makes the
-- index usable as a prefix for queries that filter `deletedAt` alone.
-- DropIndex
DROP INDEX "Transaction_occurredOn_deletedAt_idx";

-- CreateIndex
CREATE INDEX "Transaction_deletedAt_occurredOn_idx" ON "Transaction"("deletedAt", "occurredOn");

-- PostgreSQL does not index foreign keys automatically; deleting a subscription
-- counts its transactions first, which was a full table scan (455 buffers at
-- 40k rows, versus 3 with this index).
-- CreateIndex
CREATE INDEX "Transaction_subscriptionId_idx" ON "Transaction"("subscriptionId");
