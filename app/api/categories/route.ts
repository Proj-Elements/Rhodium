import { NextResponse } from "next/server";
import { CategoryType } from "@prisma/client";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { categorySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDefaultCategories();
    const categories = await prisma.category.findMany({ orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
    return NextResponse.json({ categories });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = categorySchema.parse(await parseJsonBody(request));
    const category = await prisma.category.create({
      data: {
        name: body.name,
        type: body.type === "expense" ? CategoryType.EXPENSE : body.type === "income" ? CategoryType.INCOME : CategoryType.BOTH,
        isSystem: false,
        sortOrder: 100,
      },
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      return jsonError("已经存在同名分类");
    }
    return handleApiError(error);
  }
}
