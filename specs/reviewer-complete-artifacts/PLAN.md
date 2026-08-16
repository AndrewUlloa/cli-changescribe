# Plan: Reviewer-Complete Artifacts and Durable History

> Derived from: `specs/reviewer-complete-artifacts/SPEC.md`
> Status: approved
> Last updated: 2026-08-16

## Overview

Build the reviewer-complete workflow as small vertical slices. Deterministic
facts and invariants land first, then model orchestration, semantic title policy,
init/configuration, squash merging, documentation, and final dogfood. Every
slice is tested and committed through `npm run commit` before the next begins.

## Architecture Decisions

- **Decision:** Completeness is a PR-only deterministic invariant.
  **Rationale:** Commit subjects should stay adaptive; PRs must account for the full branch.
- **Decision:** Preserve supported optional content and replace only a rejected primary.
  **Rationale:** The current whole-draft fallback caused PR #20's information loss.
- **Decision:** Build a pure change map and render aggregate category totals locally.
  **Rationale:** Every file is accounted for without turning large PRs into path dumps.
- **Decision:** Keep semantic-domain labels in the evaluation oracle only.
  **Rationale:** Runtime rules remain language-agnostic and do not leak test labels to the model.
- **Decision:** Configuration tailors scopes/context/merge workflow but cannot weaken safety.
  **Rationale:** Grounding and coverage are product correctness, not style preferences.
- **Decision:** Keep issue-body fetching, DCO, mandatory signatures, and Changesets out of this release.
  **Rationale:** They add network, legal, admin, or release ceremony without solving the current message defect.

Non-decisions:

- Rejected: a `compact|normal|verbose` switch. It would make completeness optional.
- Rejected: returning to per-commit PR summaries. Intermediate history is not final behavior.
- Rejected: another unconditional prose-polish provider pass. It adds latency and cannot prove truth.
- Rejected: raw gate-output inclusion. It creates a high-risk evidence-egress boundary.

## Dependency Graph

```text
[primary preservation]
        │
        ├──▶ [change map] ──▶ [PR coverage]
        │                         │
        └─────────────────────────┴──▶ [context sections + validation]
                                           │
[semantic title rules] ────────────────────┤
                                           ▼
                              [repository policy v2]
                                           │
                              ┌────────────┴────────────┐
                              ▼                         ▼
                         [guided init]             [safe squash merge]
                              └────────────┬────────────┘
                                           ▼
                              [docs, review, dogfood]
```

## Task List

### Phase 1: Preserve and Account

- [x] **Task 1: Preserve supported content during primary repair**
  - **Description:** Return a typed primary-rejected critic result, retain only supported optional claims/trailers, generate and criticize one minimal replacement, then merge and reparse without changing retained bytes.
  - **Acceptance:**
    - [x] Supported optional content survives byte-for-byte.
    - [x] Unsupported optional content remains removed.
    - [x] Normal requests remain 2; primary repair is 4; maximum stays <=5.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/artifact-critic.test.js .test-dist/workflow-byok.test.js`
  - **Depends on:** None
  - **Files:** `src/artifact-critic.ts`, `src/pr-workflow.ts`, `test/artifact-critic.test.ts`, `test/workflow-byok.test.ts`
  - **Size:** M

- [x] **Task 2: Build the deterministic change map**
  - **Description:** Add a pure classifier for implementation, tests, documentation, configuration, and other changes with exact counts, statuses, rename handling, stable ordering, and safe paths.
  - **Acceptance:**
    - [x] Every changed file is classified exactly once.
    - [x] Known additions/deletions sum exactly; unknown/binary data remains explicit.
    - [x] Input ordering cannot change output.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/change-map.test.js`
  - **Depends on:** None
  - **Files:** `src/change-map.ts`, `test/change-map.test.ts`, `test/typescript-migration.test.ts`, `test/distribution.test.ts`
  - **Size:** M

