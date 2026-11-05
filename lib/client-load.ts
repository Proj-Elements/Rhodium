import { errorMessage } from "@/lib/api-client";

type LoadOptions<T> = {
  signal: AbortSignal;
  work: () => Promise<T>;
  success: (value: T) => void;
  failure: (message: string) => void;
  finished: () => void;
  fallback: string;
};

/** Run one effect-owned read; cancelled effects must not publish any state. */
export async function runClientLoad<T>({ signal, work, success, failure, finished, fallback }: LoadOptions<T>): Promise<void> {
  try {
    const value = await work();
    if (!signal.aborted) success(value);
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
    failure(errorMessage(error, fallback));
  } finally {
    if (!signal.aborted) finished();
  }
}

/** Mutations require a successful read of exactly the currently displayed month. */
export function isCurrentMonthReady(month: string, loadedMonth: string | null | undefined, loading: boolean, error: string): boolean {
  return Boolean(month && loadedMonth === month && isClientDataReady(loading, error));
}

/** Never present a failed read as an empty, writable collection. */
export function isClientDataReady(loading: boolean, error: string): boolean {
  return !loading && !error;
}
