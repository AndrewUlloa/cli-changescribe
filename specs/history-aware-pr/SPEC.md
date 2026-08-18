# Spec: Final-Diff-Aware Reviewer Topics

> Filed by: Codex implementation team
> Status: approved by the 2026-08-18 user request
> Last updated: 2026-08-18

## One-line Summary

Diffwright will turn pinned final-diff evidence and linked commit subjects into
a bounded reviewer-topic plan so broad pull requests explain their real change
themes without reviving reverted work, inventing intent, or adding a normal-path
model request.

## Objective

**What are we building?**

A local planning layer between Git evidence collection and PR artifact
generation. It links each retained commit subject to the surviving final-change
IDs that commit touched, supplies those links as untrusted planning hints, and
validates the critic-approved PR body as an exact partition of substantive
changes into reviewer topics plus an explicit deterministic-map-only bucket.

**Why are we building it?**

PR #20 exposed a real regression in editorial usefulness. Current Diffwright is
stronger than ChangeScribe at truth, privacy, final-net-diff accounting,
validation receipts, titles, and mutation safety, but it gives the drafting
model one flat evidence bundle. The first history-aware experiment forced six
grounded bullets and still produced file inventory:

```markdown
- Add .diffwrightrc.json configuration file.
- Add pull request template.
- Add PR title workflow.
- Update argument parsing logic.
- Add artifact completeness module.
- Add artifact critique utilities.
```

The 256 KiB provider boundary was not the cause; the pinned PR #20 projection
fit. The missing layer was a reviewer-oriented topic representation. Old
ChangeScribe created that representation through per-commit summaries, but it
also summarized intermediate work, omitted deletions, truncated diffs, inferred
rationale and tests, and fed summaries into later summaries. We will recover
the useful planning layer without recovering those failure modes.

**Who is it for?**

Maintainers reviewing broad agent-authored pull requests who need to understand
the important mechanisms and review areas before reading the full diff.

**What does success look like?**

The pinned PR #20 benchmark names six required reviewer themes with no
file-inventory bullets, no invented Why/Risk, the same deterministic map, and
the same two-request healthy path. A 100-file one-topic codemod remains one
topic instead of being split into artificial prose because of file count.

## Assumptions

- [x] Final `merge-base..HEAD` evidence remains the only authoritative account
  of what the PR changes.
- [x] Healthy generation remains `draft -> critic`; topic planning adds no
  provider call and every repair remains within five total requests.
- [x] Commit subjects may be sent as untrusted authored labels only when linked
  to surviving changes and safe for provider egress.
- [x] Commit bodies remain local by default and do not support generated intent;
  `--context-file` remains the explicit route for Why/Risk/tradeoff evidence.
- [x] The deterministic change map is the complete file-accounting surface;
  prose is a bounded set of reviewer topics, not one bullet per file.

## Success Criteria

| # | Criterion | How we measure | Target |
|---|---|---|---|
| 1 | Pinned adjacency | Git fixtures for divergence, rename, delete, merge, revert, and drift | Only histories in the pinned range link to surviving final-change IDs |
| 2 | Batched collection | Captured command runner argv/input | One fixed-argv `git diff-tree --stdin ... -z` traversal, not one process per commit |
| 3 | Reverted-work safety | Reverted and same-path adversarial fixtures | Zero-adjacency history never reaches the provider; adjacency never substitutes for final evidence |
| 4 | Privacy | Provider-request and credential fixtures | Bodies are absent by default; protected-policy histories are suppressed; detected credentials fail before egress |
| 5 | Exact topic plan | Pure plan validation | Every substantive final-change ID appears exactly once in a prose topic or map-only bucket |
| 6 | Reviewer usefulness | Flexible semantic corpus | Required topic recall 100%, duplicate topics 0, inventory-only topics 0 |
| 7 | Proportionality | Single-theme and PR #20 fixtures | One-topic codemod produces one topic; PR #20 target is six topics |
| 8 | Grounding | Draft, critic, and repair fixtures | Every prose topic cites observed final-change evidence; history is a planning hint only |
| 9 | Provider cost | Workflow request capture | Healthy path exactly 2; schema fallback at most 3; all repair paths at most 5 |
| 10 | Compatibility | Full repository and packed distribution suites | CLI aliases, output paths, receipts, renderer, GitHub mutation, ChangeScribe bridge, and Node 18+ remain green |
| 11 | PR #20 dogfood | Pinned offline regeneration | Six required topics, 0% inventory rate, no unsupported sections, no GitHub mutation |

