# Plan: Evidence-Backed Generation v2

> Derived from: `specs/evidence-backed-generation-v2/SPEC.md`
> Status: approved
> Last updated: 2026-08-14

## Overview

Build an evidence-first commit and pull-request pipeline in small, dogfooded
increments. The first slice locks the product contract and evaluation baseline.
The next slices introduce a shared structured representation, correct the PR
pipeline's authoritative evidence, redesign commits, add review controls, and
finish with advisory style, documentation, security review, and distribution
verification.

## Architecture Decisions

- **Decision:** Treat artifact generation as a compiler pipeline.
  **Rationale:** Collection, interpretation, rendering, and validation have
  different trust boundaries and should be testable independently.
- **Decision:** Use immutable evidence IDs in model-facing structured records.
  **Rationale:** Claims can be checked against recognized inputs before they
  become durable Git or GitHub text.
- **Decision:** Make `merge-base...HEAD` authoritative for PR content.
  **Rationale:** Commit history can contain intermediate, reverted, or noisy
  implementation steps that are absent from the final review unit.
- **Decision:** Make gate receipts deterministic rather than model-authored.
  **Rationale:** A subprocess exit status can support a verification claim;
  source-code changes cannot.
- **Decision:** Keep repository style and context source-agnostic.
  **Rationale:** Diffwright should accept policy and context without depending
  on one tracker, coding agent, founder workflow, or prose template.

Non-decisions:

- Rejected: prompt-only tuning. Reason: it cannot repair missing evidence or
  summary-chain provenance loss.
- Rejected: full ASD-STE100 enforcement. Reason: its controlled language is not
  designed as a universal developer-writing standard.
- Rejected: built-in project-management connectors. Reason: adapter concerns
  would couple the core to unrelated products and privacy scopes.
- Rejected: automatic hunk splitting. Reason: it is a materially different Git
  mutation workflow.

## Dependency Graph

```text
[evaluation corpus + approved contract]
                 |
                 v
[shared evidence and artifact contracts]
          |                    |
          v                    v
[PR net-diff pipeline]   [Commit v2 pipeline]
          |                    |
          +----------+---------+
                     v
       [preview/edit + policy configuration]
                     |
                     v
       [style warnings + docs + release review]
```

## Task List

### Phase 1: Contract and Evaluation

- [x] **Task 1: Commit the approved specification and implementation plan**
  - **Description:** Record measurable behavior, boundaries, architecture, and
    thin commit order before changing runtime behavior.
  - **Acceptance:**
    - [x] Spec names evidence, intent, verification, and inference separately.
    - [x] Plan keeps every implementation task at five files or fewer.
    - [x] No runtime behavior changes in the first commit.
  - **Verify:**
    - `git diff --check`
    - `npm run typecheck`
  - **Depends on:** None
  - **Files:** `specs/evidence-backed-generation-v2/SPEC.md`, `PLAN.md`
  - **Size:** S

- [x] **Task 2: Add the editorial and factual evaluation corpus**
  - **Description:** Capture representative structured fixtures and baseline
    failure cases before replacing generation behavior.
  - **Acceptance:**
    - [x] Fixtures cover simple, breaking, scoped, trailer, deletion, rename,
      revert, unexecuted-test, large-diff, and mixed-concern changes.
    - [x] Rubric fails unsupported material claims and distinguishes tests
      changed from tests executed.
    - [x] The current known PR-summary failure is represented without embedding
      secrets or provider output snapshots as a trusted oracle.
  - **Verify:**
    - `npm run build:test`
    - `node --test .test-dist/evidence-evaluation.test.js`
  - **Depends on:** Task 1
  - **Files:** `test/fixtures/evidence/*`, `test/evidence-evaluation.test.ts`,
    `test/run-tests.ts`
  - **Size:** M

### Checkpoint: Contract and Evaluation

- [ ] Baseline fixture tests pass
- [ ] Full existing suite remains green
- [ ] First commit pushed and PR opened through Diffwright