- [x] **Task 3: Render reviewer-scale change accounting**
  - **Description:** Render critic-supported change claims plus deterministic aggregate category totals under Changes, with GitHub body-size enforcement and safe Markdown.
  - **Acceptance:**
    - [x] Empty groups disappear; non-empty totals render deterministically.
    - [x] Large PRs do not require one bullet per path.
    - [x] Unsafe paths cannot escape rendering and oversized bodies fail closed.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/artifact-renderer.test.js`
  - **Depends on:** Task 2
  - **Files:** `src/artifact-renderer.ts`, `test/artifact-renderer.test.ts`
  - **Size:** S

### Checkpoint: Preservation and Accounting

- [x] Focused tests pass
- [x] Full `npm test` passes
- [x] One commit per task exists
- [x] No provider-request increase on the normal path

### Phase 2: Enforce Reviewer Completeness

- [x] **Task 4: Enforce substantive PR claim coverage**
  - **Description:** Require critic-supported observed change claims to cover every substantive change evidence ID; add a safe `change-coverage` repair category and block output/mutation if criticism reopens a gap.
  - **Acceptance:**
    - [x] Runtime substantive evidence coverage is 100%.
    - [x] Supporting docs/tests/config remain accounted by the map without forced prose.
    - [x] Docs-only/test-only PRs remain valid.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/artifact-completeness.test.js .test-dist/workflow-byok.test.js`
  - **Depends on:** Tasks 1–3
  - **Files:** `src/artifact-completeness.ts`, `src/artifact-draft.ts`, `test/artifact-completeness.test.ts`, `test/workflow-byok.test.ts`, inventory tests
  - **Size:** M

- [x] **Task 5: Add supported reviewer-context sections**
  - **Description:** Add problem, compatibility/preserved-behavior, and non-goal contracts requiring explicit intent/constraint evidence; render the approved section order and rename visible Verification to Validation.
  - **Acceptance:**
    - [x] Unsupported context cannot render.
    - [x] Empty optional sections remain absent.
    - [x] Summary contains the solution and at most one provided problem statement.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/artifact-draft.test.js .test-dist/artifact-renderer.test.js .test-dist/change-evidence.test.js`
  - **Depends on:** Task 4
  - **Files:** `src/change-evidence.ts`, `src/artifact-draft.ts`, `src/artifact-renderer.ts`, related focused tests
  - **Size:** M

- [x] **Task 6: Add bounded structured validation results**
  - **Description:** Extend receipts with optional typed numeric results/limitations and registered bounded parsers; raw gate output is re-emitted locally but never enters evidence or provider requests.
  - **Acceptance:**
    - [x] Recognized TAP totals render exactly.
    - [x] Unrecognized output renders command/status/duration without invented counts.
    - [x] Failed receipts block success; skipped receipts carry a typed reason.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/gate-receipts.test.js .test-dist/artifact-renderer.test.js .test-dist/security.test.js`
  - **Depends on:** Task 3
  - **Files:** `src/change-evidence.ts`, `src/gate-receipts.ts`, `test/gate-receipts.test.ts`, `test/artifact-renderer.test.ts`, `test/security.test.ts`
  - **Size:** M

### Checkpoint: Reviewer-Complete PR

- [x] Mixed PR fixture renders Summary, Changes, deterministic totals, and Validation
- [x] Unsupported context and incomplete substantive coverage fail before output/GitHub
- [x] Request ceilings remain green
- [x] Full `npm test` passes

### Phase 3: Semantic Titles and Durable History

