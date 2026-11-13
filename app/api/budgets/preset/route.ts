import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { moneyToCents } from "@/lib/domain";
import { getBudgetPreset, setBudgetPreset } from "@/lib/budget";
import { budgetEditSchema } from "@/lib/validation";
import { withLedgerRead, withLedgerWrite } from "@/lib/ledger-write";
import { assertBudgetVersion, budgetVersion } from "@/lib/budget-version";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await withLedgerRead(async (tx) => {
      const amountCents = await getBudgetPreset(tx);
      return NextResponse.json({ preset: amountCents === null ? null : { amountCents }, version: await budgetVersion(tx) });
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = budgetEditSchema.parse(await parseJsonBody(request));
    const amountCents = moneyToCents(body.amount);
    return await withLedgerWrite(async (tx) => {
      await assertBudgetVersion(tx, body.expectedVersion);
      await setBudgetPreset(amountCents, tx);
      return NextResponse.json({ preset: { amountCents }, version: await budgetVersion(tx) });
    });
  } catch (error) {
    return handleApiError(error);
  }
}
