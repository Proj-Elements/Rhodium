import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, type RateLimitRule } from "@/lib/rate-limit";

/**
 * Generous ceilings: normal page loads fire a handful of requests, so these
 * only trip on runaway loops. Imports are capped much lower because each call
 * can write thousands of rows.
 */
const READ_RULE: RateLimitRule = { limit: 600, windowMs: 60_000 };
const WRITE_RULE: RateLimitRule = { limit: 120, windowMs: 60_000 };
const IMPORT_RULE: RateLimitRule = { limit: 12, windowMs: 60_000 };

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

export function middleware(request: NextRequest) {
  const isRead = request.method === "GET" || request.method === "HEAD";
  const isImport = request.nextUrl.pathname.startsWith("/api/import");
  const scope = isImport ? "import" : isRead ? "read" : "write";
  const rule = isImport ? IMPORT_RULE : isRead ? READ_RULE : WRITE_RULE;

  const result = checkRateLimit(`${scope}:${clientKey(request)}`, rule);
  if (!result.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后重试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSeconds),
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
