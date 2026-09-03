import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { importSchema } from "@/lib/validation";
import { moneyToCents, parseDateOnly } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = importSchema.parse(await parseJsonBody(request));
    const errors: string[] = [];
    let invalid = 0;
    const preview = body.rows.map((row, index) => {
      try {
        const date = String(row.occurredOn ?? row["日期"] ?? "");
        const amount = row.amount ?? row["金额"] ?? (typeof row.amountCents === "number" ? row.amountCents / 100 : undefined);
        parseDateOnly(date);
        moneyToCents(String(amount));
        const kind = String(row.type ?? row["类型"] ?? "expense").trim().toLowerCase();
        if (kind && kind !== "expense" && kind !== "income" && !kind.includes("支出") && !kind.includes("收入")) throw new Error("类型只能是支出或收入");
        return index < 20 ? { index, date, amount, note: row.note ?? row["备注"] ?? "" } : null;
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
