import { TransactionType, type Prisma } from "@prisma/client";
import { moneyToCents, parseDateOnly } from "@/lib/domain";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { transactionSchema } from "@/lib/validation";
import type { z } from "zod";

type TransactionInput = z.infer<typeof transactionSchema>;

/** Map the client-facing discriminator onto the Prisma enum. */
export function transactionType(type: TransactionInput["type"]): TransactionType {
  return type === "expense" ? TransactionType.EXPENSE : TransactionType.INCOME;
}

/**
 * Reject a category that is archived or cannot hold the given direction.
 * Shared by create and update so both answer with the same wording.
 */
export async function assertTransactionCategory(categoryId: string, type: TransactionInput["type"], db: Prisma.TransactionClient = prisma): Promise<void> {
  const category = await db.category.findFirst({
    where: { id: categoryId, archivedAt: null, OR: [{ type: "BOTH" }, { type: type === "expense" ? "EXPENSE" : "INCOME" }] },
    select: { id: true },
  });
  if (!category) throw badRequest("请选择有效的分类");
}

/** Map validated input onto the Prisma columns shared by create and update. */
export function transactionData(input: TransactionInput) {
  return {
    type: transactionType(input.type),
    amountCents: moneyToCents(input.amount),
    occurredOn: parseDateOnly(input.occurredOn),
    categoryId: input.categoryId,
    note: input.note?.trim() || null,
  };
}
