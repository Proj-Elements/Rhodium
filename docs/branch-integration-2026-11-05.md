# Branch integration audit: 2026-11-05

## Scope and baseline

The user authorized committing and integrating all completed local branches into
`main`, then deleting the integrated branch refs and synchronizing to GitHub and
Entire. The actively edited `codex/ledger-redesign` branch was initially excluded;
the user subsequently confirmed completion and explicitly authorized its merge.
Integration takes place in an isolated Git worktree. The original checkout's
completed work is committed in coherent items; ignored files and live services
are preserved.

The initial `main` tip is `79a5dca9c34b519f001c228366d8eff5842ef9a3`.
The two other checked-out Freebuff branches are clean at that same commit; no
uncommitted work was found outside the protected redesign checkout.

| Branch | Initial tip | Integration decision |
| --- | --- | --- |
| `docs/skill-best-practices` | `f3439c2` | Retain reimbursement feature and API skill changes. |
| `freebuff/task-62c57073-25ce-42f6-8270-0f3b3760e12b` | `5f76d22` | Retain parent feature; complete the strict reimbursement undo contract. |
| `freebuff/task-ef26fe8d-1ae9-404f-ab82-eece49fe63ad` | `20aa35f` | Merge with the conflict decisions below. |
| `freebuff/hi-0cb3714c-4fdb-4ab2-ba66-bfdff263ffdb` | `79a5dca` | Already contained in the initial main history. |
| `freebuff/task-9c01e1a1-8883-4a30-bdba-c95a014c1a0f` | `79a5dca` | Already contained in the initial main history; preserve its worktree. |
| `freebuff/who-ar-3d573f00-1902-4530-af32-d57e75455d96` | `79a5dca` | Already contained in the initial main history; preserve its worktree. |
| `codex/ledger-redesign` | `eca5ac8` | Subsequently authorized; preserve its complete UI and category-icon contracts alongside main's reimbursement behavior. |

Existing Freebuff snapshot tags and other non-branch checkpoint refs are retained.

## Required integration repairs

- `5f76d22` exports a strict undo schema without an API handler. Complete
  `{ unreimburse: true }` without editing amount, date or category, and enforce
  existing income, soft-delete and locked-month restrictions.
- Reimbursement action keys must not fall through to the full-edit schema,
  which strips unknown fields. Mixed actions and edits now return 400.
- Restore a deleted expense's reimbursement timestamp from JSON backups; deleting
  a row must not erase its accounting facts. Income rows still discard stamps.
- Keep preview and import validation consistent for reimbursement timestamps.
- Allow bounded import batches to carry archives with more than 20,000 rows;
  the executed row batch remains capped and the request remains limited to 8 MB.
- Return the promised `outOfPocketCents` dashboard field and document the distinct
  gross-expense and out-of-pocket meanings in monthly summaries.

The reimbursement regressions were reproduced before the fixes. The repair is
committed as `cc16a0204da308f7d410c0e77a442892e20d71c0`.

## Older WIP conflict decisions

- Keep the current `app/error.tsx` and `app/not-found.tsx`: their layout-compatible
  boundaries already implement the old branch's intent, while the WIP contains
  unclosed JSX and an unused import.
- Keep the current subscription cache: it retains successful results, retries
  failures and supports explicit invalidation. The old reset patch would replace
  that implementation with obsolete state variables.
- Keep the current batch budget and summary resolution. The WIP references the
  removed `resolveBudgetCents` helper and would drop batching and reimbursement
  math, whereas the current implementation already inherits preset budgets.
- Retain the old `saveMonthlyBudget` helper with create, update and zero-budget
  regression coverage.
- Retain the local JetBrains Mono font declaration, but omit the missing WOFF2
  URL because the old snapshot does not contain that asset.

## Local verification

Verification uses isolated dependencies and a disposable PostgreSQL 16 container
bound to loopback with its data held in tmpfs. No development or production
database is used. The five migrations deploy successfully, including the
reimbursement column.

- `npm test -- lib/summary.test.ts lib/validation.test.ts lib/serializers.test.ts
  lib/import-parser.test.ts`: 89 relevant unit tests pass.
- `npm run test:db -- tests/integration/reimburse.test.ts
  tests/integration/budget.test.ts tests/integration/performance.test.ts`, plus
  the affected subscription-sync module and transaction/restore/locked-month
  cases in route-validation: 66 distinct relevant integration cases pass after
  the new budget-helper coverage is included. Other cases are not a global test
  run and are not claimed as verified.
