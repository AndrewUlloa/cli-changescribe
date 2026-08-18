# Plan: Final-Diff-Aware Reviewer Topics

> Derived from: `specs/history-aware-pr/SPEC.md`
> Status: in progress
> Last updated: 2026-08-18

## Overview

Replace the file-count breadth experiment with a local topic-planning contract.
First preserve the PR #20 failure as an executable benchmark. Then add one
batched history-to-final-change adjacency read, a pure hint/assignment planner,
subject-only protected model projection, and workflow validation after every
critic/repair path. Finish with corpus evaluation, PR #20 dogfood, five-axis
review, and release evidence.

## Architecture Decisions

- **Decision:** Final net diff remains the only authoritative change evidence.
  **Rationale:** History can name checkpoints but can include reverted/stale work.
- **Decision:** Adjacency is local non-evidentiary planning metadata.
  **Rationale:** Path intersection is useful but does not prove semantic survival.
- **Decision:** Topic planning stays inside the existing draft response.
  **Rationale:** Preserve the two-request healthy path and avoid summaries of
  summaries.
- **Decision:** Accepted prose topics and map-only IDs form an exact partition.
  **Rationale:** Complete accounting without one bullet per file.
- **Decision:** Commit bodies remain local by default.
  **Rationale:** Automatic provider egress is not equivalent to explicit context
  consent and exact credential redaction is not a general privacy filter.
- **Decision:** Corpus tests score flexible semantic oracles, never exact prose.
  **Rationale:** Many wordings can be good while inventory prose must still fail.

Rejected:

- File-count `sqrt(n)` as the quality definition: it accepted six inventory
  bullets and splits one-theme codemods artificially.
- Per-commit model summaries: variable cost, stale intermediate state, and
  summary-of-summary grounding loss.
- A third normal-path topic-planning call: unnecessary cost and latency.
- Repository-configurable weakening of grounding, topic assignment, or critic.

## Dependency Graph

```text
[contract + PR #20 baseline]
              |
              v
[batched Git adjacency] ---> [protected model projection]
              |                         |
              v                         v
       [pure topic planner] ------> [PR workflow + repairs]
                                              |
                                              v
                                  [corpus + PR #20 dogfood]
                                              |
                                              v
                                      [review + ship]
```

## Task List

### Phase 1: Contract and Baseline

- [x] **Task 1: Commit the failed experiment and replacement contract**
  - **Description:** Preserve the exact PR #20 before/current-after output and
    explain why six grounded inventory bullets are not the goal. Replace the
    shipping contract with adjacency hints, exact topic/map partition, body
    privacy, semantic quality metrics, and rollout boundaries.
  - **Acceptance:**
    - [x] Frozen PR #20 body, generated body, request sequence, timings, and
      0/6 vs partial topic score are recorded.
    - [x] Spec rejects file-count breadth as the final invariant.
    - [x] No runtime behavior changes in this commit.
  - **Verify:** `git diff --check`; `npm run typecheck`.
  - **Depends on:** None.
  - **Files:** `specs/history-aware-pr/{SPEC,PLAN,EVALUATION}.md`.
  - **Size:** S.

### Checkpoint: Approved Contract

- [x] Spec remains accurate after independent architecture/evaluation/security
  review.
- [x] Contract checkpoint committed and pushed with `npm run commit`.

### Phase 2: Evidence Foundation

- [x] **Task 2: Collect batched pinned history adjacency**
  - **Description:** Add a compatibility-preserving snapshot collector. Parse
    one `git diff-tree --stdin --always --root -r --name-status -z
    --find-renames` result
    into bounded history-to-final-change relationships.
  - **Acceptance:**
    - [x] Exactly one fixed-argv adjacency subprocess receives exact retained
      SHAs through stdin.
    - [x] NUL/status state machine handles A/M/D/T/R/C and rejects malformed,
      repeated, missing, out-of-order, or unexpected records generically.
    - [x] Zero-adjacency reverted histories are identifiable and freshness is
      still bound to head/base/merge base.
  - **Verify:** focused Git evidence tests, typecheck, build, full gates.
  - **Depends on:** Task 1.
  - **Files:** `src/git-evidence.ts`, `test/git-evidence.test.ts`.
  - **Size:** M.

- [ ] **Task 3: Build the pure reviewer-topic planner**
  - **Description:** Add frozen typed hint construction and post-critic topic
    assignment validation. Collapse identical adjacency sets, compute the
    bounded target, validate disjoint topic ownership, and derive map-only IDs.
  - **Acceptance:**
    - [ ] Deterministic under input permutation and immutable after return.
    - [ ] Every substantive ID occurs exactly once across topics/map-only.
    - [ ] Unknown, duplicate, overlapping, supporting-only, zero-change, and
      unlinked-history topic claims fail with bounded generic diagnostics.
  - **Verify:** `test/reviewer-topics.test.ts`, typecheck, build, full gates.
  - **Depends on:** Task 2 contract; implementation may start once types settle.
  - **Files:** new `src/reviewer-topics.ts`, new test, inventories.
  - **Size:** M.

### Checkpoint: Local Planning

- [ ] Git evidence and pure planner tests pass on Node 18-compatible APIs.
- [ ] No provider request or rendered-output behavior changed yet.
- [ ] Tasks 2 and 3 each committed through `npm run commit`.

### Phase 3: Privacy and Workflow