## Non-Goals

- No return to per-commit model summarization or summaries-of-summaries.
- No repository-wide search index, semantic retrieval service, or Rust rewrite.
- No automatic issue-body ingestion or hidden network context.
- No configurable switch that disables grounding, criticism, topic assignment,
  redaction, freshness, receipts, or deterministic accounting.
- No exact-prose snapshots in CI and no live-provider call as a CI gate.
- No claim that path adjacency proves a commit's behavior survived unchanged.

## User Stories

- As a reviewer, I want a broad PR grouped by behavior and mechanism so I know
  what to inspect without reading a file inventory.
- As a maintainer, I want every topic grounded in the final diff so reverted
  checkpoints cannot reappear as shipped behavior.
- As a repository owner, I want commit-body context to stay private unless I
  provide intent explicitly.
- As an automation author, I want the healthy request count and guarded GitHub
  mutation flow to remain predictable.

## Architecture Contract

### 1. Immutable final evidence

The collector pins `HEAD`, base, and merge base. Name-status, numstat, patches,
and authored history are read from those immutable objects. Final changes remain
observed evidence. Commit messages remain provided, untrusted data.

### 2. Batched history-to-change adjacency

After bounded history collection, send the exact retained full SHAs through
stdin to one command:

```text
git diff-tree --stdin --always --root -r --name-status -z --find-renames
```

A NUL-state parser accepts only requested SHAs and supported status/path shapes.
`--always` requires Git to emit a header for merge and ordinary empty commits,
so a missing requested record is always malformed while an empty record remains
a valid zero-adjacency checkpoint.
It maps commit old/current paths to the final evidence index and emits only
`historyId -> finalChangeIds`. Raw intermediate paths are never serialized.
Missing, repeated, out-of-order, malformed, or oversized records fail closed.

Merge commits that do not yield an ordinary record stay unlinked; their
constituent commits remain in the reachable range. A zero-adjacency commit is
omitted from model evidence. Same-path adjacency is still only a hint and every
rendered statement requires observed final-diff evidence plus criticism.

### 3. Candidate topic hints

The local planner restricts adjacency to substantive change IDs available in
the protected model projection, groups identical sorted adjacency sets, keeps
history chronology inside each group, and records unlinked substantive IDs.
The model receives ID-only relationships plus subject labels. It does not
receive raw intermediate paths or default commit bodies.

The target topic count is:

```text
min(6, distinct linked adjacency groups, substantive final changes)
```

Unlinked changes may still form a topic from final evidence. File count alone
never forces prose count.

### 4. Critic-approved assignment plan

After the terminal critic, build a `ReviewerTopicPlan` from non-primary observed
change claims in rendered Changes order:

- each prose topic owns a nonempty, disjoint set of substantive final-change
  IDs;
- any cited history ID must be adjacent to at least one owned final change;
- at least the target number of topics have a valid history anchor when linked
  hints exist;
- prose topics are capped at six;
- the explicit map-only bucket is the remaining substantive IDs;
- topics plus map-only form an exact partition with no unknown, supporting, or
  duplicate ownership.

The primary Summary remains the broad branch statement. The deterministic map
continues to account for every changed file. If criticism removes a required
topic, the existing bounded full-draft repair path runs against original
evidence and the accepted result is criticized and validated again.

### 5. Privacy and egress

- Subject labels are redacted for configured secrets and scanned for bounded,
  high-confidence credential patterns before provider work.
- Histories touching the protected repository-policy file do not reach the
  model.
- Bodies remain local and are blanked in the default projection. They cannot
  support Problem, Rationale, Risk, or Follow-up claims.
- `--context-file` remains the explicit, separately visible source of authored
  intent.
- Topic hints, evidence, and prompt text share the existing provider input
  ceiling; nothing is silently truncated to fit.
- Paths, patches, subjects, and messages are untrusted data, never prompt
  instructions.

