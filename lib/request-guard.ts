import { NextResponse } from "next/server";
import { checkRateLimit, type RateLimitRule } from "@/lib/rate-limit";
import { rateLimitClientKey, requestSecurityError } from "@/lib/request-security";
import { accessDecision } from "@/lib/access-control";

const READ_RULE: RateLimitRule = { limit: 600, windowMs: 60_000 };
const WRITE_RULE: RateLimitRule = { limit: 120, windowMs: 60_000 };
const IMPORT_RULE: RateLimitRule = { limit: 12, windowMs: 60_000 };

/** Share authentication, origin checks and rate limits with streaming routes. */
export async function guardRequest(request: Request): Promise<{ response: NextResponse | null; headers: Record<string, string> }> {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  const error = requestSecurityError(request);
  if (error) return { response: NextResponse.json({ error }, { status: 403, headers }), headers };
  const access = await accessDecision(request);
  const isRead = request.method === "GET" || request.method === "HEAD";
  const path = new URL(request.url).pathname;
  const isImport = path.startsWith("/api/import");
  const scope = path === "/api/health" && isRead ? "health" : isImport ? "import" : isRead ? "read" : "write";
  const rule = isImport ? IMPORT_RULE : isRead ? READ_RULE : WRITE_RULE;
  // Failed authentication and the public health probe must not exhaust the
  // owner's data-access quota. They remain independently rate limited.
  const result = checkRateLimit(`${access ? "denied:" : ""}${scope}:${rateLimitClientKey(request)}`, rule);
  headers["X-RateLimit-Limit"] = String(result.limit);
  headers["X-RateLimit-Remaining"] = String(result.remaining);
  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
    return { response: NextResponse.json({ error: "请求过于频繁，请稍后重试" }, { status: 429, headers }), headers };
  }
  if (access) {
    if (access.status === 401) headers["WWW-Authenticate"] = 'Basic realm="Rhodium", charset="UTF-8"';
    return { response: NextResponse.json({ error: access.message }, { status: access.status, headers }), headers };
  }
  return { response: null, headers };
}
