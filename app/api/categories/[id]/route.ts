import { NextResponse } from "next/server";
import { assertValidText, handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { conflict, notFound } from "@/lib/errors";
import { withLedgerWrite } from "@/lib/ledger-write";
import { invalidateSubscriptionSyncCache } from "@/lib/subscriptions";
import { serializeCategory } from "@/lib/serializers";
import { categoryPatchSchema } from "@/lib/validation";
import { todayInShanghai } from "@/lib/domain";
import { changeBillingPause } from "@/lib/billing-pauses";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    assertValidText(id);
    const body = categoryPatchSchema.parse(await parseJsonBody(request));
    const response = await withLedgerWrite(async (tx) => {
      const category = await tx.category.findUnique({ where: { id } });
      if (!category) throw notFound("分类不存在");
      if (body.expectedVersion !== category.version) throw conflict("分类已被其他操作修改，请刷新后重试");
      if (category.isSystem && body.archived === true) return jsonError("系统分类不能停用", 400);
      const updated = await tx.category.update({
        where: { id },
        data: {
          version: { increment: 1 },
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(body.icon !== undefined ? { icon: body.icon } : {}),
          ...(typeof body.archived === "boolean" ? {
            archivedAt: body.archived ? category.archivedAt ?? new Date() : null,
            billingPauses: changeBillingPause(category.billingPauses, body.archived, todayInShanghai()),
          } : {}),
        },
      });
      return NextResponse.json({ category: serializeCategory(updated) });
    });
    invalidateSubscriptionSyncCache();
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
