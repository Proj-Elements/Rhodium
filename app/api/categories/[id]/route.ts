import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = await parseJsonBody(request);
    const category = await prisma.category.findUnique({ where: { id: params.id } });
    if (!category) return jsonError("分类不存在", 404);
    if (category.isSystem && body.archived === true) return jsonError("系统分类不能停用");
    const updated = await prisma.category.update({
      where: { id: params.id },
      data: {
        ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
        ...(typeof body.archived === "boolean" ? { archivedAt: body.archived ? new Date() : null } : {}),
      },
    });
    return NextResponse.json({ category: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
