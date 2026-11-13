import { syncSubscriptions } from "@/lib/subscriptions";

export function createSubscriptionScheduler(sync: () => Promise<unknown> = syncSubscriptions, intervalMs = 60_000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    running = Promise.resolve().then(sync).then(() => {}, () => {
      console.error("固定支出后台同步失败，将在下一轮重试");
    }).finally(() => {
      running = null;
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
        timer.unref?.();
      }
    });
  };
  return {
    start() { if (stopped) { stopped = false; tick(); } },
    async stop() { stopped = true; if (timer) clearTimeout(timer); await running; },
  };
}

const schedulerState = globalThis as typeof globalThis & { rhodiumSubscriptionScheduler?: ReturnType<typeof createSubscriptionScheduler> };

export function startSubscriptionScheduler() {
  if (process.env.NODE_ENV === "test" || process.env.NEXT_PHASE === "phase-production-build" || process.env.RHODIUM_DISABLE_SCHEDULER === "true") return;
  schedulerState.rhodiumSubscriptionScheduler ??= createSubscriptionScheduler();
  schedulerState.rhodiumSubscriptionScheduler.start();
}
