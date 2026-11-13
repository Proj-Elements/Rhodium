import { AppError } from "@/lib/errors";

export const backupCapacityMessage = "账本超出 JSON 恢复容量（64 MB、10 万条账目）；请使用 PostgreSQL 数据库备份保留完整数据";

/** Buffer validated output in small encoded chunks, releasing each chunk as it is sent. */
export function createExportBuffer(maximumBytes = Infinity) {
  const chunks: (Uint8Array | null)[] = [];
  let pending: string[] = [];
  let pendingBytes = 0;
  let totalBytes = 0;
  const flush = () => {
    if (!pending.length) return;
    chunks.push(Buffer.from(pending.join(""), "utf8"));
    pending = [];
    pendingBytes = 0;
  };
  return {
    append(text: string) {
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maximumBytes - totalBytes) throw new AppError(backupCapacityMessage, 413);
      totalBytes += bytes;
      pendingBytes += bytes;
      pending.push(text);
      if (pendingBytes >= 64 * 1024) flush();
    },
    finish() {
      flush();
      let index = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index === chunks.length) { controller.close(); return; }
          const chunk = chunks[index]!;
          chunks[index++] = null;
          controller.enqueue(chunk);
        },
        cancel() { chunks.length = 0; },
      });
    },
  };
}
