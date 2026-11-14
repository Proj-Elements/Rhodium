import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { flattenError, ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { monthEnd, monthStart, parseMonth } from "@/lib/domain";

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export function handleApiError(error: unknown) {
  if (error instanceof AppError) {
    return jsonError(error.message, error.status);
  }
  if (error instanceof ZodError) {
    return jsonError("请求参数不完整或格式不正确", 400, flattenError(error));
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return jsonError("请求的数据不存在", 404);
    if (error.code === "P2002") return jsonError("数据已经存在", 409);
    // A row another record still points at (e.g. a subscription deleted while
    // a concurrent sync just wrote its ledger line) is a conflict, not a crash.
    if (error.code === "P2003") return jsonError("操作被拒绝：仍有账目关联该数据", 409);
  }
  console.error(error);
  return jsonError("服务器暂时无法完成请求", 500);
}

/**
 * Body-size guards. Every route buffers its JSON body, so without a cap a
 * single oversized request can pin the process's memory. The import routes
 * legitimately carry thousands of rows, so they get a larger ceiling.
 */
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_IMPORT_BODY_BYTES = 64 * 1024 * 1024;

function tooLargeMessage(maxBytes: number): string {
  return `请求体过大，最多 ${Math.round(maxBytes / 1024)} KB`;
}

/** PostgreSQL text/JSONB cannot preserve NUL or isolated UTF-16 surrogates. */
export function assertValidText(...values: (string | null)[]): void {
  if (values.some((value) => value !== null && /[\u0000\uD800-\uDFFF]/u.test(value))) {
    throw new AppError("文本不能包含空字符或无效 Unicode 字符", 400);
  }
}

export async function parseJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new AppError("请求体必须使用 application/json", 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new AppError(tooLargeMessage(maxBytes), 413);
  // Content-Length may be missing or false. Stop at the byte boundary instead
  // of buffering the entire stream before rejecting it (especially imports).
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = request.body?.getReader();
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new AppError(tooLargeMessage(maxBytes), 413);
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("无法读取请求体", 400);
  } finally {
    reader?.releaseLock();
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, received));
    return JSON.parse(text, (key, value: unknown) => {
      assertValidText(key, typeof value === "string" ? value : null);
      return value;
    }) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("请求体不是有效 UTF-8 JSON", 400);
  }
}

/**
 * Calendar month bounds. Query DATE columns with inclusive end (Prisma truncates time).
 * Replaces the hand-rolled "end + 1 day" math repeated across routes.
 */
export function monthRange(month: string) {
  parseMonth(month);
  const start = monthStart(month);
  const end = monthEnd(month);
  const nextStart = new Date(end);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  return { start, end, nextStart };
}
