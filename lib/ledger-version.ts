import { conflict } from "@/lib/errors";

/** Preserve audit ordering without overflowing a PostgreSQL Int after restore. */
export function nextLedgerVersion(current: number, label: string): number {
  if (current >= 2_147_483_647) throw conflict(`${label}版本已达上限，无法继续修改；请保留完整备份`);
  return current + 1;
}
