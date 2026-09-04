import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, errorMessage } from "@/lib/api-client";

function stubFetch(response: { ok: boolean; body?: unknown; throwOnJson?: boolean }) {
  const spy = vi.fn(async () => ({
    ok: response.ok,
    json: async () => {
      if (response.throwOnJson) throw new Error("not json");
      return response.body;
    },
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns the parsed payload on success", async () => {
    stubFetch({ ok: true, body: { transactions: [1, 2] } });
    await expect(apiFetch<{ transactions: number[] }>("/api/transactions")).resolves.toEqual({ transactions: [1, 2] });
  });

  it("serializes `json` and sets the content type", async () => {
    const spy = stubFetch({ ok: true, body: {} });
    await apiFetch("/api/transactions", { method: "POST", json: { amount: "1" } });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"amount":"1"}');
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("leaves the content type alone when there is no json body", async () => {
    const spy = stubFetch({ ok: true, body: {} });
    await apiFetch("/api/transactions");
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("forwards an abort signal and other init fields", async () => {
    const spy = stubFetch({ ok: true, body: {} });
    const controller = new AbortController();
    await apiFetch("/api/dashboard", { signal: controller.signal, cache: "no-store" });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
    expect(init.cache).toBe("no-store");
  });

  it("throws the server message on an error response", async () => {
    stubFetch({ ok: false, body: { error: "请选择有效的分类" } });
    await expect(apiFetch("/api/transactions")).rejects.toThrow("请选择有效的分类");
  });

  it("falls back to a generic message when the error body is unusable", async () => {
    stubFetch({ ok: false, throwOnJson: true });
    await expect(apiFetch("/api/transactions")).rejects.toThrow("请求失败，请稍后再试");
  });

  it("ignores a non-string or empty error field", async () => {
    stubFetch({ ok: false, body: { error: "" } });
    await expect(apiFetch("/api/transactions")).rejects.toThrow("请求失败，请稍后再试");
    stubFetch({ ok: false, body: { error: { code: 1 } } });
    await expect(apiFetch("/api/transactions")).rejects.toThrow("请求失败，请稍后再试");
  });
});

describe("errorMessage", () => {
  it("prefers the error message", () => {
    expect(errorMessage(new Error("保存失败"), "兜底")).toBe("保存失败");
  });

  it.each([new Error(""), "字符串", null, undefined, { message: "x" }])("falls back for %j", (value) => {
    expect(errorMessage(value, "兜底")).toBe("兜底");
  });
});
