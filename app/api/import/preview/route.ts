import { NextResponse } from "next/server";
import { handleApiError, MAX_IMPORT_BODY_BYTES, parseJsonBody } from "@/lib/api";
import { importSchema } from "@/lib/backup-validation";
import { normalizeRow, type NormalizedRow } from "@/lib/import-parser";
import { summarizeImport } from "@/lib/import-summary";
import { prisma } from "@/lib/prisma";
import { withImportRequest } from "@/lib/import-request";

export const dynamic = "force-dynamic";

const handlePreview = withImportRequest(async (request: Request) => {
  try {
    const body = importSchema.parse(await parseJsonBody(request, MAX_IMPORT_BODY_BYTES));
    const errors: string[] = [];
    let invalid = 0;
    const normalized: NormalizedRow[] = [];
    const preview = body.rows.map((row, index) => {
      try {
        const parsed = normalizeRow(row, Boolean(body.backup));
        normalized.push(parsed);
        return index < 20 ? { index, date: parsed.occurredOn.toISOString().slice(0, 10), amount: (parsed.amountCents / 100).toFixed(2), note: parsed.note?.slice(0, 200) ?? "" } : null;
      } catch (error) {
        invalid += 1;
        if (errors.length < 50) errors.push(`第 ${index + 1} 行：${error instanceof Error ? error.message : "格式错误"}`);
        return null;
      }
    }).filter((item) => item !== null);
    const summary = invalid ? undefined : await prisma.$transaction((tx) => summarizeImport(tx, normalized, body.backup), { isolationLevel: "RepeatableRead", timeout: 120_000 });
    if (summary) {
      for (const month of summary.lockedMonths) if (errors.length < 50) errors.push(`${month} 已结算，请先重新打开后再导入`);
      for (const message of summary.conflicts) if (errors.length < 50) errors.push(message);
    }
    return NextResponse.json({ total: body.rows.length, valid: body.rows.length - invalid, errors, preview, summary });
  } catch (error) {
    return handleApiError(error);
  }
});

export async function POST(request: Request) {
  return handlePreview(request);
}