- [x] **Task 7: Validate semantic Conventional Commit types and scopes**
  - **Description:** Remove literal-`fix` and scope-erasing repair bias; define local semantic type rules, optional high-confidence scope behavior, and critic candidates for title type/scope.
  - **Acceptance:**
    - [x] Docs/test/CI/build/refactor/perf/feat/fix fixtures accept only supported types.
    - [x] Plans/changelogs cannot default to `fix`.
    - [x] Valid type/scope survive primary repair; broad changes may remain unscoped.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/title-semantics.test.js .test-dist/commit-v2.test.js .test-dist/workflow-byok.test.js`
  - **Depends on:** Task 1
  - **Files:** semantic title module/test, `src/commit.ts`, `src/pr-workflow.ts`, critic integration tests
  - **Size:** M

- [x] **Task 8: Add squash-title validation and safe merge command**
  - **Description:** Add a project command that resolves the current PR, pins repository/head/title/check state, validates the PR title through the same policy, and requests an explicit squash merge using the immutable reviewed SHA.
  - **Acceptance:**
    - [x] Ambient repository, branch, or title cannot control mutation.
    - [x] Non-green checks, stale head, invalid title, or unresolved required review blocks merge.
    - [x] Fine-grained feature commits become one main commit through the supported path.
  - **Verify:** focused merge command tests plus packed CLI routing/distribution tests
  - **Depends on:** Task 7
  - **Files:** merge application service/test, `src/arguments.ts`, `src/cli.ts`, routing tests
  - **Size:** M

- [ ] **Task 9: Add PR-title CI protection**
  - **Description:** Validate titles on pull-request events with the same local parser/policy so hand edits cannot bypass generation.
  - **Acceptance:**
    - [ ] Invalid type/scope/length/breaking syntax fails CI.
    - [ ] Workflow uses fixed event data and no secrets.
  - **Verify:** workflow contract test and local title-check fixture
  - **Depends on:** Task 7
  - **Files:** title-check CLI/test, `.github/workflows/ci.yml`, CI contract test
  - **Size:** M

### Checkpoint: Durable History

- [x] Conventional title corpus passes
- [x] Safe merge mutation tests pass
- [ ] CI title validation passes locally
- [x] Full `npm test` and package dry run pass

### Phase 4: Policy and Guided Init

- [ ] **Task 10: Add revision-pinned repository policy v2**
  - **Description:** Accept v1 unchanged and add bounded v2 title, issue-context, merge, and PR-template preferences; reject unknown safety-disabling keys.
  - **Acceptance:**
    - [ ] V1 behavior is byte-compatible.
    - [ ] V2 is strictly parsed, frozen, pinned, and protected from provider egress.
    - [ ] Grounding/critic/coverage cannot be configured off.
  - **Verify:** `npm run build && npm run build:test && node --test .test-dist/repository-policy.test.js`
  - **Depends on:** Tasks 7–9
  - **Files:** `src/repository-policy.ts`, schema, policy tests, distribution/npm-page tests
  - **Size:** M

- [ ] **Task 11: Add reviewer-complete init questions and planning**
  - **Description:** Detect safe scope suggestions, ask scope/context/merge/template preferences, preview config/template/script/agent changes, and preserve headless safe defaults.
  - **Acceptance:**
    - [ ] `--yes` never invents scopes or weakens safety.
    - [ ] Existing custom config/templates/scripts are preserved.
    - [ ] Second identical run changes no bytes or mtimes.
  - **Verify:** focused init/project/setup-file test matrix
  - **Depends on:** Task 10
  - **Files:** `src/init.ts`, setup planner/transformer, init/project tests
  - **Size:** M

- [ ] **Task 12: Generate repository workflow guidance and PR template**
  - **Description:** Create a managed reviewer-oriented PR template when absent and update managed agent blocks with semantic titles, context, exact validation, substantive coverage, and squash merging through project scripts.
  - **Acceptance:**
    - [ ] Existing user prose/templates remain untouched outside managed boundaries.
    - [ ] Generated guidance matches actual scripts/config.
    - [ ] Manual contributors see Summary, Validation, Context, and conditional compatibility/security/non-goal prompts.
  - **Verify:** setup-file and init idempotency/concurrency tests
  - **Depends on:** Tasks 8, 10, 11
  - **Files:** `src/init.ts`, `src/setup-files.ts`, focused tests, template fixture
  - **Size:** M

### Checkpoint: Setup DX

- [ ] TTY/headless/dry-run/cancel paths pass
- [ ] V1 migration and V2 idempotency pass
- [ ] Managed docs/templates preserve user content
- [ ] Packed init works with npm, pnpm, Yarn, and Bun fixtures

### Phase 5: Repository Adoption and Release Evidence

- [ ] **Task 13: Adopt the contract in Diffwright itself**
  - **Description:** Add the reviewed policy, PR template, CONTRIBUTING rules, package merge script, and agent workflow guidance without enabling DCO/signature/Changesets requirements.
  - **Acceptance:**
    - [ ] Stable optional scopes are documented/configured.
    - [ ] Branch checkpoint versus squash-main behavior is explicit.
    - [ ] Documented gates match automated scripts or clearly list manual release gates.
  - **Verify:** docs/npm-page/project-setup tests and `git diff --check`
  - **Depends on:** Tasks 8–12
  - **Files:** `.diffwrightrc.json`, PR template, `CONTRIBUTING.md`, package/agent docs/tests
  - **Size:** M

- [ ] **Task 14: Expand the executable evaluation corpus**
  - **Description:** Add PR domain oracles, type/scope fixtures, repair transcripts, change-map totals, request ceilings, and init configuration cases without exposing oracle labels to production.
  - **Acceptance:**
    - [ ] 100% required-domain recall on approved fixtures.
    - [ ] Structural/runtime and editorial/evaluation assertions remain separate.
    - [ ] No exact free-form model prose snapshots.
  - **Verify:** compiled corpus and workflow tests
  - **Depends on:** Tasks 1–13
  - **Files:** corpus fixture/helper/test and targeted workflow fixtures
  - **Size:** M

- [ ] **Task 15: Review, ship evidence, and PR #20 dogfood**
  - **Description:** Complete five-axis review, update README/reference/changelog, run all release gates, regenerate PR #20 with `--timings`, and record rollout/rollback evidence.
  - **Acceptance:**
    - [ ] PR #20 meets every dogfood oracle in the spec.
    - [ ] CI and CodeRabbit are green on final head.
    - [ ] REVIEW.md and SHIP.md contain no unresolved required finding.
  - **Verify:** all repository gates, packed install, audit/signatures, live PR inspection
  - **Depends on:** Tasks 1–14
  - **Files:** docs, tests, `REVIEW.md`, `SHIP.md`
  - **Size:** M

## Parallelization

- **Safe to parallelize after contracts land:** change-map tests, semantic-title corpus, and policy/init fixture design.
- **Must be sequential:** primary preservation -> coverage; title semantics -> merge/title CI; policy v2 -> init adoption; all implementation -> final dogfood.
- **Contract-first:** critic result type, change-map groups, receipt result schema, policy v2 schema, and merge mutation boundary.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Plan expands PR #20 substantially | High | High | One independently gated commit per vertical slice; keep non-goals firm |
| Model struggles with 100% substantive coverage | Medium | High | Bounded coverage repair with exact missing IDs; corpus before orchestration |
| Safe merge command duplicates GitHub behavior | Medium | Medium | Thin wrapper around pinned checks and explicit `gh` argv; no admin dependency |
| Config migration breaks older installs | High | Low | Exact dependency upgrade before v2 migration; v1 loader remains supported |
| Parsed validation output leaks data | High | Medium | Registered numeric-only adapters; never serialize raw output |
| Rich body exceeds GitHub limit | Medium | Low | Aggregate totals, bounded claims, pre-mutation byte check |

## Open Questions

- [x] Reviewer completeness is default and immutable.
- [x] DCO, signatures, Changesets, and issue-body fetching are deferred.
- [x] Init never mutates GitHub admin settings.
- [x] Fine-grained branch commits remain; supported merge path squashes main.

## Sign-off

- [x] Every task has acceptance and verification
- [x] Tasks are dependency ordered
- [x] No task is XL
- [x] Checkpoints separate the major phases
- [x] Requester approved implementing all adopted recommendations
