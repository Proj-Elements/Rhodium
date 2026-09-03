import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { parseMonth } from "@/lib/domain";
import { getMonthSummary } from "@/lib/summary";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

type Context = { params: { month: string } };

export async function GET(_request: Request, { params }: Context) {
  try {
    parseMonth(params.month);
    await syncSubscriptions();
    return NextResponse.json({ summary: await getMonthSummary(params.month) });
  } catch (error) {
    return handleApiError(error);
  }
}
