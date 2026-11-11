import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function databaseUrlFromEnv(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { PGHOST, PGDATABASE, PGUSER, PGPASSWORD } = env;
  if (!PGHOST || !PGDATABASE || !PGUSER || PGPASSWORD === undefined) {
    throw new Error("Set DATABASE_URL or PGHOST, PGDATABASE, PGUSER and PGPASSWORD");
  }
  const port = env.PGPORT ?? "5432";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("PGPORT must be a valid port number");
  const host = PGHOST.includes(":") && !PGHOST.startsWith("[") ? `[${PGHOST}]` : PGHOST;
  if (!/^[a-z\d.[\]:-]+$/i.test(host)) throw new Error("PGHOST must be a database hostname or IP address");
  let url;
  try {
    url = new URL(`postgresql://${host}:${port}/`);
  } catch {
    throw new Error("PGHOST must be a database hostname or IP address");
  }
  url.username = encodeURIComponent(PGUSER);
  url.password = encodeURIComponent(PGPASSWORD);
  url.pathname = `/${encodeURIComponent(PGDATABASE)}`;
  url.searchParams.set("schema", env.PGSCHEMA || "public");
  return url.toString();
}

function runNode(args, env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    let terminated = false;
    const handlers = ["SIGTERM", "SIGINT"].map((signal) => {
      const handler = () => {
        terminated = true;
        child.kill(signal);
      };
      process.on(signal, handler);
      return [signal, handler];
    });
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("exit", (code) => {
      cleanup();
      resolveResult({ code: code ?? 1, terminated });
    });
  });
}

async function main() {
  const env = { ...process.env, DATABASE_URL: databaseUrlFromEnv(process.env) };
  const migration = await runNode(["./node_modules/prisma/build/index.js", "migrate", "deploy"], env);
  if (migration.code !== 0 || migration.terminated) {
    process.exitCode = migration.code;
    return;
  }
  const server = await runNode(["server.js"], env);
  process.exitCode = server.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
