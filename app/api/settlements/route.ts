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
    // include=focus returns the `end` month's full summary in the same response,
    // so the settlements page needs a single request instead of two.
    const includeFocus = url.searchParams.get("include") === "focus";
    await syncSubscriptions();
    const months = Array.from({ length: 6 }, (_, index) => addMonths(end, index - 5));
    const [summaries, focus] = await Promise.all([
      Promise.all(months.map(getMonthSummary)),
      includeFocus ? getMonthSummary(end) : Promise.resolve(null),
    ]);
    return NextResponse.json({ summaries, ...(includeFocus ? { focus } : {}) });
  } catch (error) {
    return handleApiError(error);
  }
}