- [ ] **Task 4: Protect history at the model boundary**
  - **Description:** Project only linked, allowed subjects and ID relationships;
    blank bodies, suppress policy-touching histories, scan high-confidence
    credentials, remove history from title-type/intent semantics, and include
    hint bytes in the existing preflight budget.
  - **Acceptance:**
    - [ ] Reverted/unlinked subjects, every body, protected-policy history, and
      credential-bearing subjects are absent from provider requests.
    - [ ] `--context-file` remains the only authored rationale source.
    - [ ] Nothing truncates silently; configured secrets remain redacted.
  - **Verify:** model-evidence, change-evidence, title-semantics, security tests;
    typecheck/build/full gates.
  - **Depends on:** Tasks 2-3.
  - **Files:** evidence/projection/semantics modules and focused tests.
  - **Size:** M.

- [ ] **Task 5: Integrate topic generation and bounded repair**
  - **Description:** Add ID-only hints to every draft/repair prompt, build the
    accepted topic plan after criticism, repair one missing topic plan from
    original evidence within the existing ceiling, and render unchanged.
  - **Acceptance:**
    - [ ] Healthy path remains exactly draft + critic.
    - [ ] Schema fallback is at most three; every combined repair path is at
      most five and the terminal accepted draft is criticized.
    - [ ] Critic-pruned topic gaps repair or fail before output/GitHub mutation.
    - [ ] Existing title, receipt, body, freshness, and GitHub tests stay green.
  - **Verify:** workflow-byok, artifact critic/draft/completeness tests, security
    suite, typecheck/build/full gates.
  - **Depends on:** Task 4.
  - **Files:** `src/pr-workflow.ts`, completeness/critic helpers, tests.
  - **Size:** M.

### Checkpoint: End-to-End Core

- [ ] Fake-provider broad, one-theme, reverted, repair, and egress cases pass.
- [ ] Packed ChangeScribe bridge and existing CLI behavior remain compatible.
- [ ] Tasks 4 and 5 committed independently through `npm run commit`.

### Phase 4: Evaluation, Review, and Ship

- [ ] **Task 6: Add executable editorial-quality corpus**
  - **Description:** Add narrative-quality fixtures and a pure evaluator for
    topic recall, uniqueness, coherence, flexible mechanism anchors, inventory
    rate, and paraphrase equivalence.
  - **Acceptance:**
    - [ ] Includes PR #20, one-theme codemod, same-file independent topics,
      reverted history, body privacy, supporting files, rename/delete, generic
      inventory, and paraphrase cases.
    - [ ] Every fixture expectation executes production parsing/planning code.
    - [ ] No exact provider prose snapshot is required.
  - **Verify:** narrative-quality and evaluation-corpus tests, full gates.
  - **Depends on:** Task 5.
  - **Files:** new fixture directory, new tests/evaluator, inventories.
  - **Size:** M.

- [ ] **Task 7: Dogfood PR #20 and PR #21**
  - **Description:** Regenerate offline from pinned evidence, record structured
    plan/body/request sequence/timings, score against the six-topic oracle, and
    compare with the frozen before and inventory after.
  - **Acceptance:**
    - [ ] PR #20 recall 6/6, inventory rate 0%, no unsupported Why/Risk, no
      GitHub mutation, healthy or documented schema-fallback request sequence.
    - [ ] PR #21 output is reviewer-usable under the same hard invariants.
  - **Verify:** structural evaluator plus human side-by-side review.
  - **Depends on:** Task 6.
  - **Files:** `specs/history-aware-pr/EVALUATION.md` and generated audit data.
  - **Size:** S.

- [ ] **Task 8: Complete five-axis review and ship evidence**
  - **Description:** Update public docs/CHANGELOG; complete correctness,
    simplicity, architecture, security, and performance review; write rollback
    and package-release evidence; resolve every required finding.
  - **Acceptance:**
    - [ ] `REVIEW.md` and `SHIP.md` match the implemented code and green gates.
    - [ ] Typecheck, full tests, build, pack dry-run, audit, signatures, and
      diff-check pass.
    - [ ] PR #21 is updated only with `npm run feature:pr`; review feedback is
      addressed; guarded merge is handed off for explicit approval.
  - **Verify:** repository release gates and hosted CI.
  - **Depends on:** Tasks 1-7.
  - **Files:** README, CLI/provider docs as needed, CHANGELOG, review/ship.
  - **Size:** M.

## Parallelization

- Safe: evaluation corpus design and adversarial safety review after the topic
  contract is fixed.
- Sequential: adjacency -> planner -> projection/privacy -> workflow -> live
  dogfood.
- Contract-first: `ReviewerTopicHints` and `ReviewerTopicPlan` types must settle
  before workflow changes.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Central files link unrelated checkpoints | Medium | High | Identical-set hints only; disjoint final assignment; semantic corpus |
| Provider emits inventory topics | High | Medium | Topic prompt + critic instruction + executable inventory oracle + dogfood gate |
| Commit text leaks private data | High | Medium | Body-local default, subject scan, policy suppression, exact redaction |
| Large adjacency exceeds prompt | High | Low | Bounded edges/groups, combined preflight, explicit failure |
| Repair consumes request budget | Medium | Medium | Reuse full-draft repair and assert max five in orchestration tests |
| Current branch behavior changes mid-PR | Medium | High | One independently green commit per slice and explicit rollback points |

## Open Questions

None. History-body opt-in, issue ingestion, and repository-specific topic
templates are deferred.

## Sign-off

- [x] Every task has acceptance and verification.
- [x] Tasks are ordered by dependency.
- [x] No task is XL.
- [x] Checkpoints separate contract, local core, workflow, and release.
- [x] User approved the end-to-end direction and guarded incremental commits.
