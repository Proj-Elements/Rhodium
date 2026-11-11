import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "@heroui-pro/react";
const maxArchiveBytes = 128 * 1024 * 1024;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const licenseDirectory = () => resolve(process.env.RUNNER_TEMP || tmpdir(), "rhodium-license");

export function validateArchiveEntries(entries, detailedEntries) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || /[\\\x00-\x1f\x7f]/.test(entry) || isAbsolute(entry) || entry.split("/").includes("..") || (entry !== "react" && !entry.startsWith("react/")) || seen.has(entry)) throw new Error("Licensed archive contains an unsafe path");
    seen.add(entry);
  }
  if (!seen.has("react/package.json") || detailedEntries.some((entry) => !/^[d-]/.test(entry))) throw new Error("Licensed archive must contain only package files and directories");
}

export function validateLicenseManifest(manifest, lockSha256, archive) {
  if (!manifest || manifest.format !== 1 || manifest.packageName !== packageName || manifest.lockSha256 !== lockSha256 || typeof manifest.packageVersion !== "string" || manifest.archiveSha256 !== sha256(archive)) throw new Error("Licensed artifact does not match this lockfile or archive");
}

export function artifactSourcePolicy(eventName, event, repositoryId) {
  const defaultBranch = event.repository?.id === repositoryId && typeof event.repository.default_branch === "string" ? event.repository.default_branch : null;
  const prHeadSha = eventName === "pull_request" && event.pull_request?.head?.repo?.id === repositoryId && /^[0-9a-f]{40}$/.test(event.pull_request.head.sha || "") ? event.pull_request.head.sha : null;
  return { defaultBranch, prHeadSha };
}

export function trustedArtifactSource(run, currentRun, policy) {
  if (!Number.isSafeInteger(currentRun.repository?.id) || currentRun.repository.id <= 0 || !Number.isSafeInteger(currentRun.workflow_id) || currentRun.workflow_id <= 0) return false;
  if (run.event !== "push" || run.workflow_id !== currentRun.workflow_id || run.repository?.id !== currentRun.repository.id || run.head_repository?.id !== currentRun.repository.id || !/^[0-9a-f]{40}$/.test(run.head_sha || "")) return false;
  return Boolean((policy.defaultBranch && run.head_branch === policy.defaultBranch) || (policy.prHeadSha && run.head_sha === policy.prHeadSha));
}

export function trustedArtifactRun(artifact, run, currentRun, policy) {
  return artifact.expired === false && artifact.workflow_run?.id === run.id && run.status === "completed" && run.conclusion === "success" && trustedArtifactSource(run, currentRun, policy);
}

export function inspectPackage(root, expectedVersion) {
  if (lstatSync(root).isSymbolicLink()) throw new Error("Licensed package root cannot be a symlink");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (manifest.name !== packageName || manifest.version !== expectedVersion || typeof manifest.types !== "string") throw new Error("Licensed package metadata differs from the lockfile");
  const types = resolve(root, manifest.types);
  if (relative(root, types).startsWith("..") || !existsSync(types) || relative(realpathSync(root), realpathSync(types)).startsWith("..")) throw new Error("Licensed package types are missing or unsafe");
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || /\.(?:pem|key)$/i.test(entry.name)) throw new Error("Licensed package contains a forbidden file");
      if (entry.isDirectory()) pending.push(join(directory, entry.name));
      else if (!entry.isFile()) throw new Error("Licensed package contains a non-regular file");
    }
  }
  return manifest;
}

function lockMetadata() {
  const bytes = readFileSync("package-lock.json");
  const lock = JSON.parse(bytes.toString("utf8"));
  const version = lock.packages?.[`node_modules/${packageName}`]?.version;
  if (typeof version !== "string") throw new Error("The lockfile does not identify the licensed package");
  return { lockSha256: sha256(bytes), version };
}

function prepare() {
  if (process.env.HEROUI_KEY) throw new Error("Package archiving must run outside the license-secret step");
  const { lockSha256, version } = lockMetadata();
  const root = resolve("node_modules", packageName);
  inspectPackage(root, version);
  const directory = licenseDirectory();
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const archivePath = join(directory, "heroui-react.tgz");
  execFileSync("tar", ["-czf", archivePath, "-C", dirname(root), "react"]);
  const archive = readFileSync(archivePath);
  if (archive.byteLength > maxArchiveBytes) throw new Error("Licensed package artifact is unexpectedly large");
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ format: 1, packageName, packageVersion: version, lockSha256, archiveSha256: sha256(archive) }));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `name=heroui-react-${lockSha256}\n`);
}

