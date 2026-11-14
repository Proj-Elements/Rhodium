import { NextResponse, type NextRequest } from "next/server";
import { guardRequest } from "@/lib/request-guard";

export async function middleware(request: NextRequest) {
  const guard = await guardRequest(request);
  if (guard.response) return guard.response;
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(guard.headers)) response.headers.set(key, value);
  return response;
}

export const config = {
  // Import handlers apply guardRequest themselves before reading their body.
  // Middleware clones and truncates bodies at 10 MiB in this Next.js version.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/import(?:/preview)?/?$).*)"],
};
