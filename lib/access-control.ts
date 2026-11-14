export type AccessDecision = { status: 401 | 503; message: string } | null;

/** Compare fixed-size hashes without leaking which token character differs. */
async function sameSecret(actual: string, expected: string): Promise<boolean> {
  const encode = new TextEncoder();
  const [left, right] = await Promise.all([actual, expected].map((value) => crypto.subtle.digest("SHA-256", encode.encode(value))));
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

/** A single shared token protects the entire ledger; it is not a multi-user model. */
export async function accessDecision(request: Request, token = process.env.RHODIUM_ACCESS_TOKEN): Promise<AccessDecision> {
  if (["GET", "HEAD"].includes(request.method) && new URL(request.url).pathname === "/api/health") return null;
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
    return { status: 503, message: "请先配置 RHODIUM_ACCESS_TOKEN（32–256 位字母、数字、下划线或短横线）" };
  }
  const header = request.headers.get("authorization") ?? "";
  let supplied = "";
  if (header.startsWith("Bearer ")) supplied = header.slice(7);
  else if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      if (decoded.startsWith("rhodium:")) supplied = decoded.slice(8);
    } catch { /* Invalid credentials receive the same challenge as missing credentials. */ }
  }
  if (supplied.length <= 256 && await sameSecret(supplied, token)) return null;
  return { status: 401, message: "需要账本访问凭据" };
}
