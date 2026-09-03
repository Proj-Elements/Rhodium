import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError("请求参数不完整或格式不正确", 400, error.flatten());
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return jsonError("请求的数据不存在", 404);
    if (error.code === "P2002") return jsonError("数据已经存在", 409);
  }
  if (error instanceof Error && /日期|月份|金额|请求体/.test(error.message)) {
    return jsonError(error.message, 400);
  }
  console.error(error);
  return jsonError("服务器暂时无法完成请求", 500);
}

export function parseJsonBody(request: Request) {
  return request.json().catch(() => {
    throw new Error("请求体不是有效 JSON");
  });
}
