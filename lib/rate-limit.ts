/**
 * Fixed-window in-memory rate limiter for the API routes.
 *
 * The app is a single-instance personal ledger, so a process-local counter is
 * enough: it stops a runaway script (or a stray tab in a retry loop) from
 * hammering the database without adding an external dependency. Counters are
 * per-process and reset on restart.
 */
export type RateLimitRule = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Keeps the map from growing without bound if keys are unique per request. */
export const MAX_TRACKED_KEYS = 5_000;

function prune(now: number): number {
  let nextReset = Infinity;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
    else nextReset = Math.min(nextReset, window.resetAt);
  }
  return nextReset;
}

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  if (windows.size >= MAX_TRACKED_KEYS && !windows.has(key)) {
    const nextReset = prune(now);
    if (windows.size >= MAX_TRACKED_KEYS) {
      return {
        allowed: false,
        limit: rule.limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((nextReset - now) / 1000)),
      };
    }
  }

  const existing = windows.get(key);
  const window = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };
  window.count = Math.min(window.count + 1, rule.limit + 1);
  windows.set(key, window);

  const allowed = window.count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - window.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
  };
}

/** Test seam: drops all counters. */
export function resetRateLimiter(): void {
  windows.clear();
}
