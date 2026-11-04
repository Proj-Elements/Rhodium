# Branch integration audit: 2026-11-05

## Scope and baseline

The user authorized committing and integrating all completed local branches into
`main`, then deleting the integrated branch refs and synchronizing to GitHub and
Entire. The actively edited `codex/ledger-redesign` branch is explicitly excluded.
All integration work takes place in an isolated Git worktree; the original
checkout and its staged, unstaged, untracked and ignored files are not modified.

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
| `codex/ledger-redesign` | `eca5ac8` | Protected: do not commit, merge, switch or delete this checkout or branch. |

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

## Outstanding remote delivery

- TODO: Synchronize the final integrated `main` to the authorized GitHub
  repository. This checkout has no Git remote, and no repository named Journal,
  yueyu or ledger was found in the authenticated account. Remove this item after
  confirming the destination, branch policies, shared ancestry, pushed SHA and
  current CI results. Do not invent a destination or force-push unrelated history.
- TODO: Synchronize to the authorized Entire repository and checkpoint backend.
  Entire status reports `enabled: false`, and Brain reports disconnected with no
  repository manifest. Remove this item only after the destination and any setup
  authorization are explicit, outgoing session sharing is audited, and the final
  history and applicable checkpoints are confirmed remotely. Do not silently
  enable hooks, create repositories or fabricate checkpoint trailers.
