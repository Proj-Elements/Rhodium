import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { withImportRequest } from "@/lib/import-request";
import { resetRateLimiter } from "@/lib/rate-limit";
import { config } from "@/middleware";

const token = "t".repeat(48);
function request(path = "/api/import", headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, ...headers } });
}
beforeEach(() => { resetRateLimiter(); vi.stubEnv("RHODIUM_ACCESS_TOKEN", token); });
afterEach(() => vi.unstubAllEnvs());

describe("large import request boundary", () => {
  it.each(["/api/import", "/api/import/preview", "/api/import/preview?file=test", "/api/import/"])("avoids middleware body cloning for %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
  it.each(["/api/transactions", "/api/import/other", "/api/imported", "/api/import/preview/other"])("preserves middleware for %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });
  it("authenticates and checks origins before invoking either import handler", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const guarded = withImportRequest(handler);
    expect((await guarded(request("/api/import", { authorization: "" }))).status).toBe(401);
    expect((await guarded(request("/api/import/preview", { origin: "http://evil.example" }))).status).toBe(403);
    expect((await guarded(request("/api/import", { host: "evil.example" }))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it("shares one admission slot between preview and restore and releases it on failure", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = withImportRequest(async () => { entered(); await pending; throw new Error("injected failure"); });
    const handler = vi.fn(async () => new Response("ok"));
    const second = withImportRequest(handler);
    const running = first(request());
    const failed = expect(running).rejects.toThrow("injected failure");
    await started;
    const busy = await second(request("/api/import/preview"));
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("3");
    expect(handler).not.toHaveBeenCalled();
    finish();
    await failed;
    expect((await second(request())).status).toBe(200);
  });
  it("retains the shared import frequency limit and rate headers", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const guarded = withImportRequest(handler);
    for (let index = 0; index < 12; index++) expect((await guarded(request(index % 2 ? "/api/import/preview" : "/api/import"))).status).toBe(200);
    const blocked = await guarded(request());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(handler).toHaveBeenCalledTimes(12);
  });

  it("keeps anonymous request quotas separate from authenticated imports", async () => {
    const guarded = withImportRequest(async () => new Response("ok"));
    for (let index = 0; index < 13; index++) {
      expect([401, 429]).toContain((await guarded(request("/api/import/preview", { authorization: "" }))).status);
    }
    const allowed = await guarded(request("/api/import/preview"));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("x-ratelimit-remaining")).toBe("11");
  });
});