### Phase 2: Shared Evidence Foundation

- [x] **Task 3: Introduce immutable evidence and claim contracts**
  - **Description:** Add source-agnostic records, claim validation, coverage
    accounting, and bounded context-file loading.
  - **Acceptance:**
    - [x] Duplicate/missing evidence IDs and unsupported claim references fail.
    - [x] Raw payloads and total bundles have explicit size limits.
    - [x] Inferred claims are excluded from renderable output.
  - **Verify:**
    - `npm run typecheck`
    - `node --test .test-dist/change-evidence.test.js`
  - **Depends on:** Task 2
  - **Files:** `src/change-evidence.ts`, `test/change-evidence.test.ts`,
    `test/typescript-migration.test.ts`, `test/distribution.test.ts`
  - **Size:** M

  Context-file I/O remains in Task 9 so this domain module stays pure and
  source-agnostic.

### Checkpoint: Evidence Foundation

- [ ] Evidence contracts are independently testable
- [ ] Packed module inventory is complete
- [ ] Full suite remains green

### Phase 3: Pull-Request Correctness

- [x] **Task 4: Collect authoritative final-branch evidence**
  - **Description:** Replace per-commit patch enrichment with a complete,
    file-aware `merge-base...HEAD` evidence collector including deletions and
    renames. Keep commit messages only as optional context.
  - **Acceptance:**
    - [x] Reverted intermediate work is absent from final evidence.
    - [x] Deleted and renamed paths are represented.
    - [x] Coverage is complete or generation stops explicitly.
  - **Verify:**
    - `node --test .test-dist/git-evidence.test.js`
    - `npm run typecheck`
  - **Depends on:** Task 3
  - **Files:** `src/git-evidence.ts`, `test/git-evidence.test.ts`,
    `test/typescript-migration.test.ts`, `test/distribution.test.ts`
  - **Size:** M

- [x] **Task 5: Replace the PR summary chain with evidence-linked synthesis**
  - **Description:** Remove 5Cs and model-summary chaining. Extract structured
    claims from original evidence, merge them deterministically, and render
    adaptive reviewer-oriented sections.
  - **Acceptance:**
    - [x] No model-authored summary is treated as original evidence.
    - [x] Empty optional sections disappear.
    - [x] Every material generated claim references recognized evidence.
  - **Verify:**
    - `node --test .test-dist/pr-summary-v2.test.js`
    - `npm test`
  - **Depends on:** Task 4
  - **Files:** `src/pr-summary.ts`, `src/pr-workflow.ts`,
    `src/artifact-draft.ts`, `src/artifact-renderer.ts`,
    `test/workflow-byok.test.ts`
  - **Size:** M

- [x] **Task 6: Record gate receipts and preserve squash-title policy**
  - **Description:** Capture exact package-manager gate outcomes, render
    verification deterministically, and validate PR titles with the shared
    Conventional Commit header policy.
  - **Acceptance:**
    - [x] Passing claims contain exact executed commands.
    - [x] Failed/unrun gates cannot be rendered as passed.
    - [x] Generated PR titles remain valid squash-merge subjects.
  - **Verify:**
    - `node --test .test-dist/workflow-byok.test.js`
    - `node --test .test-dist/pr-summary-v2.test.js`
  - **Depends on:** Task 5
  - **Files:** `src/gate-receipts.ts`, `src/pr-workflow.ts`,
    `src/artifact-renderer.ts`, `test/gate-receipts.test.ts`,
    `test/workflow-byok.test.ts`
  - **Size:** M

### Checkpoint: PR Correctness

- [x] Net-diff adversarial fixtures pass
- [x] Gate receipts are deterministic
- [x] No 5Cs or mandatory per-commit ledger remains
- [x] Full suite remains green

### Phase 4: Commit Generation v2

