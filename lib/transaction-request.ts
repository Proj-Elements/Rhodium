type PendingCreation = { fingerprint: string; key: string };

const storageKey = "rhodium.pending-transaction-creations";
const maximumPending = 128;
const memoryPending = new Map<string, string>();
let storedPending: PendingCreation[] = [];

function readPending(): PendingCreation[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(stored)) storedPending = stored.filter((item): item is PendingCreation => Boolean(item && typeof item === "object" && typeof item.fingerprint === "string" && /^[a-f0-9]{64}$/.test(item.fingerprint) && typeof item.key === "string"));
  } catch { return storedPending; }
  return storedPending;
}

function persistPending() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(storedPending)); } catch { return; }
}

function creationUuid(): string {
  const browserCrypto = globalThis.crypto;
  if (!browserCrypto?.getRandomValues) throw new Error("当前浏览器无法生成安全的记账请求编号，请更换浏览器后重试");
  if (typeof browserCrypto.randomUUID === "function") return browserCrypto.randomUUID();
  const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function transactionCreationKey(payload: unknown): Promise<string> {
  const serialized = JSON.stringify(payload);
  const retained = memoryPending.get(serialized);
  if (retained) return retained;
  const fingerprint = globalThis.crypto?.subtle
    ? Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized))), (byte) => byte.toString(16).padStart(2, "0")).join("")
    : null;
  const requests = readPending();
  const existing = fingerprint ? requests.find((request) => request.fingerprint === fingerprint) : null;
  if (existing) {
    memoryPending.set(serialized, existing.key);
    return existing.key;
  }
  const unresolvedKeys = new Set([...requests.map((request) => request.key), ...memoryPending.values()]);
  if (unresolvedKeys.size >= maximumPending) throw new Error("未确认结果的记账请求过多，请先核对账本，再继续新建记录");
  const key = creationUuid();
  memoryPending.set(serialized, key);
  if (fingerprint) {
    storedPending = [...requests, { fingerprint, key }];
    persistPending();
  }
  return key;
}

export function confirmTransactionCreation(key: string): void {
  for (const [payload, pendingKey] of memoryPending) if (pendingKey === key) memoryPending.delete(payload);
  storedPending = readPending().filter((request) => request.key !== key);
  persistPending();
}
