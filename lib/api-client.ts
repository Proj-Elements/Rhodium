"use client";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Fetch an object response with a bounded wait; cancellation never implies a server rollback. */
export async function apiFetch<T>(input: string, init?: RequestInit & { json?: unknown; timeoutMs?: number }): Promise<T> {
  const { json, timeoutMs = 30_000, signal: callerSignal, ...rest } = init ?? {};
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  const mutation = Boolean(rest.method && !["GET", "HEAD"].includes(rest.method.toUpperCase()));
  const timer = setTimeout(() => controller.abort(new DOMException(mutation
    ? "请求超时，保存结果尚未确认。请重新读取账本核对后再操作。"
    : "请求超时，请稍后重试。", "TimeoutError")), timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const response = await abortable(fetch(input, {
      ...rest,
      signal: controller.signal,
      headers: json !== undefined ? { "Content-Type": "application/json", ...Object.fromEntries(new Headers(rest.headers)) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    }), controller.signal);
    let payload: unknown;
    try {
      payload = await abortable(response.json(), controller.signal);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (response.ok) throw new Error("服务器返回的数据格式不正确");
    }
    controller.signal.throwIfAborted();
    const objectPayload = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
    if (!response.ok) {
      const message = objectPayload?.error;
      throw new ApiError(typeof message === "string" && message ? message : "请求失败，请稍后再试", response.status);
    }
    if (!objectPayload) throw new Error("服务器返回的数据格式不正确");
    return payload as T;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TypeError) throw new Error(mutation
      ? "无法连接账本，保存结果尚未确认。请重新读取账本核对后再操作。"
      : "无法连接账本，请检查连接后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
}

/** Parse an error into a display message. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
