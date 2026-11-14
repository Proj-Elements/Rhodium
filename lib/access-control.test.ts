import { describe, expect, it } from "vitest";
import { accessDecision } from "./access-control";

const token = "t".repeat(48);
const request = (path: string, authorization?: string, method = "GET") => new Request(`http://localhost${path}`, { method, headers: authorization ? { authorization } : {} });
describe("ledger access control", () => {
  it("fails closed when credentials are absent or invalidly configured", async () => {
    expect(await accessDecision(request("/dashboard"), "")).toMatchObject({ status: 503 });
    expect(await accessDecision(request("/api/export"), "short")).toMatchObject({ status: 503 });
    expect(await accessDecision(request("/api/export"), token)).toMatchObject({ status: 401 });
  });
  it("supports browser Basic and Agent Bearer credentials", async () => {
    expect(await accessDecision(request("/dashboard", `Basic ${btoa(`rhodium:${token}`)}`), token)).toBeNull();
    expect(await accessDecision(request("/api/transactions", `Bearer ${token}`, "POST"), token)).toBeNull();
  });
  it.each(["Basic !invalid", `Basic ${btoa(`other:${token}`)}`, "Bearer wrong", `Bearer ${token}x`])("rejects %s", async (header) => {
    expect(await accessDecision(request("/api/export", header), token)).toMatchObject({ status: 401 });
  });
  it("only exempts the exact read-only health probe", async () => {
    expect(await accessDecision(request("/api/health"), "")).toBeNull();
    expect(await accessDecision(request("/api/health/anything"), token)).toMatchObject({ status: 401 });
    expect(await accessDecision(request("/api/health", undefined, "POST"), token)).toMatchObject({ status: 401 });
  });
});
