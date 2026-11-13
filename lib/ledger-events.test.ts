import { afterEach, describe, expect, it, vi } from "vitest";
import { announceLedgerUpdate } from "@/lib/ledger-events";
import { apiFetch } from "@/lib/api-client";

const eventName = "rhodium:ledger-updated";
afterEach(() => vi.unstubAllGlobals());

describe("ledger update delivery", () => {
  it("delivers to another channel even when the sending channel closes immediately", async () => {
    vi.stubGlobal("window", new EventTarget());
    const receiver = new BroadcastChannel(eventName);
    try {
      const received = new Promise<unknown>((resolve) => { receiver.onmessage = (event) => resolve(event.data); });
      announceLedgerUpdate();
      await expect(received).resolves.toBe("updated");
    } finally { receiver.close(); }
  });

  it("falls back to storage and preserves the local refresh when channels are blocked", () => {
    const window = new EventTarget();
    const refresh = vi.fn();
    window.addEventListener(eventName, refresh);
    vi.stubGlobal("window", window);
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("blocked"); } });
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    expect(() => announceLedgerUpdate()).not.toThrow();
    expect(refresh).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(eventName, expect.any(String));
  });

  it("broadcasts acknowledged writes while previews, reads and rejected writes stay silent", async () => {
    const window = new EventTarget();
    const refresh = vi.fn();
    window.addEventListener(eventName, refresh);
    vi.stubGlobal("window", window);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await apiFetch("/api/categories");
    await apiFetch("/api/import/preview", { method: "POST", json: {} });
    expect(refresh).not.toHaveBeenCalled();
    await apiFetch("/api/categories", { method: "POST", json: {} });
    expect(refresh).toHaveBeenCalledOnce();
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"版本过期"}', { status: 409 })));
    await expect(apiFetch("/api/categories/id", { method: "PATCH", json: {} })).rejects.toMatchObject({ status: 409 });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
