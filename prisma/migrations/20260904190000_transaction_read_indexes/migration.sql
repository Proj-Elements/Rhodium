-- Dashboard and month-summary reads always filter by type + deletedAt IS NULL and
-- then range-scan occurredOn. The existing (occurredOn, deletedAt) index cannot
-- serve the type predicate, so those aggregates degraded into a filter step.
-- Equality columns first, range column last.
CREATE INDEX "Transaction_type_deletedAt_occurredOn_idx" ON "Transaction"("type", "deletedAt", "occurredOn");

-- Postgres does not index foreign keys automatically. Deleting or updating a
-- subscription, and the per-subscription lookups in the import route, had to
-- sequentially scan Transaction.
CREATE INDEX "Transaction_subscriptionId_idx" ON "Transaction"("subscriptionId");