## Tech Stack and Project Structure

- TypeScript, strict CommonJS/Node16 compilation, Node 18/20/22.
- Native `node:test`; compiled tests under `.test-dist`.
- Existing fixed-argv `CommandRunner`; no runtime dependency or shell.
- Proposed pure module: `src/reviewer-topics.ts`.
- Git adjacency remains in `src/git-evidence.ts` or a narrowly scoped helper;
  orchestration remains in `src/pr-workflow.ts`.
- Evaluation fixtures live under `fixtures/narrative-quality-v1/`.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run --json
npm audit --omit=dev
npm audit signatures
git diff --check
```

Shipping mutations remain:

```bash
npm run commit
npm run feature:pr
npm run pr:merge -- --yes
```

## Testing Strategy

- Unit: NUL parser, adjacency, grouping, assignment, privacy, size, and
  deterministic ordering.
- Integration: fake-provider workflows for normal generation, every repair,
  critic pruning, request ceilings, and model-projection boundaries.
- Corpus: flexible path/anchor oracles for topic recall, coherence, uniqueness,
  specificity, and inventory regression; never exact wording.
- Dogfood: pinned PR #20 offline generation with structured draft, body, request
  sequence, timings, and machine-readable quality report.
- Full: existing security, distribution, ChangeScribe, Node-version, and GitHub
  mutation suites.

Required adversarial cases include NUL and SHA-shaped filenames, rename/copy/
delete, malformed streams, fully reverted work, add-revert-different-edit on the
same path, subject prompt injection, configured and expired-looking credentials,
policy values repeated in history, history truncation, 400 commits, 100-file
one-topic work, same-file independent topics, and post-collection snapshot drift.

## Boundaries

### Always

- Re-run topic assignment after every repair and critic filter.
- Keep final-diff IDs on every rendered change claim.
- Preserve exact receipts and the deterministic map.
- Fail generically without echoing paths, commit text, secrets, or model output.
- Commit every independently green slice through `npm run commit`.

### Ask First

- Sending commit bodies, issue bodies, or new private context to a provider.
- Increasing the five-request maximum or provider-input ceiling.
- Adding a dependency, native binary, telemetry, or repository-admin mutation.

### Never

- Never treat history/path adjacency as proof of final behavior or intent.
- Never let a subject/body enable `revert`, Why, Risk, Validation, compatibility,
  or breaking semantics by itself.
- Never hide substantive changes to make prose shorter.
- Never add a polish-only model request.
- Never stage, commit, push, edit a PR, or merge with raw Git/GitHub commands.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Same-path stale history looks relevant | Medium | High | Adjacency is hint-only; final IDs and terminal critic remain mandatory |
| Granular history creates noisy topics | Medium | Medium | Collapse identical adjacency, cap six, semantic corpus and PR #20 dogfood |
| One hub file connects unrelated work | High | Medium | Model groups ID-only hints; final plan requires disjoint ownership rather than graph components |
| Commit text contains private data | Medium | High | Subject scan, policy suppression, body-local default, exact redaction |
| Hint serialization breaches size budget | Low | High | Bound edges/groups and preflight combined input before gates/provider |
| New validation consumes repair budget | Medium | Medium | Reuse full-draft repair, assert healthy 2/max 5 in every workflow case |

## Rollout and Rollback

This is a local CLI generation change, not a hosted service, so a traffic
feature flag and percentage rollout are not applicable. It lands as separately
revertible commits: contract/evaluation, adjacency, pure planner, workflow,
corpus/docs. Before publication, dogfood it offline on PR #20 and PR #21. A
regression in truth, privacy, request count, or body quality blocks release.
Rollback is a normal revert of the workflow/planner slice followed by a patch
release; merge/title/mutation safety is independent.

## Open Questions

None. History-body opt-in and issue ingestion are explicitly deferred.

## Sign-off

- [x] Author has written this spec.
- [x] Assumptions were confirmed by the user's request to execute the complete
  final-diff/history topic-planning direction.
- [x] Success criteria are measurable.
- [x] Boundaries and non-goals are explicit.
- [x] Open questions are resolved or deferred.
- [x] Human direction is approved; implementation evidence remains pending.
