# Evaluation: PR #20 Before and After

> Evaluated: 2026-08-17
> Base: `f3f122da106c6051694ffd6ea7a40390a6b06622`
> Head: `1a100ad644a00fee702e60ac66c7b15d4cec4dcb`
> Provider: Groq using the repository's configured exact model

## Frozen Before

This is the exact body merged on PR #20.

```markdown
## Summary

- Add comprehensive timing, policy, and workflow enhancements.

## Changes

- **Implementation:** 23 files (+5303 / -435)
- **Tests:** 28 files (+6374 / -113)
- **Documentation:** 12 files (+1226 / -53)
- **Configuration:** 4 files (+90 / -1)

## Validation

- Skipped (not configured): `npm run format`
- Passed: `npm test` in 57.58 s — 439/439 tests passed
- Passed: `npm run build` in 1.21 s
```

## Generated After

This body was generated offline from the pinned PR #20 base and head. It did
not use an issue or context file and did not mutate GitHub.

```markdown
## Summary

- Update repository tooling, CI configuration, and core scripts.

## Changes

- Add .diffwrightrc.json configuration file.
- Add pull request template.
- Add PR title workflow.
- Update argument parsing logic.
- Add artifact completeness module.
- Add artifact critique utilities.
- **Implementation:** 23 files (+5303 / -435)
- **Tests:** 28 files (+6374 / -113)
- **Documentation:** 12 files (+1226 / -53)
- **Configuration:** 4 files (+90 / -1)
```

The offline generation path intentionally did not execute project gates, so it
had no validation receipts to render. The production `--create-pr` path still
renders exact captured receipts.

## Evidence and Request Audit

- The immutable range contains 32 checkpoint commits. All 32 bodies are empty.
- History subjects were available as supplemental authored labels, but could
  not support Why, Risk, compatibility, or validation claims.
- The final net diff remained authoritative: 67 files, 12,993 additions, and
  602 deletions.
- Editorial classification found 26 substantive source or executable
  configuration items, which requires six detailed reviewer themes under the
  proportional rule.
- Every rendered prose claim passed the critic against its cited final-diff
  evidence. No Why or Risk section was invented.
- Configured secrets were redacted before provider egress. Repository-policy
  patch contents remained metadata-only.
- The successful run used three provider requests: strict-schema draft,
  JSON-only draft fallback, and terminal critic.

## Timings

```text
git-evidence: 686.319 ms
context: 0.415 ms
policy: 24.319 ms
provider-draft: 24,419.331 ms
provider-critic: 8,511.976 ms
render: 28.502 ms
total: 33,670.862 ms
```

## Verdict

The after body is structurally better: it adds six critic-supported change
details while retaining complete deterministic accounting and refusing to
invent motivation. It also demonstrates that the 256 KiB ceiling was not the
cause of the original collapse.

The editorial result is still not the target quality. Several bullets are
file-oriented inventory statements rather than reviewer-oriented descriptions
of behavior and architecture. This is a partial dogfood success: the new
structure prevents a one-bullet collapse, but the next improvement should make
the selected themes more representative and explanatory without weakening
grounding or inventing rationale.

## Topic-Quality Assessment

The first history-aware run is retained as a failed editorial benchmark, not as
the shipping acceptance result.

| Metric | Frozen before | First history-aware run | Required next run |
|---|---:|---:|---:|
| Required PR #20 topic recall | 0 / 6 | approximately 3 / 6 | 6 / 6 |
| Inventory-only detail claims | 0 (no detail claims) | 6 / 6 | 0 / 6 |
| Unsupported Why/Risk | 0 | 0 | 0 |
| Deterministic file accounting | complete | complete | complete |

The six required reviewer topics are:

1. operation timing and subprocess timeout behavior;
2. critic pruning, primary rejection, repair, and completeness enforcement;
3. model-evidence projection and deterministic change accounting;
4. evidence-derived title semantics and the trusted title-check workflow;
5. guarded squash merge, repository identity, and deleted-fork handling; and
6. repository policy, guided init/configuration, templates, and branch deletion.

The first run mentioned configuration/templates, the title workflow, and
critic/completeness modules, but it did not explain timings, projection and
accounting, or the guarded merge path. Its statements were grounded yet still
too close to a file list. The replacement contract therefore scores structured
topics against flexible path/mechanism oracles instead of treating bullet count
as quality.
