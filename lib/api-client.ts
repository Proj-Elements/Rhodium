"use client";

/**
 * Shared fetch wrapper for client pages: parses JSON defensively, throws a
 * descriptive Error carrying the server message, and preserves cancellation
 * during both fetch and body consumption. Successful responses must contain a
 * JSON object; an unreadable body is never treated as an empty success.
 */
export async function apiFetch<T>(input: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(input, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (rest.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    if (response.ok) throw new Error("服务器返回的数据格式不正确");
  }
  rest.signal?.throwIfAborted();
  const isObject = typeof payload === "object" && payload !== null && !Array.isArray(payload);
  if (!response.ok) {
    const message = isObject && "error" in payload ? payload.error : null;
    throw new Error(typeof message === "string" && message ? message : "请求失败，请稍后再试");
  }
  if (!isObject) throw new Error("服务器返回的数据格式不正确");
  return payload as T;
}

/** Parse an error into a display message. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
