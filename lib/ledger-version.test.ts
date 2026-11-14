import { describe, expect, it } from "vitest";
import { nextLedgerVersion } from "@/lib/ledger-version";

describe("restored ledger version boundary", () => {
  it("can reach the database ceiling exactly once", () => {
    expect(nextLedgerVersion(2_147_483_646, "账目")).toBe(2_147_483_647);
    expect(() => nextLedgerVersion(2_147_483_647, "账目")).toThrow(expect.objectContaining({ status: 409 }));
  });
});
