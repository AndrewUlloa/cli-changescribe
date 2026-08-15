# Review: Evidence-Backed Generation v2

> Branch: `codex/evidence-backed-generation-v2`
> Base: `main`
> Pull request: [#18](https://github.com/AndrewUlloa/diffwright/pull/18)
> Reviewed: 2026-08-15

## Outcome

The implementation is ready for release preparation. No required correctness,
security, architecture, readability, or performance finding remains open.
Package publication and merge remain separate maintainer decisions.

## Five-axis review

| Axis | Outcome | Evidence |
|---|---|---|
| Correctness | Pass | Staged commits bind generation to `HEAD` and the index tree. PRs bind generation to pinned base, merge-base, local head, and remote head SHAs. Deletion, rename, revert, hook mutation, stale-ref, repair, and incomplete-evidence fixtures fail closed. |
| Readability | Pass | Models return bounded structured drafts; deterministic renderers own Conventional Commit grammar and PR sections. Optional prose is omitted instead of filled. Public docs distinguish observed evidence, provided intent, inference, and advisory style. |
| Architecture | Pass | Evidence collection, draft validation, terminal criticism, rendering, review, policy loading, and mutation are separate modules. Git and GitHub remain fixed-argv boundaries. Repository policy is data-only and pinned to committed Git state. |
| Security | Pass | Secrets are redacted from prompts, logs, errors, subprocess arguments, and child environments. Context and policy files reject unsafe links, controls, invalid UTF-8, replacement races, and oversized input. Git and GitHub mutations revalidate reviewed snapshots. |
| Performance | Pass with measured follow-up | Collection is bounded and operates only on changed Git paths. The implementation adds no native dependency or repository-wide index. Provider, gate, and Git phases remain explicit; privacy-safe timing and large-repository benchmarks are deferred before any caching, batching, or native rewrite. |

## Success-criteria evidence

1. Material model-authored claims must reference recognized evidence, then pass
   a terminal critic against the original evidence. The critic is a separate
   request to the same resolved provider and model; it is a veto, not an
   independent model or truth oracle.
2. PR evidence comes from the final `merge-base...HEAD` net diff and covers
   additions, modifications, deletions, renames, and binaries. Intermediate
   work reverted back to the base is absent from the review artifact.
3. Verification text comes from captured receipts. Only exit status zero can be
   rendered as passed; a model-created Verification section is not required to
   display an observed receipt.
4. Commit and squash titles share deterministic Conventional Commit parsing,
   repository policy, breaking-change handling, optional scope rules, and the
   immutable 72-character hard maximum.
5. Direct `diffwright commit` is staged-only. `--all` is the explicit opt-in
   used by migrated Diffwright-managed npm scripts.
6. GitHub create or update requires interactive approval, or explicit `--yes`
   in headless automation. The reviewed SHA and exact title/body bytes are
   revalidated before mutation.
7. Oversized, partial, stale, unsafe, malformed, or unsupported evidence stops
   generation or records an explicit coverage gap. It is never silently
   presented as complete.
8. The packed package includes every compiled module, source map, public
   document, and the repository-policy JSON Schema. The ChangeScribe bridge and
   guided initializer remain covered by distribution tests.

## Review history

- Three independent agent reviews covered architecture/performance,
  correctness/security/compatibility, and editorial/docs/release behavior.
- CodeRabbit findings were verified against the current code instead of being
  applied mechanically. All required findings were fixed. Review threads were
  answered and resolved.
- The proposed change to hide gate receipts when the model omitted a
  Verification section was rejected after an end-to-end test showed that it
  would discard objective successful gate results. A regression test records
  the intended receipt behavior.
- Final dogfooding exposed that root fixture data could displace a smaller
  substantive source change in the generated subject. Fixture directories are
  now supporting when source changes exist, while fixture-only work can still
  be primary; a regression test records both cases.

## Residual risks and deferred work

- The draft and critic currently use the same configured provider and model.
  A future cross-family critic must be explicit and opt-in because it sends the
  same repository evidence to another vendor.
- Large evidence remains bounded and fails closed. Content-addressed chunking
  or batched Git-object reads require benchmarks and the same complete-coverage
  contract before adoption.
- Phase timings, a no-model `diffwright check`, editor or commit-message hooks,
  and optional discovery of Biome, Oxlint, or Ultracite gates are useful future
  slices. None is required for the v2 evidence contract.
- Rust or a persistent regex index is not justified without a measured local
  CPU or I/O bottleneck. Native tooling would add platform packaging, signing,
  provenance, and fallback obligations while leaving Git, provider, and gate
  latency unchanged.

## Verification record

The final command results and live CI state are recorded in `SHIP.md` after the
release-evidence commit.