- [x] **Task 7: Make staging explicit without breaking project harnesses**
  - **Description:** Make direct `diffwright commit` staged-only, add explicit
    `--all`, and migrate generated and dogfooded npm scripts to `commit --all`.
  - **Acceptance:**
    - [x] An empty index does not mutate or call the provider by default.
    - [x] `--all` is the only all-files staging path.
    - [x] Guided init and ChangeScribe compatibility remain idempotent.
  - **Verify:**
    - `node --test .test-dist/commit-v2.test.js`
    - `node --test .test-dist/init-wizard.test.js`
    - `node --test .test-dist/distribution.test.js`
  - **Depends on:** Task 3
  - **Files:** `src/arguments.ts`, `src/commit.ts`, `src/project-setup.ts`,
    `src/init.ts`, `src/cli.ts`, `test/commit-v2.test.ts`,
    `test/init-wizard.test.ts`, `test/distribution.test.ts`
  - **Size:** M

- [x] **Task 8: Render adaptive Conventional Commits from structured drafts**
  - **Description:** Replace the forced body parser with configurable standard
    types, optional scopes, breaking markers, extensible trailers, adaptive
    prose, and deterministic 50/72 validation.
  - **Acceptance:**
    - [x] Subject-only output is valid.
    - [x] Scopes and trailers follow Conventional Commits syntax.
    - [x] Unknown rationale/risk is omitted; no placeholder filler is emitted.
  - **Verify:**
    - `node --test .test-dist/commit-v2.test.js`
    - `node --test .test-dist/workflow-byok.test.js`
  - **Depends on:** Tasks 3 and 7
  - **Files:** `src/commit.ts`, `src/change-evidence.ts`,
    `test/commit-v2.test.ts`, `test/workflow-byok.test.ts`
  - **Size:** M

- [x] **Task 9: Add generic supplied context to commit and PR generation**
  - **Description:** Route bounded context-file evidence into both artifact
    pipelines without teaching the core which external system produced it.
  - **Acceptance:**
    - [x] Context remains explicitly `provided`, never `verified`.
    - [x] Missing, oversized, symlinked, or unsafe context fails before network
      or Git mutation.
    - [x] Secrets remain redacted from output and errors.
  - **Verify:**
    - `node --test .test-dist/change-evidence.test.js`
    - `node --test .test-dist/security.test.js`
  - **Depends on:** Tasks 4 and 8
  - **Files:** `src/arguments.ts`, `src/commit.ts`, `src/pr-summary.ts`,
    `test/security.test.ts`
  - **Size:** M

### Checkpoint: Commit v2

- [x] Commit grammar matrix passes
- [x] Staged-only and explicit-all flows pass
- [x] Guided scripts dogfood explicit staging
- [x] Full suite remains green

### Phase 5: Human Review and Editorial Policy

- [ ] **Task 10: Add explicit review before GitHub mutation**
  - **Description:** Preview generated title/body, confirm in an interactive
    terminal, require `--yes` headlessly, and revalidate edited content before
    create/update.
  - **Acceptance:**
    - [ ] Cancellation performs no GitHub mutation.
    - [ ] Noninteractive mutation without `--yes` fails clearly.
    - [ ] Generated project scripts include the intentional automation policy.
  - **Verify:**
    - `node --test .test-dist/pr-review.test.js`
    - `node --test .test-dist/cli-routing.test.js`
  - **Depends on:** Task 6
  - **Files:** `src/arguments.ts`, `src/pr-summary.ts`, `src/project-setup.ts`,
    `test/pr-review.test.ts`, `test/cli-routing.test.ts`
  - **Size:** M

- [ ] **Task 11: Add advisory plain-language checks and repository policy**
  - **Description:** Add warnings for excessive sentence length, vague
    absolutes, duplicate claims, and unstable terminology while keeping
    factual/schema violations blocking and repository overrides authoritative.
  - **Acceptance:**
    - [ ] Style warnings never masquerade as factual proof.
    - [ ] Precise code identifiers, URLs, and repository terminology are not
      mechanically rewritten.
    - [ ] Default policy remains useful without configuration.
  - **Verify:**
    - `node --test .test-dist/editorial-policy.test.js`
    - `npm run typecheck`
  - **Depends on:** Tasks 8 and 10
  - **Files:** `src/change-evidence.ts`, `src/commit.ts`, `src/pr-summary.ts`,
    `test/editorial-policy.test.ts`
  - **Size:** M

