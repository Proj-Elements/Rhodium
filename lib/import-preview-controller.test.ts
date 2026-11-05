import { describe, expect, it, vi } from "vitest";
import { createImportPreviewController, type ImportPreview, type ImportPreviewState } from "@/lib/import-preview-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const preview: ImportPreview = { total: 1, valid: 1, errors: [] };
function file(name: string, text: string | Promise<string> = '{"rows":[{"note":"example"}]}') {
  return { name, text: () => Promise.resolve(text) };
}

function setup(request = vi.fn(async () => preview)) {
  let state: ImportPreviewState = { status: "idle" };
  const controller = createImportPreviewController((next) => { state = next; }, request);
  return { controller, state: () => state, request };
}

// Real deferred file reads and preview responses, not implementation-text checks.
describe("import preview selection", () => {
  it("invalidates a previously ready selection immediately when another file is selected", async () => {
    const { controller, state } = setup();
    await controller.select(file("first.json"));
    expect(state().status).toBe("ready");
    const read = deferred<string>();
    const pending = controller.select(file("second.json", read.promise));
    expect(state().status).toBe("loading");
    read.resolve("not json");
    await pending;
    expect(state().status).toBe("error");
  });

  it("keeps the latest file when an earlier file read finishes last", async () => {
    const { controller, state } = setup();
    const read = deferred<string>();
    const first = controller.select(file("first.json", read.promise));
    await controller.select(file("second.json", '{"rows":[{"note":"second"}]}'));
    read.resolve('{"rows":[{"note":"first"}]}');
    await first;
    expect(state()).toMatchObject({ status: "ready", selection: { rows: [{ note: "second" }] } });
  });

  it("keeps the latest preview when an older preview resolves last", async () => {
    const pendingPreview = deferred<ImportPreview>();
    const request = vi.fn().mockReturnValueOnce(pendingPreview.promise).mockResolvedValue(preview);
    const { controller, state } = setup(request);
    const first = controller.select(file("first.json", '{"rows":[{"note":"first"}]}'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await controller.select(file("second.json", '{"rows":[{"note":"second"}]}'));
    pendingPreview.resolve(preview);
    await first;
    expect(state()).toMatchObject({ status: "ready", selection: { rows: [{ note: "second" }] } });
  });

  it("does not resurrect a cancelled preview, including an unresolved dropped-file handle", async () => {
    const { controller, state, request } = setup();
    const handle = deferred<ReturnType<typeof file>>();
    const pending = controller.select(handle.promise);
    controller.cancel();
    handle.resolve(file("dropped.json"));
    await pending;
    expect(state()).toEqual({ status: "idle" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not let an older malformed file replace the new valid selection", async () => {
    const { controller, state } = setup();
    const read = deferred<string>();
    const first = controller.select(file("broken.json", read.promise));
    await controller.select(file("valid.json"));
    read.resolve("not json");
    await first;
    expect(state().status).toBe("ready");
  });

  it("previews the same backup envelope that will be imported", async () => {
    const { controller, state, request } = setup();
    const backup = { version: 1, transactions: [], categories: [{ id: "category", name: "分类" }] };
    await controller.select(file("backup.json", JSON.stringify(backup)));
    expect(request).toHaveBeenCalledWith({ format: "json", rows: [], backup }, expect.any(AbortSignal));
    expect(state()).toMatchObject({ status: "ready", selection: { backup, rows: [] } });
  });

  it.each([
    '{"rows":[{"note":"valid"},null]}',
    '{"version":1,"transactions":[[]]}',
    '{"version":1,"transactions":"not an array"}',
  ])("rejects malformed rows rather than silently omitting them: %s", async (text) => {
    const { controller, state, request } = setup();
    await controller.select(file("invalid.json", text));
    expect(state().status).toBe("error");
    expect(request).not.toHaveBeenCalled();
  });
});
