import { describe, expect, it } from "vitest";
import { createExportBuffer } from "@/lib/export-buffer";

describe("encoded export capacity", () => {
  it("counts UTF-8 bytes before exposing a downloadable response", () => {
    const output = createExportBuffer(6);
    output.append("中文");
    expect(() => output.append("a")).toThrow(expect.objectContaining({ status: 413 }));
  });

  it("preserves output across multiple encoded chunks without concatenating the entire archive", async () => {
    const output = createExportBuffer();
    const first = "记录".repeat(20_000);
    output.append(first);
    output.append("\n下一页");
    expect(await new Response(output.finish()).text()).toBe(`${first}\n下一页`);
  });
});
