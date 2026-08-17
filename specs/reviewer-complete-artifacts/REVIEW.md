# Review: Reviewer-complete artifacts and durable history

> Spec: `specs/reviewer-complete-artifacts/SPEC.md`
> Status: implementation review passed; live PR review pending
> Reviewed: 2026-08-17

## Verdict

The implementation is ready for final PR #20 dogfood and hosted review. The
local correctness, compatibility, security, packaging, and evaluation gates
have no unresolved required finding. Final sign-off remains conditional only on
the regenerated PR artifact, hosted CI, and CodeRabbit review at the final head.

## Five-axis review

### Correctness

- Pull requests use one pinned merge-base-to-HEAD net diff. Reverted
  intermediate work is excluded; deletes, renames, binary metadata, and every
  final changed path remain represented.
- Every final change is classified once in the deterministic change map, and
  every substantive evidence ID must be cited by a critic-supported observed
  change claim before rendering.
- Large mixed pull requests use a bounded model projection that retains every
  safe-to-egress substantive changed line, omits unchanged context and
  supporting-file patches, keeps policy contents metadata-only, redacts
  configured secrets, and leaves complete supporting accounting to the
  deterministic map.
- A rejected primary claim no longer destroys supported optional detail. The
  replacement changes only the title, primary claim, and Summary anchor, is
  criticized separately, and is merged back under the five-request ceiling.
- Conventional Commit grammar, semantic type selection, configured scopes,
  base-pinned PR title checking, and the guarded squash subject share the same
  deterministic policy boundaries.
- Validation prose comes from observed receipts. Changed test files do not
  imply passing tests, and unsupported counts or manual checks are not rendered.

### Readability

- Generated PRs lead with one outcome, then deterministic Changes accounting,
  evidence-adaptive context, and exact Validation rather than mandatory filler.
- Commit messages remain concise and adaptive; PR completeness does not force
  commit-message boilerplate.
- Public help, README, CLI reference, changelog, contributor guidance, agent
  blocks, schema, and the managed PR template describe the same workflow.
- The executable corpus evaluates structure, domains, totals, and semantics
  without brittle snapshots of model-authored prose.

### Architecture

- Factual evidence, change mapping, completeness, title semantics, criticism,
  deterministic rendering, and side-effecting workflows remain separate.
- Repository policy is strict data, pinned to committed HEAD for commits and to
  the exact base SHA for PR/title/merge decisions. Feature policy cannot weaken
  the operation that reviews it.
- The merge service performs no provider call. It binds Git and GitHub to one
  validated repository identity, rechecks state twice, and makes one explicit
  squash API mutation for the reviewed SHA.
- Guided init follows discovery, bounded answers, redacted preview, confirmation,
  post-confirmation replanning, atomic file application, and offline doctor.

### Security

- Credentials remain out of evidence, logs, errors, child environments, GitHub
  titles, and mutation arguments. Repository policy contents are replaced by
  bounded metadata before provider egress.
- Staged commits bind HEAD and the exact index tree through hooks; PRs bind local
  and remote head/base state; the final push and merge use immutable SHAs rather
  than ambient branch tips.
- GitHub repository, fetch URL, push URL, PR identity, title, checks, reviews,
  merge state, and merge-queue state fail closed on drift or ambiguity.
- The trusted PR-title workflow executes only the exact base SHA with read-only
  permissions. It never executes feature-branch validator or workflow code.
- Init/template targets reject symlink, hardlink, special-file, invalid UTF-8,
  oversized, concurrent-content, and parent-directory replacement attacks.

### Performance

- `--timings` reports fixed privacy-safe phases and exclusive nested durations
  without paths, evidence text, credentials, or telemetry.
- Normal synthesis remains two provider requests. Local deterministic map,
  completeness, title, and receipt checks add no provider calls; all repair
  combinations remain bounded at five.
- Model-evidence size is preflighted before project gates. Supporting patches
  cannot consume provider context or support generated prose, while substantive
  changed lines remain complete.
- The implementation keeps TypeScript orchestration and native Git traversal.
  It does not add a Rust sidecar or persistent search index without a measured
  repository-wide search bottleneck.
- Unchanged configuration, template, and agent transforms skip writes and
  preserve modification times.

## Required findings resolved

- Minimal primary repair discarding supported PR sections and trailers.
- One-bullet PRs that omitted most substantive implementation areas.
- Test-file changes being confused with observed validation.
- Free-prose PR titles that lost Conventional Commit syntax after squash.
- Literal `fix` and scope-erasing repair bias.
- Untrusted feature policy weakening title or merge enforcement.
- Stale Git/GitHub repository, head, base, PR, review, check, or title state.
- Merge-queue/admin bypass and high-level `gh pr merge` no-op ambiguity.
- Provider secrets in titles, logs, errors, subprocesses, or GitHub mutation.
- Pull-request title CI executing feature-branch workflow or validator code.
- Unbounded or replaceable event-file reads.
- Init overwrites of custom policy, templates, scripts, prose, or nested paths.
- Version-2 required issue context being recorded without runtime enforcement.
- Platform merge preferences being ignored and post-merge branch deletion
  lacking an atomic reviewed-SHA lease.
- Yarn/local executable provenance and argument-forwarding regressions retained
  from the guided-init compatibility boundary.

## Verification evidence before hosted review

- Full repository gate — typecheck, all 434 tests, and build passed after the
  final issue-context and merge-policy corrections.
- `npm run commit` — passed the preceding 430-test checkpoint, Groq generation,
  local commit integrity checks, and immutable-SHA push for the corpus checkpoint.
- Focused packed-install/governance/evaluation suite — 31/31 passed against the
  packed Diffwright and ChangeScribe bridge.
- `npm pack --dry-run --json` — passed; 84 package entries.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `npm audit signatures` — 39/39 registry signatures verified.
- `git diff --check` — passed.

## Remaining release evidence

- Regenerate PR #20 through `npm run feature:pr -- --timings`.
- Confirm the final body covers every substantive live change and contains the
  deterministic Changes and authoritative Validation sections.
- Require hosted CI and CodeRabbit to be green at the final head.
- Run `npm run pr:merge -- --yes` and verify one reviewed squash commit on
  `main`.
