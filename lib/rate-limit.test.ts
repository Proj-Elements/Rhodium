import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, MAX_TRACKED_KEYS, resetRateLimiter } from "@/lib/rate-limit";

const RULE = { limit: 3, windowMs: 60_000 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it("allows requests up to the limit and reports the remaining budget", () => {
    const results = [1, 2, 3].map(() => checkRateLimit("read:a", RULE, 1_000));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true]);
    expect(results.map((result) => result.remaining)).toEqual([2, 1, 0]);
  });

  it("blocks the request after the limit and suggests a retry delay", () => {
    for (let index = 0; index < RULE.limit; index += 1) checkRateLimit("read:a", RULE, 1_000);
    const blocked = checkRateLimit("read:a", RULE, 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("keys counters separately so one scope cannot exhaust another", () => {
    for (let index = 0; index < RULE.limit; index += 1) checkRateLimit("write:a", RULE, 1_000);
    expect(checkRateLimit("write:a", RULE, 1_000).allowed).toBe(false);
    expect(checkRateLimit("read:a", RULE, 1_000).allowed).toBe(true);
    expect(checkRateLimit("write:b", RULE, 1_000).allowed).toBe(true);
  });

  it("starts a fresh window once the old one expires", () => {
    for (let index = 0; index < RULE.limit; index += 1) checkRateLimit("read:a", RULE, 1_000);
    expect(checkRateLimit("read:a", RULE, 1_000).allowed).toBe(false);
    const afterWindow = checkRateLimit("read:a", RULE, 1_000 + RULE.windowMs + 1);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(RULE.limit - 1);
  });

  it("rejects new keys at the hard capacity while retaining existing budgets", () => {
    for (let index = 0; index < MAX_TRACKED_KEYS; index += 1) {
      expect(checkRateLimit(`read:${index}`, RULE, 1_000).allowed).toBe(true);
    }
    for (let index = 0; index < 2; index += 1) {
      expect(checkRateLimit(`new:${index}`, RULE, 1_000)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    }
    expect(checkRateLimit("read:0", RULE, 1_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkRateLimit("after-expiry", RULE, 61_000)).toMatchObject({ allowed: true, remaining: 2 });
  });
});