async function api(path) {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("A read-only Actions token is required to retrieve licensed artifacts");
  const response = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub Actions lookup failed (${response.status})`);
  return response.json();
}

async function downloadArchive(repository, artifactId) {
  const response = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repository}/actions/artifacts/${artifactId}/zip`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (response.status !== 302) throw new Error(`GitHub artifact download failed (${response.status})`);
  const location = response.headers.get("location");
  if (!location || new URL(location).protocol !== "https:") throw new Error("GitHub returned an unsafe artifact location");
  const archiveResponse = await fetch(location, { signal: AbortSignal.timeout(60_000) });
  if (!archiveResponse.ok || !archiveResponse.body) throw new Error(`Artifact storage download failed (${archiveResponse.status})`);
  const chunks = [];
  let received = 0;
  for await (const bytes of archiveResponse.body) {
    received += bytes.byteLength;
    if (received > maxArchiveBytes) throw new Error("Licensed artifact exceeds the download limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function restore() {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "") || !/^\d+$/.test(runId || "")) throw new Error("GitHub repository and current run identity are required");
  const { lockSha256, version } = lockMetadata();
  const name = `heroui-react-${lockSha256}`;
  const currentRun = await api(`/repos/${repository}/actions/runs/${runId}`);
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const policy = artifactSourcePolicy(process.env.GITHUB_EVENT_NAME, event, currentRun.repository?.id);
  if (!policy.defaultBranch) throw new Error("The GitHub event does not identify this repository's trusted default branch");
  let artifact;
  for (let attempt = 0; attempt < 10 && !artifact; attempt += 1) {
    const listing = await api(`/repos/${repository}/actions/artifacts?name=${name}&per_page=100`);
    let pending = false;
    for (const candidate of listing.artifacts ?? []) {
      if (candidate.name !== name || candidate.expired || !candidate.workflow_run?.id) continue;
      const run = await api(`/repos/${repository}/actions/runs/${candidate.workflow_run.id}`);
      if (trustedArtifactRun(candidate, run, currentRun, policy)) { artifact = candidate; break; }
      if (trustedArtifactSource(run, currentRun, policy) && run.status !== "completed") pending = true;
    }
    if (!artifact && (!pending || attempt === 9)) throw new Error("No successful trusted push has published licensed UI for this exact lockfile. Complete that push before retrying this UI check.");
    if (!artifact) await new Promise((resolveWait) => setTimeout(resolveWait, 15_000));
  }
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "rhodium-license-restore-"));
  try {
    const zipPath = join(directory, "artifact.zip");
    writeFileSync(zipPath, await downloadArchive(repository, artifact.id));
    const members = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim().split("\n").sort();
    if (members.length !== 2 || members[0] !== "heroui-react.tgz" || members[1] !== "manifest.json") throw new Error("Licensed artifact has unexpected members");
    const manifest = JSON.parse(execFileSync("unzip", ["-p", zipPath, "manifest.json"], { encoding: "utf8", maxBuffer: 1024 * 1024 }));
    const archive = execFileSync("unzip", ["-p", zipPath, "heroui-react.tgz"], { maxBuffer: maxArchiveBytes });
    validateLicenseManifest(manifest, lockSha256, archive);
    if (manifest.packageVersion !== version) throw new Error("Licensed artifact package version differs from this lockfile");
    const archivePath = join(directory, "package.tgz");
    writeFileSync(archivePath, archive);
    const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim().split("\n");
    const details = execFileSync("tar", ["-tvzf", archivePath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim().split("\n");
    validateArchiveEntries(entries, details);
    execFileSync("tar", ["-xzf", archivePath, "--no-same-owner", "--no-same-permissions", "-C", directory]);
    const extracted = join(directory, "react");
    inspectPackage(extracted, version);
    const target = resolve("node_modules", packageName);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    renameSync(extracted, target);
    console.log(`Restored licensed UI from successful push run ${artifact.workflow_run.id}, lockfile ${lockSha256}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "prepare") prepare();
  else if (process.argv[2] === "restore") await restore();
  else throw new Error("Expected prepare or restore");
}