- Focused ESLint checks, TypeScript contract checks and `git diff --check` pass.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` passes against the disposable database.
- TypeScript parsing reproduces three syntax errors in each legacy WIP boundary;
  both resolved boundary files have zero syntax errors.

No version tag, release or deployment is created by this maintenance task.
Remote CI and remote synchronization are not local-verification results.

## Completed redesign integration

The source checkout's remaining work is recorded in signed Codex commits
`2ab8df8` (settlement/import protection), `cde9bb8` (complete UI), and `9dec444`
(secret-mounted container initialization). All source files are now committed.
The merge retains strict reimbursement/undo, soft-delete backup stamps, batched
summary/cache behavior, and the category-icon migration. HeroUI dialogs now expose
both reimbursement actions without submitting a browser navigation.

A settlement records gross expenses and net remaining. The dashboard recovers
net budget consumption from the captured budget/remaining, not from a subsequently
changed preset; no-budget snapshots subtract the protected reimbursement total.
Monthly review keeps gross expenses and separately reports self-paid amounts.
The new regression covers reimbursing, settling with/without a budget, changing
the preset, rejecting locked undo, reopening, and undoing reimbursement.

On the integrated source: 146 tests in 11 affected unit modules and 54 tests in
four database modules pass. Typecheck and focused ESLint pass. All six migrations
deploy only to the disposable test database. These are local results, not CI or
production evidence.

The integrated production build passes. Browser checks use a separate
`rhodium_preview` database with four synthetic transactions, at 1440x1000 and
360x640 in both themes. Reimbursement/undo update the displayed totals without
navigation, cancel restores focus, the mobile dialog stays inside the viewport,
and dashboard/review distinguish gross 115.00, self-paid 85.00 and reimbursed
30.00. No browser warnings/errors were captured. Evidence screenshot:
`/tmp/rhodium-mobile-reimbursement-20261105.jpg` (local artifact, not ledger data).

The Node 22.23.4 Alpine container builds using a BuildKit-only license secret.
It starts as uid 1000, applies/checks all six migrations on the disposable preview
database, returns healthy API/page responses, reads the same synthetic fixture,
and shuts down with exit 0. The complete final image archive, metadata and history
contain no supplied key; the runtime has no license environment/secret file or
`.env`. This is local arm64 container evidence, not multi-platform or deployment
proof. The existing `journal-app-1` on 3030 remains unchanged.

## Scoped CI

The existing `CI / verify` entry point is retained. Node and Actions are pinned;
permissions are read-only, with timeouts/concurrency. Ordinary pushes compare
their previous SHA, PRs their target merge base, and merge queues their candidate
base. A new repository uses the audited pre-integration main `7552cd5` as its
explicit bootstrap, failing if unavailable. Renames/deletions keep source paths
for Vitest dependency-graph selection; present changed source is linted. Shared
tooling/schema changes add explicit accounting contract modules, not the global
suite. Seven Node selector tests and 103 tests in five tooling-contract modules
pass locally. Global suites are restricted to new version-tag events; this task
creates no version tag.

Only trusted repository push builds receive `HEROUI_KEY`. PR/queue code does not
receive the key; licensed type/build checks explicitly fail until a trusted
artifact channel exists rather than silently skipping required verification.
No PR or queue requirement is currently configured for this empty private repo.

## Remote Delivery State

The authorized GitHub destination is `git@github.com:Proj-Elements/Rhodium.git`;
Entire `origin` is `entire://aws-ap-southeast-1.entire.io/et/elements/rhodium`.
Both initially have no branch heads. SSH port 22 is unavailable; authenticated
HTTPS works through a per-command rewrite without changing the configured URL.
GitHub private-repository protections/rulesets are unavailable on its current
plan (403); no policy was removed or bypassed.

HeroUI initialization was verified by a fresh, non-cache download using pinned
`hpsetup@4.7.4`; package/lock content is unchanged. `HEROUI_KEY` exists as a
repository Actions Secret. No key is stored in tracked files or Docker arguments.

- TODO(delivery): Complete the integrated build, rendered/container checks,
  scoped Actions checks for the exact pushed SHA, and synchronization of one
  final main history to both destinations. Remove after remote alignment and
  safe branch-ref cleanup are verified; do not deploy the production service.
- TODO(traceability): Entire is enabled, but Codex hook trust approval is missing
  and this session has no Entire session state. Outgoing checkpoint inventory is
  empty. Code synchronization cannot create the missing capture retroactively;
  the user must review hook trust for future sessions. Do not fabricate trailers,
  amend commits, enable hooks or upload this secret-bearing session manually.

## Dependency Risk Boundary

The refreshed lockfile audit reports 12 advisories: 4 high and 8 moderate, no
critical. Existing tracked security TODOs cover Zod 3 (a major-version migration
is needed), HeroUI install-tool figlet, ESLint/minimatch and Vitest/mocker. This
branch-integration task does not bundle those independent dependency migrations.
The app stays loopback-only; local checks and source synchronization do not
authorize a release or public deployment, nor establish these issues as fixed.
