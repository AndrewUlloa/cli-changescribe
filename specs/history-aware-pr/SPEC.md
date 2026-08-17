# Spec: History-Aware, Proportionate PR Narratives

> Filed by: Codex implementation team
> Status: approved by the 2026-08-17 user request
> Last updated: 2026-08-17

## One-line Summary

Diffwright will use pinned branch commit messages as supplemental authored
history and require proportionate, critic-grounded change detail for broad pull
requests without weakening final-net-diff authority or the 256 KiB provider
boundary.

## Problem

PR #20 ended with a truthful but shallow generated body:

```markdown
## Summary

- Add comprehensive timing, policy, and workflow enhancements.

## Changes

- **Implementation:** 23 files (+5303 / -435)
- **Tests:** 28 files (+6374 / -113)
- **Documentation:** 12 files (+1226 / -53)
- **Configuration:** 4 files (+90 / -1)
```

The deterministic map accounted for the branch, but one broad Summary claim
cited the complete substantive evidence set and therefore satisfied structural
coverage without giving reviewers several concrete change themes. The branch
also contained 32 useful checkpoint subjects, but the PR evidence bundle did
not include them. Every checkpoint body was empty, so that history can improve
change naming but cannot honestly prove motivation, risks, or tradeoffs.

The 256 KiB model-evidence ceiling was not the failure: PR #20 passed the
projection preflight. Exceeding the ceiling is a terminal error, never a signal
to silently shorten prose.

## Objective

Generate a materially more useful PR #20 narrative by:

1. collecting commit subjects and bodies from the immutable
   `merge-base..HEAD` range;
2. labeling that material as authored history, not observed truth;
3. allowing nonempty commit bodies to support authored rationale while keeping
   subjects limited to change naming and chronology;
4. requiring broad PRs to contain several bounded, critic-supported Changes
   claims whose union covers every substantive final-diff item; and
5. preserving the existing deterministic map, validation receipts, request
   ceiling, redaction, freshness, and final-net-diff authority.

## Success Criteria

| # | Criterion | Measurement | Target |
|---|---|---|---|
| 1 | Pinned history | Collector fixture with divergent/reverted commits | Only commits in the immutable merge-base-to-head range are included |
| 2 | History provenance | Evidence validation and provider-request assertions | Every history item is `provided`; no history item becomes observed change or verification evidence |
| 3 | Safe intent | Claim-validation fixtures | Subject-only history cannot support Why/Risk; a cited nonempty body may support conservative authored rationale after criticism |
| 4 | Proportionate detail | Pure breadth invariant | PRs with at least four substantive items require `min(6, ceil(sqrt(n)))` non-primary Changes claims |
| 5 | Bounded claims | Pure breadth invariant | Each detail claim cites at most `ceil(n / requiredClaims) + 1` substantive items |
| 6 | Detailed completeness | Post-critic validation | Non-primary Changes claims—not the broad Summary alone—cover 100% of substantive evidence IDs |
| 7 | Provider cost | Workflow integration tests | Normal path remains two requests; all repairs remain at or below five |
| 8 | Safety | Existing security and model-projection tests | 256 KiB ceiling, secret redaction, protected policy bytes, and omitted-evidence grounding remain unchanged |
| 9 | PR #20 comparison | Real-provider offline regeneration | Before and after bodies are recorded side by side; after contains several supported Changes bullets and invents no Why/Risk |

## Proportionate Narrative Rule

Let `n` be the number of substantive final-diff evidence items.

- For `n < 4`, the existing Summary plus deterministic map remains sufficient.
- For `n >= 4`, require `min(6, ceil(sqrt(n)))` non-primary observed change
  claims in the Changes section.
- Those claims collectively cite every substantive evidence ID.
- Each claim cites no more than `ceil(n / requiredClaims) + 1` substantive IDs.
- A claim may cite history in addition to change evidence, but history never
  substitutes for final-diff coverage.

This creates bounded editorial breadth without a configurable verbosity switch
or one bullet per file. For PR #20, the expected target is five detailed Changes
claims across roughly five substantive items each.

## Evidence Semantics

### Observed final diff

The merge-base-to-HEAD net diff remains the only authoritative account of what
the PR changes. Reverted intermediate work is absent. Freshness checks remain
bound to the pinned head, base, and merge base.

### Authored history

Commit history is supplemental `provided` evidence:

- subject and body are collected with full commit SHA provenance;
- history is bounded by the existing positive `--limit` option;
- subjects may help name or group observed changes;
- only nonempty bodies may support authored problem/rationale/risk/follow-up
  claims, and the critic must confirm every cited item materially supports the
  exact claim;
- history cannot prove validation, compatibility, preserved behavior, or final
  code state by itself;
- commit order never appears as a mandatory chronology in rendered output.

### Explicit context

`--context-file` remains the strongest authored intent source. `--issue` remains
reference-only unless a separately specified opt-in issue-ingestion feature is
implemented.

## Always / Ask First / Never

### Always

- Pin history to the same immutable snapshot as final-diff evidence.
- Treat commit messages as untrusted data and redact configured secrets before
  provider egress.
- Require final-diff IDs on every rendered change claim.
- Re-run breadth and coverage checks after every repair and critic filter.
- Preserve the deterministic change map and exact validation receipts.

### Ask First

- Sending a private context file or issue body to a provider.
- Increasing provider request ceilings or the 256 KiB projection ceiling.
- Adding repository-configurable weakening of narrative breadth.

### Never

- Never treat a commit subject as proof of motivation, risk, validation, or
  compatibility.
- Never let history resurrect work reverted from the final net diff.
- Never accept one catch-all Summary claim as sufficient detail for a broad PR.
- Never silently truncate history, evidence, or generated prose to fit a limit.
- Never add another provider call solely to polish prose.

## Backwards Compatibility

- Command names, aliases, options, output paths, provider configuration,
  ChangeScribe forwarding, and GitHub mutation behavior remain unchanged.
- `--limit` becomes effective for supplemental history while continuing never
  to limit final-net-diff evidence.
- Small PRs retain adaptive concise output.
- Existing evidence schema version remains internal and compatible with current
  serialized fields; history already exists as a supported evidence kind.

## Test and Evaluation Strategy

- Unit tests for NUL-safe bounded history collection and validation.
- Adversarial claim tests proving subject-only commits cannot support rationale.
- Pure breadth tests at boundaries `n = 0, 3, 4, 25, 36, 100`.
- Workflow tests for initial draft, deterministic repair, primary replacement,
  coverage repair, critic pruning, request ceilings, and omitted-evidence
  grounding.
- A frozen PR #20 before body and one live offline after body generated from the
  original base/head SHAs. The comparison is review evidence, not a brittle prose
  snapshot test.

## Rollback

The feature lands in separately revertible slices: history collection, breadth
validation, workflow orchestration, and documentation/evaluation. Reverting the
workflow slice restores current concise behavior without changing Git evidence,
merge safety, configuration, or published output formats.
