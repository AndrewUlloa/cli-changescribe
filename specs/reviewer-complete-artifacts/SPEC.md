# Spec: Reviewer-Complete Artifacts and Durable History

> Filed by: Codex implementation team
> Status: approved
> Last updated: 2026-08-16

## One-line Summary

Diffwright will produce evidence-backed commit titles and pull-request narratives
that are complete enough for reviewers while preserving its existing safety,
freshness, privacy, and grounding guarantees.

## Objective

**What are we building?**

We are upgrading commit and pull-request generation so a concise title indexes
one coherent outcome while the PR body explains every substantive change area,
the exact validation performed, supported context, compatibility boundaries,
and a deterministic map of the final net diff. Guided init will configure safe
repository preferences such as scopes, issue-context expectations, a PR
template, and squash-merge workflow.

**Why are we building it?**

Evidence-backed generation v2 improved truthfulness but over-corrected toward
minimal output. PR #20 changes 20 files with 1,155 additions and 216 deletions,
yet its generated body contains one change bullet. A rejected primary claim
currently causes Diffwright to replace the entire draft with a minimal artifact,
discarding supported detail. Recent main history also retains incremental branch
commits and overuses unscoped `fix:` titles, which makes durable history harder
to scan.

**Who is it for?**

Maintainers, reviewers, and agent-assisted contributors who need trustworthy
commit history and enough PR context to review a change without reconstructing
its intent and validation from the diff.

**What does success look like?**

PR #20 regenerates with a squash-ready Conventional Commit title, supported
problem/solution context, all substantive implementation areas represented,
an exact deterministic change map, and authoritative validation. Normal
generation still uses two provider requests, the full repair path never exceeds
five, and no configuration can disable evidence coverage or criticism.

## Assumptions

- [x] This work continues on PR #20 in thin, separately committed slices.
- [x] Reviewer-complete output is the default; there is no compact/verbose safety tradeoff.
- [x] Fine-grained feature-branch commits remain useful, while completed PRs squash to one durable main commit.
- [x] Repository preferences are data-only and pinned to committed HEAD/base policy.
- [x] Existing command aliases, provider support, ChangeScribe compatibility, and noninteractive safety remain compatible.

## Success Criteria

| # | Criterion | How we measure | Target |
|---|---|---|---|
| 1 | Substantive narrative coverage | Union of evidence IDs cited by critic-supported rendered change claims | 100% of substantive change evidence IDs |
| 2 | Final-diff accounting | Deterministic change-map classification | Every changed file exactly once; exact known `+/-` totals |
| 3 | Repair preservation | Primary-repair regression | 100% of critic-supported optional claims and trailers retained byte-for-byte |
| 4 | Grounding | Draft parser, critic, and adversarial corpus | Zero unsupported rendered claims |
| 5 | Validation truth | Structured receipts and bounded recognized parsers | Every receipt represented; zero invented commands, counts, or manual checks |
| 6 | Title semantics | Type/scope corpus and critic checks | Correct allowed type; scope only when configured and unambiguous; <=72 characters |
| 7 | Provider cost | Workflow request-count assertions | 2 normally; <=5 on combined repair path |
| 8 | Init/config DX | Guided/headless/idempotency matrix | Safe defaults, repeatable output, no custom-file clobbering |
| 9 | Durable main history | Merge-path integration test | Reviewed PR title used for one squash commit; immutable reviewed head verified |
| 10 | PR #20 dogfood | Real configured-provider run | Summary, Changes, deterministic map, Validation, supported optional context, no unsupported claim |

For the PR #20 fixture, the deterministic baseline is:

- Documentation: 3 files, `+54 / -21`
- Implementation: 7 files, `+633 / -165`
- Tests: 10 files, `+468 / -30`

## Non-Goals

- No arbitrary prose-verbosity setting or minimum bullet count.
- No weakening or configuration of grounding, critic review, snapshot freshness,
  secret redaction, coverage, request ceilings, or output limits.
- No per-commit chronology in PR bodies; final net behavior is authoritative.
- No raw gate-output egress to a provider.
- No implicit GitHub issue fetch; reference-only remains the safe default.
- No mandatory DCO, signed-commit branch rule, or automatic legal attestation in
  this release. Revisit when external contributor volume or legal policy warrants it.
