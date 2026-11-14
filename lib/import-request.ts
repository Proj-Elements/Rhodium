import { NextResponse } from "next/server";
import { guardRequest } from "@/lib/request-guard";

const state = globalThis as typeof globalThis & { rhodiumActiveImports?: number };

/** Admit one large import/preview per process before buffering any request data. */
export function withImportRequest(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const guard = await guardRequest(request);
    if (guard.response) return guard.response;
    if (state.rhodiumActiveImports) return NextResponse.json({ error: "已有导入或预检正在进行，请稍后重试" }, {
      status: 429, headers: { ...guard.headers, "Retry-After": "3" },
    });
    state.rhodiumActiveImports = 1;
    try {
      const response = await handler(request);
      for (const [key, value] of Object.entries(guard.headers)) response.headers.set(key, value);
      return response;
    } finally {
      state.rhodiumActiveImports = 0;
    }
  };
}
