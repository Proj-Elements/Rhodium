import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { resetRateLimiter } from "@/lib/rate-limit";
import { rateLimitClientKey } from "@/lib/request-security";

beforeEach(() => resetRateLimiter());
afterEach(() => vi.unstubAllEnvs());

describe("local API request boundary", () => {
  it.each(["GET", "POST"])("rejects cross-site %s before a route can read or write", (method) => {
    const response = middleware(new NextRequest("http://localhost:3030/api/categories", { method, headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site" } }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("allows same-origin and native Agent requests", () => {
    const requests: HeadersInit[] = [{ origin: "http://localhost:3030", "content-type": "application/json" }, {}];
    for (const headers of requests) {
      expect(middleware(new NextRequest("http://localhost:3030/api/categories", { method: "POST", headers })).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("rejects a foreign Host even when Origin agrees", () => {
    expect(middleware(new NextRequest("http://evil.example:3030/api/categories", { headers: { host: "evil.example:3030", origin: "http://evil.example:3030" } })).status).toBe(403);
  });

  it.each(["localhost@evil.example", "evil.example@localhost", "localhost/path", "localhost#fragment"])("rejects malformed Host %s", (host) => {
    expect(middleware(new NextRequest("http://localhost:3030/api/categories", { headers: { host } })).status).toBe(403);
  });

  it("rejects same-site browser requests and opaque origins", () => {
    expect(middleware(new NextRequest("http://localhost:3030/api/categories", { headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
    expect(middleware(new NextRequest("http://localhost:3030/api/categories", { headers: { origin: "null" } })).status).toBe(403);
  });

  it("requires complete same-origin browser metadata for writes", () => {
    const requests: HeadersInit[] = [{ "sec-fetch-site": "none" }, { "sec-fetch-mode": "cors" }, { "sec-fetch-site": "same-origin" }];
    for (const headers of requests) {
      expect(middleware(new NextRequest("http://localhost:3030/api/categories", { method: "POST", headers })).status).toBe(403);
    }
    expect(middleware(new NextRequest("http://localhost:3030/api/categories", { method: "POST", headers: { "sec-fetch-site": "same-origin", origin: "http://localhost:3030" } })).headers.get("x-middleware-next")).toBe("1");
  });

  it("requires canonical credential-free origins and exact host ports", () => {
    for (const origin of ["http://user:pass@localhost:3030", "http://localhost:3030/", "http://localhost:3031", "http://localhost:3030?query=1"]) {
      expect(middleware(new NextRequest("http://localhost:3030/api/categories", { headers: { origin } })).status).toBe(403);
    }
  });

  it("accepts configured proxy hosts/origins and ignores forwarded hosts", () => {
    vi.stubEnv("RHODIUM_ALLOWED_HOSTS", "ledger.example");
    vi.stubEnv("RHODIUM_ALLOWED_ORIGINS", "https://ledger.example");
    expect(middleware(new NextRequest("http://ledger.example/api/categories", { headers: { host: "ledger.example", origin: "https://ledger.example" } })).headers.get("x-middleware-next")).toBe("1");
    expect(middleware(new NextRequest("http://evil.example/api/categories", { headers: { "x-forwarded-host": "ledger.example" } })).status).toBe(403);
  });
});

describe("rate-limit proxy trust", () => {
  it("ignores forged forwarding headers by default", () => {
    expect(rateLimitClientKey(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" } }))).toBe("local");
  });

  it("requires one valid address from an explicitly trusted edge proxy", () => {
    vi.stubEnv("RHODIUM_TRUST_PROXY", "true");
    expect(rateLimitClientKey(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": "203.0.113.7" } }))).toBe("203.0.113.7");
    expect(rateLimitClientKey(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": "fake, 203.0.113.7" } }))).toBe("local");
    expect(rateLimitClientKey(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": "2001:DB8::1" } }))).toBe("2001:db8::1");
    expect(rateLimitClientKey(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": "999.2.3.4" } }))).toBe("local");
    expect(rateLimitClientKey(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": "203.0.113.7, forged" } }))).toBe("local");
  });
});
