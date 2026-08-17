# Plan: History-Aware, Proportionate PR Narratives

> Derived from: `specs/history-aware-pr/SPEC.md`
> Status: approved by the 2026-08-17 user request
> Last updated: 2026-08-17

## Architecture Decisions

- History is collected beside Git evidence but remains `provided`, supplemental,
  and snapshot-bound.
- Final-net-diff change IDs remain the only inputs to completeness accounting.
- Narrative breadth is a pure post-critic invariant; prompts guide the model but
  never replace enforcement.
- The rule is proportional and capped at six detailed claims, preserving concise
  output for small PRs.
- Provider request and evidence-size ceilings do not change.

## Dependency Graph

```text
[pinned history collector]
          │
          ├──────────────▶ [history claim semantics]
          │                         │
[pure breadth contract] ────────────┼──▶ [PR orchestration + repairs]
                                    │               │
                                    └───────────────┴──▶ [PR #20 evaluation]
```

## Task List

### Task 1: Specify and baseline PR #20

- [x] Record the current body and actual root cause.
- [x] Define history provenance, proportional breadth, safety boundaries, and
  measurable PR #20 acceptance.
- **Verify:** `git diff --check`
- **Files:** `specs/history-aware-pr/SPEC.md`, `PLAN.md`
- **Size:** S

### Task 2: Collect immutable authored history

- [x] Add bounded NUL-safe `merge-base..HEAD` history collection using fixed Git
  argv and the existing command runner.
- [x] Wire the existing `--limit` value into initial and post-gate evidence
  collection without changing final-diff coverage.
- [x] Recheck head/base snapshot identity and reject malformed or oversized
  history generically.
- [x] Add focused Git fixtures without introducing another runtime module.
- **Acceptance:** only range commits appear; ordering is deterministic; subjects
  and bodies remain provided; empty history is valid; secrets are redacted in
  model messages.
- **Verify:** focused Git-evidence/history tests, typecheck, build.
- **Files:** `src/git-evidence.ts`, `test/git-evidence.test.ts`, inventories.
- **Size:** M

### Task 3: Define safe history-backed claims

- [x] Permit a conservative provided problem/rationale/risk/follow-up claim to
  cite a nonempty history body.
- [x] Keep subject-only history ineligible for those claims.
- [x] Require observed change evidence alongside history for every change claim.
- [x] Update the model and critic instructions without exposing repository policy.
- **Acceptance:** adversarial subject-only and unrelated-history cases fail;
  nonempty cited body plus matching critic approval succeeds.
- **Verify:** change-evidence, artifact-draft, and critic focused tests.
- **Files:** `src/change-evidence.ts`, prompt builders, focused tests.
- **Size:** M

### Task 4: Enforce proportionate detailed coverage

- [x] Add pure required-claim and per-claim-span calculations.
- [x] Require non-primary Changes claims to cover all substantive IDs for broad
  PRs after criticism.
- [x] Emit one stable generic diagnostic without evidence text.
- [x] Add boundary and permutation tests.
- **Acceptance:** one broad Summary cannot satisfy a 23-item PR; five bounded
  detailed claims can; PRs below four substantive items remain concise.
- **Verify:** artifact-completeness focused suite.
- **Files:** `src/artifact-completeness.ts`, focused tests.
- **Size:** S

### Task 5: Integrate breadth with every repair path

- [x] Give the initial draft and each repair exact bounded detail requirements.
- [x] Revalidate after deterministic repair, primary replacement merge, coverage
  repair, and critic pruning.
- [x] Preserve already supported detailed claims byte-for-byte.
- [x] Keep normal request count at two and combined maximum at five.
- **Acceptance:** fake-provider workflows cover normal success, one repair,
  critic-reopened detail gaps, and terminal ceiling behavior.
- **Verify:** workflow-byok focused tests and security suite.
- **Files:** `src/pr-workflow.ts`, `test/workflow-byok.test.ts`.
- **Size:** M

### Checkpoint: Runtime contract

- [x] Typecheck passes.
- [x] Focused history, evidence, completeness, critic, and workflow tests pass.
- [ ] Full suite passes.
- [ ] No provider size/request/security invariant regresses.

### Task 6: Produce the PR #20 before/after

- [ ] Reconstruct PR #20 from its original base and head SHAs in an isolated
  temporary worktree.
- [ ] Generate the after body without GitHub mutation using the configured
  provider and no private context file.
- [ ] Record exact before/after Markdown, request count, timings, and an audit of
  which claims came from final diff versus history.
- [ ] Confirm the after body has five grounded Changes claims and no invented
  Why/Risk from the 32 subject-only commits.
- **Verify:** manual comparison plus structural evaluation command.
- **Files:** `specs/history-aware-pr/EVALUATION.md`.
- **Size:** S

### Task 7: Review, document, and ship

- [ ] Update README/CLI reference to explain authored history and proportionate
  narratives.
- [ ] Complete `REVIEW.md` across correctness, simplicity, architecture,
  security, and performance.
- [ ] Complete `SHIP.md` with rollout, rollback, package, and dogfood evidence.
- [ ] Commit each green slice through `npm run commit`, open/update the PR through
  `npm run feature:pr`, address review feedback, and merge only through
  `npm run pr:merge -- --yes` when explicitly requested.
- **Verify:** full repository gates, package dry run, audit, signatures, hosted CI.
- **Files:** docs and spec artifacts.
- **Size:** M

## Exit Criteria

- [ ] PR #20 before/after is reviewable and materially different.
- [ ] Branch history improves change naming without becoming observed truth.
- [ ] Broad PRs cannot collapse to one generic claim.
- [ ] Why/Risk remain absent when commit bodies and explicit context are absent.
- [ ] All request, size, freshness, redaction, and mutation invariants stay green.
