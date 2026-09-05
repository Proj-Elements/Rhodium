import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MAX_BODY_BYTES, handleApiError, jsonError, monthRange, parseJsonBody } from "@/lib/api";
import { AppError, badRequest, conflict, notFound } from "@/lib/errors";

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("jsonError", () => {
  it("defaults to 400 and omits absent details", async () => {
    const response = jsonError("请选择有效的分类");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "请选择有效的分类" });
  });
});

describe("handleApiError", () => {
  it.each([
    [badRequest("请选择有效的分类"), 400, "请选择有效的分类"],
    [conflict("本月已经结算，请先重新打开本月"), 409, "本月已经结算，请先重新打开本月"],
    [notFound("账目不存在"), 404, "账目不存在"],
    [new AppError("请求体过大", 413), 413, "请求体过大"],
  ])("maps an AppError onto its own status", async (error, status, message) => {
    const response = handleApiError(error);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: message });
  });

  it("turns a ZodError into a 400 with field details", async () => {
    const parsed = z.object({ amount: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    const response = handleApiError(parsed.success ? null : parsed.error);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("请求参数不完整或格式不正确");
    expect(body.details.fieldErrors).toHaveProperty("amount");
  });

  it("maps Prisma P2025 to 404, P2002 to 409 and P2003 (fk in use) to 409", async () => {
    const missing = new Prisma.PrismaClientKnownRequestError("missing", { code: "P2025", clientVersion: "5" });
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "5" });
    const fkInUse = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "5" });
    expect(handleApiError(missing).status).toBe(404);
    expect(await handleApiError(missing).json()).toMatchObject({ error: "请求的数据不存在" });
    expect(handleApiError(duplicate).status).toBe(409);
    expect(await handleApiError(duplicate).json()).toMatchObject({ error: "数据已经存在" });
    expect(handleApiError(fkInUse).status).toBe(409);
    expect(await handleApiError(fkInUse).json()).toMatchObject({ error: "操作被拒绝：仍有账目关联该数据" });
  });

  it("hides unexpected failures behind a 500 and logs them once", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = handleApiError(new TypeError("connection refused at 10.0.0.5"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "服务器暂时无法完成请求" });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("does not leak an unknown Prisma error code to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown = new Prisma.PrismaClientKnownRequestError("boom", { code: "P2021", clientVersion: "5" });
    const response = handleApiError(unknown);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "服务器暂时无法完成请求" });
  });
});

describe("monthRange", () => {
  it("returns a half-open range covering the whole month", () => {
    const { start, end, nextStart } = monthRange("2024-02");
    expect(start.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    expect(end.toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(nextStart.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });

  it("rolls over the year boundary", () => {
    expect(monthRange("2024-12").nextStart.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("rejects a malformed month", () => {
    expect(() => monthRange("2024-13")).toThrow();
  });
});