- [ ] **Task 12: Document the evidence contract and migrate examples**
  - **Description:** Update public CLI, workflow, provider/privacy, and
    troubleshooting guidance without overclaiming truth or STE compliance.
  - **Acceptance:**
    - [ ] Every public option and behavior is documented.
    - [ ] Examples use adaptive commits and evidence-backed PR sections.
    - [ ] Migration notes cover staged-only direct use and automated scripts.
  - **Verify:**
    - `node --test .test-dist/npm-page.test.js`
    - `git diff --check`
  - **Depends on:** Tasks 7–11
  - **Files:** `README.md`, `documentation/cli-reference.md`,
    `documentation/troubleshooting.md`, `test/npm-page.test.ts`
  - **Size:** M

### Checkpoint: Ready for Review

- [ ] All spec success criteria met
- [ ] Full tests and packaging gates green
- [ ] Five-axis review requested

### Phase 6: Review and Ship

- [ ] **Task 13: Complete independent correctness, security, and prose review**
  - **Description:** Review final behavior across correctness, readability,
    architecture, security, and performance; resolve all required findings.
  - **Acceptance:**
    - [ ] Required findings are fixed or explicitly deferred with a tracked
      issue.
    - [ ] Review records evidence for all five axes.
  - **Verify:**
    - `npm run typecheck`
    - `npm test`
    - `npm pack --dry-run`
    - `npm audit --omit=dev`
    - `git diff --check`
  - **Depends on:** Task 12
  - **Files:** `specs/evidence-backed-generation-v2/REVIEW.md`
  - **Size:** S

- [ ] **Task 14: Record release and rollback readiness**
  - **Description:** Document rollout, compatibility, failure recovery, and
    rollback for the next version without publishing automatically.
  - **Acceptance:**
    - [ ] Release scope and rollback commands are explicit.
    - [ ] No package publication or merge occurs without Andrew's separate
      instruction.
  - **Verify:**
    - `npm pack --dry-run`
    - Manual: inspect generated PR and release note
  - **Depends on:** Task 13
  - **Files:** `specs/evidence-backed-generation-v2/SHIP.md`, `PLAN.md`
  - **Size:** S

## Parallelization

- **Safe to parallelize:** Read-only architecture review, evaluation design,
  and security/compatibility review before the shared contract lands.
- **Must be sequential:** Evidence contract before commit/PR consumers; PR net
  evidence before PR synthesis; runtime behavior before public documentation;
  full review before ship notes.
- **Contract-first:** `EvidenceRecord`, `SupportedClaim`, coverage semantics,
  and verification receipts must land before parallel runtime work.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Existing PR creation becomes blocked by review policy | High | Medium | Migrate generated scripts to explicit `--yes`; preserve direct interactive safety |
| LLM JSON differs across providers | High | High | Small schemas, tolerant fenced-JSON extraction, one repair call, deterministic validation |
| Net diff is too large for one request | High | High | File-aware chunking and explicit coverage accounting; never silent truncation |
| Commit redesign breaks dogfooding mid-branch | High | Medium | Land explicit-staging scripts with the CLI behavior in the same commit |
| Model attaches evidence IDs dishonestly | High | Medium | Original-evidence critic, adversarial corpus, human preview, and no truth overclaim |
| Extra provider calls increase cost and latency | Medium | Medium | Remove 5Cs, bound extraction calls, record request count in tests |

## Open Questions

No blocking questions. Deferred items are recorded in the spec and excluded
from this plan.

## Sign-off

- [x] Every task has acceptance and verification
- [x] Tasks are ordered by dependency
- [x] No XL tasks remain
- [x] Checkpoints separate the phases
- [x] Human approved the plan direction through the implementation request
