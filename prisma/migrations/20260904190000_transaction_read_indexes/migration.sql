-- Dashboard and month-summary reads always filter by type + deletedAt IS NULL and
-- then range-scan occurredOn. The existing (deletedAt, occurredOn) index cannot
-- serve the type predicate, so those aggregates degraded into a filter step.
-- Equality columns first, range column last.
CREATE INDEX "Transaction_type_deletedAt_occurredOn_idx" ON "Transaction"("type", "deletedAt", "occurredOn");

-- Transaction_subscriptionId_idx ships in 20260904142316_tune_transaction_indexes,
-- which runs first; do not create it again here.
