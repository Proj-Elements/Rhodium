import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Cheap change detection; no financial data is included in the polling response. */
export async function GET() {
  try {
    const rows = await prisma.$queryRaw<{ revision: bigint }[]>`SELECT "revision" FROM "LedgerRevision" WHERE "id" = 1`;
    return NextResponse.json({ revision: String(rows[0]?.revision ?? 0) });
  } catch (error) {
    return handleApiError(error);
  }
}
