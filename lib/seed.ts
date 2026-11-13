import type { Prisma } from "@prisma/client";
import { withLedgerWrite } from "@/lib/ledger-write";
import { defaultCategories } from "@/lib/default-categories";

let seeded = false;

/** Tests truncate the category table, which must invalidate the process flag. */
export function resetSeedCache() {
  seeded = false;
}

/**
 * Seed default categories once per process. The in-memory flag means steady
 * state GET requests no longer issue a `createMany` write on every call
 * (fresh processes after a deploy still seed exactly once).
 */
export async function ensureDefaultCategories(tx?: Prisma.TransactionClient) {
  if (!tx) {
    if (seeded) return;
    await withLedgerWrite((db) => ensureDefaultCategories(db));
    seeded = true;
    return;
  }
  // Do not publish a process flag before the enclosing transaction commits.
  await tx.category.createMany({
    data: defaultCategories.map((category) => ({ ...category, isSystem: true })),
    skipDuplicates: true,
  });
}
