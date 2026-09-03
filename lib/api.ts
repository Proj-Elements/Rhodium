import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
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
    return jsonError("请求参数不完整或格式不正确", 400, error.flatten());
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return jsonError("请求的数据不存在", 404);
    if (error.code === "P2002") return jsonError("数据已经存在", 409);
  }
  console.error(error);
  return jsonError("服务器暂时无法完成请求", 500);
}

export function parseJsonBody(request: Request) {
  return request.json().catch(() => {
    throw new AppError("请求体不是有效 JSON", 400);
  });
}

/**
 * Shared [start, nextStart) half-open range for a YYYY-MM month.
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
