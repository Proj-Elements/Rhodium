import { describe, expect, it } from "vitest";
import { historyPage } from "@/lib/history-page";

describe("bounded history pages", () => {
  it("defaults to fifty records and accepts the server's version cursor", () => {
    expect(historyPage(new Request("http://localhost/history"))).toEqual({ limit: 50, cursor: null });
    expect(historyPage(new Request("http://localhost/history?limit=200&cursor=42"))).toEqual({ limit: 200, cursor: 42 });
  });

  it.each(["limit=0", "limit=201", "limit=1.5", "limit=abc", "cursor=0", "cursor=-1", "cursor=1.5", "cursor=2147483648"])("rejects invalid pagination %s", (query) => {
    expect(() => historyPage(new Request(`http://localhost/history?${query}`))).toThrow();
  });
});
