import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { addMonths, parseMonth, todayInShanghai } from "@/lib/domain";
import { getMonthSummary } from "@/lib/summary";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const end = url.searchParams.get("end") || todayInShanghai().slice(0, 7);
    parseMonth(end);
    await syncSubscriptions();
    const months = Array.from({ length: 6 }, (_, index) => addMonths(end, index - 5));
    return NextResponse.json({ summaries: await Promise.all(months.map(getMonthSummary)) });
  } catch (error) {
    return handleApiError(error);
  }
}
