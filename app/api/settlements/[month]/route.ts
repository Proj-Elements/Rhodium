import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { parseMonth } from "@/lib/domain";
import { getMonthSummary } from "@/lib/summary";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    return NextResponse.json({ summary: await getMonthSummary(month) });
  } catch (error) {
    return handleApiError(error);
  }
}
