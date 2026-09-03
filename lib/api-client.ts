"use client";

/**
 * Shared fetch wrapper for client pages: parses JSON defensively, throws a
 * descriptive Error carrying the server message, and passes through
 * AbortController signals. Replaces the response.json().catch(() => ({}))
 * boilerplate repeated on every page.
 */
export async function apiFetch<T>(input: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(input, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" && payload.error ? payload.error : "请求失败，请稍后再试");
  }
  return payload as T;
}

/** Parse an error into a display message. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
