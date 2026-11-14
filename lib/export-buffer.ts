import { AppError } from "@/lib/errors";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const backupCapacityMessage = "账本超出 JSON 恢复容量（64 MiB、每类实体 10 万条）；请使用 PostgreSQL 数据库备份保留完整数据";
export const MAX_CSV_EXPORT_BYTES = 256 * 1024 * 1024;
let activeExports = 0;

/** Spool to a private temporary file, validate before headers, and bound memory and disk use. */
export function createExportBuffer(maximumBytes = MAX_CSV_EXPORT_BYTES, signal?: AbortSignal) {
  if (activeExports >= 2) throw new AppError("已有两个导出正在进行，请稍后重试", 429);
  signal?.throwIfAborted();
  const directory = mkdtempSync(join(tmpdir(), "rhodium-export-"));
  const filename = join(directory, "data");
  let descriptor = -1;
  try {
    descriptor = openSync(filename, "wx+", 0o600);
    // POSIX keeps the open file alive without a directory entry. SIGKILL also frees it.
    rmSync(directory, { recursive: true, force: true });
  }
  catch (error) {
    if (descriptor >= 0) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  activeExports++;
  let pending: string[] = [];
  let pendingBytes = 0;
  let totalBytes = 0;
  let disposed = false;
  let finished = false;
  let readPosition = 0;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(expiry);
    signal?.removeEventListener("abort", abort);
    try { closeSync(descriptor); }
    finally { activeExports--; rmSync(directory, { recursive: true, force: true }); }
    pending = [];
  };
  const abort = () => {
    streamController?.error(new DOMException("导出已取消或长时间未读取", "AbortError"));
    dispose();
  };
  // Abandoned responses must not retain a file or an export slot indefinitely.
  const expiry = setTimeout(abort, 120_000);
  expiry.unref();
  signal?.addEventListener("abort", abort, { once: true });
  const flush = () => {
    if (!pending.length) return;
    const chunk = Buffer.from(pending.join(""), "utf8");
    let offset = 0;
    while (offset < chunk.length) offset += writeSync(descriptor, chunk, offset, chunk.length - offset);
    pending = [];
    pendingBytes = 0;
  };
  return {
    dispose,
    append(text: string) {
      if (disposed || finished) throw new AppError("导出已结束或取消", 409);
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maximumBytes - totalBytes) {
        dispose();
        throw new AppError(maximumBytes === MAX_CSV_EXPORT_BYTES ? "CSV 导出超过 256 MiB，请使用数据库备份" : backupCapacityMessage, 413);
      }
      totalBytes += bytes;
      pendingBytes += bytes;
      pending.push(text);
      if (pendingBytes >= 64 * 1024) flush();
    },
    finish() {
      if (disposed || finished) throw new AppError("导出已结束或取消", 409);
      flush();
      finished = true;
      return new ReadableStream<Uint8Array>({
        start(controller) { streamController = controller; },
        pull(controller) {
          if (disposed) { controller.error(new DOMException("导出已取消", "AbortError")); return; }
          try {
            expiry.refresh();
            const chunk = Buffer.allocUnsafe(64 * 1024);
            const bytes = readSync(descriptor, chunk, 0, chunk.length, readPosition);
            if (!bytes) { dispose(); controller.close(); return; }
            readPosition += bytes;
            controller.enqueue(chunk.subarray(0, bytes));
          } catch (error) { dispose(); controller.error(error); }
        },
        cancel: dispose,
      });
    },
  };
}
