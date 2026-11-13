import { badRequest } from "@/lib/errors";

export function historyPage(request: Request) {
  const query = new URL(request.url).searchParams;
  const rawLimit = query.get("limit") ?? "50";
  const rawCursor = query.get("cursor");
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) throw badRequest("历史每页条数必须是 1 到 200 的整数");
  if (rawCursor !== null && (!/^[1-9]\d*$/.test(rawCursor) || Number(rawCursor) > 2_147_483_647)) throw badRequest("历史分页游标无效");
  return { limit: Number(rawLimit), cursor: rawCursor === null ? null : Number(rawCursor) };
}
