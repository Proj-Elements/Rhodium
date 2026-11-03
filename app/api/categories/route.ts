import { NextResponse } from "next/server";
import { CategoryType } from "@prisma/client";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { serializeCategory } from "@/lib/serializers";
import { categorySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // This is the one read path that must seed: a fresh database has to return the
    // default categories so the pickers on every other page are not empty.
    await ensureDefaultCategories();
    const categories = await prisma.category.findMany({ orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
    return NextResponse.json({ categories: categories.map(serializeCategory) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = categorySchema.parse(await parseJsonBody(request));
    const created = await prisma.category.create({
      data: {
        name: body.name,
        type: body.type === "expense" ? CategoryType.EXPENSE : body.type === "income" ? CategoryType.INCOME : CategoryType.BOTH,
        icon: body.icon ?? null,
        isSystem: false,
        sortOrder: 100,
      },
    });
    return NextResponse.json({ category: serializeCategory(created) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
