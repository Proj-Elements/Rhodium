import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Lightweight liveness/readiness probe for the container healthcheck, which used
 * to hit /api/dashboard — that ran the full month aggregation plus a subscription
 * sync every 15 seconds. `SELECT 1` is enough to prove the pool is usable.
 *
 * Deliberately returns no version, schema or error detail: it is reachable by
 * anything that can reach the app.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
