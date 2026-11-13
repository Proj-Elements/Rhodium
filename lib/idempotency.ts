import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { badRequest, conflict } from "@/lib/errors";

export function creationIdentity(request: Request, scope: string, value: unknown) {
  const key = request.headers.get("idempotency-key");
  if (key !== null && !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw badRequest("Idempotency-Key 应为 8 到 128 位字母、数字或 ._:-");
  return { key: key ? `${scope}:${key}` : null, requestHash: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}

export async function replayCreation(tx: Prisma.TransactionClient, identity: ReturnType<typeof creationIdentity>, legacyKey?: string | null) {
  if (!identity.key) return null;
  const existing = await tx.creationRequest.findUnique({ where: { key: identity.key } })
    ?? (legacyKey ? await tx.creationRequest.findUnique({ where: { key: legacyKey } }) : null);
  if (existing && existing.requestHash !== identity.requestHash) throw conflict("此 Idempotency-Key 已用于另一项内容，请重新生成后再提交");
  return existing?.response ?? null;
}
