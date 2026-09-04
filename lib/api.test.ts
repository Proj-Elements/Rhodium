import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, parseJsonBody } from "@/lib/api";
import { AppError } from "@/lib/errors";

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("parseJsonBody", () => {
  it("parses a normal JSON body", async () => {
    await expect(parseJsonBody(jsonRequest('{"amount":"12.50"}'))).resolves.toEqual({ amount: "12.50" });
  });

  it("rejects invalid JSON with a 400", async () => {
    await expect(parseJsonBody(jsonRequest("{not json"))).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an oversized body with a 413", async () => {
    const oversized = `{"note":"${"啊".repeat(200)}"}`;
    await expect(parseJsonBody(jsonRequest(oversized), 64)).rejects.toBeInstanceOf(AppError);
    await expect(parseJsonBody(jsonRequest(oversized), 64)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects early when content-length already exceeds the cap", async () => {
    const request = jsonRequest("{}", { "content-length": String(MAX_BODY_BYTES + 1) });
    await expect(parseJsonBody(request)).rejects.toMatchObject({ status: 413 });
  });

  it("measures bytes rather than characters for multi-byte notes", async () => {
    // 30 Chinese characters are 90 UTF-8 bytes, so a 60-byte cap must reject.
    await expect(parseJsonBody(jsonRequest(`{"note":"${"备".repeat(30)}"}`), 60)).rejects.toMatchObject({
      status: 413,
    });
  });
});
