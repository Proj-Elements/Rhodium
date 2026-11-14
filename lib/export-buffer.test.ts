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
  it("releases export slots after cancellation and overflow", async () => {
    const first = createExportBuffer();
    const second = createExportBuffer();
    expect(() => createExportBuffer()).toThrow(expect.objectContaining({ status: 429 }));
    await first.finish().cancel();
    second.dispose();
    const next = createExportBuffer(1);
    expect(() => next.append("中文")).toThrow(expect.objectContaining({ status: 413 }));
    const retry = createExportBuffer();
    retry.dispose();
  });
  it("cleans up when the request aborts before download", () => {
    const controller = new AbortController();
    const output = createExportBuffer(undefined, controller.signal);
    output.append("private ledger");
    controller.abort();
    expect(() => output.append("more")).toThrow();
    output.dispose();
  });
});
