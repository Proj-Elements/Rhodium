import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { moneyToCents } from "@/lib/domain";
import { getBudgetPreset, setBudgetPreset } from "@/lib/budget";
import { budgetSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const amountCents = await getBudgetPreset();
    return NextResponse.json({ preset: amountCents === null ? null : { amountCents } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = budgetSchema.parse(await parseJsonBody(request));
    const amountCents = moneyToCents(body.amount);
    await setBudgetPreset(amountCents);
    return NextResponse.json({ preset: { amountCents } });
  } catch (error) {
    return handleApiError(error);
  }
}
