import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { withLedgerWrite } from "@/lib/ledger-write";
import { invalidateSubscriptionSyncCache } from "@/lib/subscriptions";
import { serializeCategory } from "@/lib/serializers";
import { categoryPatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = categoryPatchSchema.parse(await parseJsonBody(request));
    const response = await withLedgerWrite(async (tx) => {
      const category = await tx.category.findUnique({ where: { id } });
      if (!category) throw notFound("分类不存在");
      if (category.isSystem && body.archived === true) return jsonError("系统分类不能停用", 400);
      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(body.icon !== undefined ? { icon: body.icon } : {}),
          ...(typeof body.archived === "boolean" ? { archivedAt: body.archived ? new Date() : null } : {}),
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
