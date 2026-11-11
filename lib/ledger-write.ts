import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type LedgerTransaction = Prisma.TransactionClient;
export type LedgerWriteOptions = { maxWait?: number; timeout?: number };

/** Read related ledger values from one stable PostgreSQL snapshot. */
export function withLedgerRead<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return work(tx);
  }, {
    maxWait: 15_000,
    timeout: 30_000,
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/**
 * Serialize ledger mutations across processes using a PostgreSQL transaction
 * advisory lock. This single-user ledger deliberately trades writer throughput
 * for a simple shared ordering of settlement, sync, import and ordinary edits.
 *
 * Read business state only inside `work`, using its transaction client. READ
 * COMMITTED gives those reads a fresh snapshot after waiting for another writer;
 * REPEATABLE READ could retain the snapshot from before lock acquisition. Never
 * open a nested transaction or use the global Prisma client from the callback.
 * The lock is released by PostgreSQL on both commit and rollback.
 */
export function withLedgerWrite<T>(
  work: (tx: LedgerTransaction) => Promise<T>,
  options: LedgerWriteOptions = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Fixed application namespace + ledger id. Project an integer because the
    // lock function returns PostgreSQL void, which Prisma cannot deserialize.
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS locked FROM pg_advisory_xact_lock(1919447405, 1)
    `;
    return work(tx);
  }, {
    maxWait: 15_000,
    timeout: 120_000,
    ...options,
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
