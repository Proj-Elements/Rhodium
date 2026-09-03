import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await syncSubscriptions());
  } catch (error) {
    return handleApiError(error);
  }
}
