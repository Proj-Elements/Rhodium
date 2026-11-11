import type { NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function configuredValues(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

export function requestSecurityError(request: NextRequest): string | null {
  const host = request.headers.get("host") || request.nextUrl.host;
  let target: URL;
  try {
    if (!/^[a-z\d.[\]:-]+$/i.test(host)) return "请求的主机地址无效";
    target = new URL(`${request.nextUrl.protocol}//${host}`);
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      return "请求的主机地址无效";
    }
  } catch {
    return "请求的主机地址无效";
  }
  const allowedHosts = configuredValues("RHODIUM_ALLOWED_HOSTS").map((value) => value.toLowerCase());
  if (!LOCAL_HOSTS.has(target.hostname.toLowerCase()) && !allowedHosts.includes(target.hostname.toLowerCase()) && !allowedHosts.includes(target.host.toLowerCase())) {
    return "主机未获允许，请配置 RHODIUM_ALLOWED_HOSTS";
  }

  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return "拒绝跨站访问账本";
  const origin = request.headers.get("origin");
  if (origin) {
    let source: URL;
    try {
      source = new URL(origin);
    } catch {
      return "请求来源与账本地址不一致";
    }
    if (!/^https?:$/.test(source.protocol) || source.origin !== origin || source.username || source.password || source.host !== target.host || ![target.origin, ...configuredValues("RHODIUM_ALLOWED_ORIGINS")].includes(origin)) {
      return "请求来源与账本地址不一致";
    }
  }
  const hasFetchMetadata = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"].some((name) => request.headers.has(name));
  if (hasFetchMetadata && site !== "same-origin" && site !== "none") return "浏览器请求来源信息不完整";
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && hasFetchMetadata && (site !== "same-origin" || !origin)) {
    return "浏览器写入必须携带同源 Origin";
  }
  return null;
}

function validClientIp(value: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value.split(".").every((part) => Number(part) <= 255);
  if (!value.includes(":") || value.length > 45 || !/^[\da-f:.]+$/i.test(value)) return false;
  try {
    return Boolean(new URL(`http://[${value}]/`).hostname);
  } catch {
    return false;
  }
}

export function rateLimitClientKey(request: NextRequest): string {
  if (process.env.RHODIUM_TRUST_PROXY !== "true") return "local";
  const forwarded = request.headers.get("x-forwarded-for")?.trim().toLowerCase();
  return forwarded && validClientIp(forwarded) ? forwarded : "local";
}
