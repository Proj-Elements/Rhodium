import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { importSchema } from "@/lib/validation";
import { validateRowShallow } from "@/lib/import-parser";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = importSchema.parse(await parseJsonBody(request));
    const errors: string[] = [];
    let invalid = 0;
    const preview = body.rows.map((row, index) => {
      try {
        validateRowShallow(row);
        return index < 20 ? { index, date: String(row.occurredOn ?? row["日期"] ?? ""), amount: row.amount ?? row["金额"] ?? "", note: row.note ?? row["备注"] ?? "" } : null;
      } catch (error) {
        invalid += 1;
        if (errors.length < 50) errors.push(`第 ${index + 1} 行：${error instanceof Error ? error.message : "格式错误"}`);
        return null;
      }
    }).filter((item) => item !== null);
    return NextResponse.json({ total: body.rows.length, valid: body.rows.length - invalid, errors, preview });
  } catch (error) {
    return handleApiError(error);
  }
}