- No Changesets adoption for the current single-package release workflow.
- No GitHub repository-admin mutation inside `diffwright init`.

## Users and User Stories

- As a reviewer, I want every substantive change area represented so that a
  narrow title cannot hide most of a branch.
- As a maintainer, I want validation to distinguish observed results from
  supplied context so that generated PRs never overclaim testing.
- As a contributor, I want init to suggest stable scopes and install the local
  workflow contract so that I do not need to learn repository-specific syntax.
- As a release owner, I want one squash-ready main commit per completed PR while
  retaining fine-grained branch checkpoints during review.

## Tech Stack

- Language: strict TypeScript
- Runtime: Node.js 18, 20, and 22
- Tests: Node's built-in test runner against compiled CommonJS
- Git/GitHub: fixed-argv subprocesses through the sanitized command runner
- Configuration: strict, revision-pinned `.diffwrightrc.json`
- Provider boundary: existing OpenAI-compatible transport and redaction layer

## Commands

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm audit --omit=dev
git diff --check

# Dogfood
npm run commit -- --timings
npm run feature:pr -- --timings
```

## Project Structure

```text
src/change-evidence.ts     -> factual evidence and receipts
src/artifact-draft.ts      -> strict model-draft contract
src/artifact-critic.ts     -> terminal evidence audit and pruning
src/artifact-renderer.ts   -> deterministic commit/PR rendering
src/pr-workflow.ts         -> PR application service
src/commit.ts              -> commit application service
src/repository-policy.ts   -> pinned repository preferences
src/init.ts                -> guided setup orchestration
test/                      -> compiled unit/integration/distribution tests
specs/                     -> specification, review, and shipping evidence
```

## Code Style

Pure validators return frozen data; side effects remain in application services:

```ts
const map = buildChangeMap(evidence);
assertPullRequestClaimCoverage(evidence, auditedDraft);
const artifact = renderPullRequestArtifact(auditedDraft, evidence, map);
```

Key conventions:

- External/model/GitHub data is untrusted and strictly bounded.
- Deterministic facts are rendered locally, never authored by the model.
- Provider errors and rejected content are classified without echoing secrets or prose.
- New behavior lands in thin, compilable, separately revertible commits.

## Product Invariants

1. The final merge-base-to-HEAD net diff is the only authoritative PR change set.
2. Every changed file is classified exactly once in a deterministic change map.
3. Every substantive change evidence ID is cited by at least one observed,
   renderable, critic-supported change claim.
4. Supported optional claims survive primary repair byte-for-byte.
5. Primary repair replaces only the title, primary claim, and Summary anchor.
6. A repaired primary is criticized before reinsertion; the merged result is
   reparsed and revalidated before output or mutation.
7. Problem, rationale, compatibility, preserved-behavior, risk, non-goal, and
   follow-up prose requires the matching provided or observed evidence kind.
8. Changed tests never imply tests passed; receipts are authoritative.
9. Commit messages remain adaptive and are not subject to PR completeness rules.
10. Over-limit evidence or output fails closed rather than truncating silently.

## Pull-Request Information Architecture

Sections render in this order when supported:

1. Summary — one observed solution plus optional provided problem context
2. Changes — critic-supported change claims and deterministic category totals
3. Why
4. Compatibility
5. Review focus
6. Risks
7. Validation — authoritative receipts and clearly labeled supplied checks
8. Non-goals
9. Follow-ups

Empty optional sections remain absent. `Summary`, deterministic change
accounting, and `Validation` are always present for a non-empty PR workflow.

## Commit and Merge Contract

- Types follow Conventional Commit semantics, not filename heuristics alone.
- Stable configured scopes are used only when one subsystem is clearly supported.
- Plans and changelogs do not default to `fix`.
- A PR title must pass the same title policy used for commits and be suitable as
  the squash subject.
- Fine-grained branch commits are allowed; the supported merge path validates
  repository, reviewed head, PR title, and checks before requesting a squash merge.
- GitHub may append `(#NUMBER)` to the resulting main-branch subject.

## Configuration and Init Contract

The loader will accept existing version-1 policy unchanged and support an
explicit version-2 migration after the exact local Diffwright dependency is
updated. Version 2 may configure:

- allowed optional scopes;
- issue-context expectation: `optional`, `recommended`, or `required`;
- merge strategy: `squash` or `platform`;
- branch deletion after a successful Diffwright squash merge;
- PR-template creation/preservation.

Guided init suggests only high-confidence scopes from package/workspace names or
existing safe scoped history. Headless `--yes` never invents a scope allowlist.
Existing PR templates are preserved by default. Local file changes remain
previewed, atomic, idempotent, and concurrency-checked.

Repository-wide GitHub settings require a separate preview and explicit admin
confirmation; init only prints the recommended follow-up.

## Testing Strategy

- Pure unit tests for change mapping, completeness, title semantics, receipt
  parsing, policy migration, and repair merging.
- Integration tests with fake providers/Git/GitHub for request ceilings,
  mutation prevention, squash validation, and config pinning.
- Declarative corpus cases for semantic type/domain recall without exact prose snapshots.
- Packed distribution tests for new commands/config/schema files.
- One real-provider dogfood regeneration of PR #20 before review completion.

## Boundaries

**Always do:**

- Preserve final-net-diff, freshness, redaction, and no-shell boundaries.
- Validate configuration and generated artifacts before side effects.
- Recheck repository/head/title/checks immediately before merge mutation.
- Run the repository gates before every `npm run commit` handoff.

**Ask first:**

- Change GitHub repository merge/branch/signature settings.
- Add a runtime dependency or external GitHub App.
- Require legal DCO attestation or rewrite existing commit history.
- Fetch and send GitHub issue text to a model.

**Never do:**

- Invent counts, manual validation, intent, compatibility, or risk.
- Send raw gate output or repository-policy bytes to a provider.
- Let config disable critic, grounding, coverage, freshness, or redaction.
- Auto-add `Signed-off-by` or claim a verified signature.
- Merge by an ambient branch ref or an unvalidated PR title.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sparse model drafts fail new completeness rules | High | Medium | One bounded coverage repair; fail closed after ceiling |
| Richer bodies become noisy on large PRs | Medium | Medium | Aggregate deterministic totals and cluster claims; no file-per-bullet requirement |
| Primary repair keeps an invalid optional claim | Low | High | Retain only supported verdicts and re-audit merged draft |
| Scope policy leaks internal naming | Low | Medium | Send only explicitly approved bounded tokens; default to local omission |
| Gate-output parsing captures sensitive text | Medium | High | Bounded registered parsers emit numeric facts only; raw bytes never enter evidence |
| Merge command mutates the wrong repository/head | Low | High | Reuse pinned origin identity, immutable SHA, explicit repo, and final freshness checks |
| Init clobbers existing policy/template | Low | High | Safe planning, markers, hash recheck, atomic writes, preserve-by-default |

## Open Questions

- [x] DCO, mandatory signatures, and Changesets are deferred for this release.
- [x] Issue reference remains offline; explicit issue-body ingestion is deferred.
- [x] PR completeness is immutable rather than a verbosity preference.
- [x] GitHub-admin configuration is separate from init.

## References

- [Vercel Eve PR #2152](https://github.com/vercel/eve/pull/2152)
- [Vercel Eve PR template](https://github.com/vercel/eve/blob/main/.github/pull_request_template.md)
- [Vercel Eve contributing guide](https://github.com/vercel/eve/blob/main/CONTRIBUTING.md)
- [Diffwright PR #8](https://github.com/AndrewUlloa/diffwright/pull/8)
- [Diffwright PR #18](https://github.com/AndrewUlloa/diffwright/pull/18)
- [Diffwright PR #20](https://github.com/AndrewUlloa/diffwright/pull/20)
- `specs/evidence-backed-generation-v2/SPEC.md`

## Sign-off

- [x] Author has written this spec
- [x] Assumptions confirmed by the requester's instruction to implement all adoptions
- [x] Success criteria are measurable
- [x] Boundaries agreed
- [x] Open questions resolved or explicitly deferred
- [x] Human reviewed the recommendations and approved implementation
