import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { addMonths, parseMonth, todayInShanghai } from "@/lib/domain";
import { getMonthSummaries } from "@/lib/summary";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const end = url.searchParams.get("end") || todayInShanghai().slice(0, 7);
    parseMonth(end);
    // include=focus returns the `end` month's full summary in the same response,
    // so the settlements page needs a single request instead of two.
    const includeFocus = url.searchParams.get("include") === "focus";
    const availableMonths = (Number(end.slice(0, 4)) - 1) * 12 + Number(end.slice(5, 7));
    const length = Math.min(6, availableMonths);
    const months = Array.from({ length }, (_, index) => addMonths(end, index - length + 1));
    const summaries = await getMonthSummaries(months);
    // `end` is the last element, so focus reuses it instead of recomputing.
    const focus = summaries[summaries.length - 1] ?? null;
    return NextResponse.json({ summaries, ...(includeFocus ? { focus } : {}) });
  } catch (error) {
    return handleApiError(error);
  }
}
