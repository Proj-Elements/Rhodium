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
const MAX_TRACKED_KEYS = 5_000;

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  if (windows.size > MAX_TRACKED_KEYS) prune(now);

  const existing = windows.get(key);
  const window = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };
  window.count += 1;
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
