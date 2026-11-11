import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactSourcePolicy, inspectPackage, trustedArtifactRun, trustedArtifactSource, validateArchiveEntries, validateLicenseManifest } from "./ci-licensed.mjs";

test("licensed artifacts require the same repository, workflow and successful push", () => {
  const artifact = { expired: false, workflow_run: { id: 2 } };
  const current = { workflow_id: 3, repository: { id: 4 } };
  const run = { id: 2, event: "push", status: "completed", conclusion: "success", workflow_id: 3, repository: { id: 4 }, head_repository: { id: 4 }, head_branch: "main", head_sha: "a".repeat(40) };
  const policy = { defaultBranch: "main", prHeadSha: null };
  assert.equal(trustedArtifactRun(artifact, run, current, policy), true);
  for (const changed of [{ event: "pull_request" }, { conclusion: "failure" }, { status: "in_progress" }, { workflow_id: 99 }, { repository: { id: 99 } }, { head_repository: { id: 99 } }, { head_branch: "unmerged-other-task" }, { head_sha: undefined }]) assert.equal(trustedArtifactRun(artifact, { ...run, ...changed }, current, policy), false);
  assert.equal(trustedArtifactRun({ ...artifact, expired: true }, run, current, policy), false);
  assert.equal(trustedArtifactRun({ ...artifact, workflow_run: { id: 99 } }, run, current, policy), false);
  assert.equal(trustedArtifactRun(artifact, { ...run, workflow_id: undefined, repository: undefined, head_repository: undefined }, {}, policy), false);
});

test("a PR can bootstrap only from a push of its exact same-repository source SHA", () => {
  const repository = { id: 4, default_branch: "main" };
  const head = { sha: "b".repeat(40), repo: { id: 4 } };
  const policy = artifactSourcePolicy("pull_request", { repository, pull_request: { head } }, 4);
  assert.deepEqual(policy, { defaultBranch: "main", prHeadSha: head.sha });
  const current = { workflow_id: 3, repository: { id: 4 } };
  const run = { id: 2, event: "push", status: "completed", conclusion: "success", workflow_id: 3, repository: { id: 4 }, head_repository: { id: 4 }, head_branch: "codex/current-pr", head_sha: head.sha };
  const artifact = { expired: false, workflow_run: { id: 2 } };
  assert.equal(trustedArtifactRun(artifact, run, current, policy), true);
  assert.equal(trustedArtifactRun(artifact, { ...run, head_sha: "c".repeat(40) }, current, policy), false);
  assert.equal(trustedArtifactRun(artifact, { ...run, head_repository: { id: 99 } }, current, policy), false);
  const forkPolicy = artifactSourcePolicy("pull_request", { repository, pull_request: { head: { ...head, repo: { id: 99 } } } }, 4);
  assert.equal(forkPolicy.prHeadSha, null);
  assert.equal(trustedArtifactRun(artifact, run, current, forkPolicy), false);
});

test("merge queues accept default-branch artifacts and do not inherit PR source exceptions", () => {
  const event = { repository: { id: 4, default_branch: "main" }, pull_request: { head: { sha: "b".repeat(40), repo: { id: 4 } } } };
  const policy = artifactSourcePolicy("merge_group", event, 4);
  assert.deepEqual(policy, { defaultBranch: "main", prHeadSha: null });
  const current = { workflow_id: 3, repository: { id: 4 } };
  const pending = { event: "push", status: "in_progress", workflow_id: 3, repository: { id: 4 }, head_repository: { id: 4 }, head_branch: "main", head_sha: "a".repeat(40) };
  assert.equal(trustedArtifactSource(pending, current, policy), true);
  assert.equal(trustedArtifactSource({ ...pending, head_branch: "unmerged-other-task" }, current, policy), false);
  assert.deepEqual(artifactSourcePolicy("pull_request", { ...event, repository: { id: 99, default_branch: "main" } }, 4), { defaultBranch: null, prHeadSha: "b".repeat(40) });
});

test("licensed artifacts must match the exact lockfile and package bytes", () => {
  const archive = Buffer.from("licensed package");
  const manifest = { format: 1, packageName: "@heroui-pro/react", packageVersion: "1.0.0-beta.11", lockSha256: "lock", archiveSha256: createHash("sha256").update(archive).digest("hex") };
  assert.doesNotThrow(() => validateLicenseManifest(manifest, "lock", archive));
  assert.throws(() => validateLicenseManifest(manifest, "different-lock", archive));
  assert.throws(() => validateLicenseManifest(manifest, "lock", Buffer.from("altered")));
  assert.throws(() => validateLicenseManifest({ ...manifest, packageName: "another-package" }, "lock", archive));
});

test("archives cannot escape or replace package files through links", () => {
  assert.doesNotThrow(() => validateArchiveEntries(["react/", "react/package.json", "react/dist/index.d.ts"], ["drwxr-xr-x", "-rw-r--r--", "-rw-r--r--"]));
  for (const entry of ["../outside", "react/../../outside", "/react/package.json", "another/package.json", "react/with\\escape", "react/new\nline"]) assert.throws(() => validateArchiveEntries(["react/package.json", entry], ["-rw-r--r--", "-rw-r--r--"]));
  assert.throws(() => validateArchiveEntries(["react/package.json", "react/package.json"], ["-rw-r--r--", "-rw-r--r--"]));
  assert.throws(() => validateArchiveEntries(["react/package.json"], ["lrwxrwxrwx"]));
  assert.throws(() => validateArchiveEntries(["react/package.json"], ["hrw-r--r--"]));
});

test("installed packages allow regular nested dependencies but reject sensitive entries", () => {
  const root = mkdtempSync(join(tmpdir(), "rhodium-license-package-"));
  try {
    mkdirSync(join(root, "dist"));
    mkdirSync(join(root, "node_modules", "chalk"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@heroui-pro/react", version: "1.0.0-beta.11", types: "./dist/index.d.ts" }));
    writeFileSync(join(root, "dist", "index.d.ts"), "export {};\n");
    writeFileSync(join(root, "node_modules", "chalk", "package.json"), JSON.stringify({ name: "chalk", version: "5.6.2" }));
    assert.doesNotThrow(() => inspectPackage(root, "1.0.0-beta.11"));
    writeFileSync(join(root, "node_modules", "chalk", "private.pem"), "secret");
    assert.throws(() => inspectPackage(root, "1.0.0-beta.11"), /forbidden file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
