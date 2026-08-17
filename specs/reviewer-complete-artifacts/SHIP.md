# Ship: Reviewer-complete artifacts and durable history

> Status: release candidate; live PR evidence pending
> Branch: `codex/phase-timings`
> Pull request: `#20`
> Target release: next minor after `0.6.0`

## What ships

- Reviewer-complete PR generation with deterministic final-diff accounting and
  blocking substantive-evidence coverage.
- Preservation and bounded replacement of critic-supported PR detail.
- Semantic Conventional Commit types, optional confirmed scopes, and canonical
  squash-ready PR titles.
- Exact validation receipts and privacy-safe exclusive `--timings` reports.
- Revision-pinned repository policy v2 plus guided scope, context, merge, branch
  deletion, agent, and reviewer-template setup.
- Trusted-base PR-title CI and a guarded, zero-provider squash-merge command.
- Diffwright's own policy, template, contributor contract, agent rules, and
  `pr:merge` dogfood path.
- An executable evaluation corpus that keeps structural runtime gates separate
  from model-quality domain oracles.
- A bounded large-PR projection that preserves every safe-to-egress substantive
  changed line, keeps policy contents metadata-only, redacts configured secrets,
  and relies on deterministic local accounting for supporting changes.

## Compatibility

- Node.js 18, 20, and 22 remain supported.
- npm, pnpm, Yarn, and Bun project-command generation remains argv-safe and
  package-manager-aware.
- Existing `.diffwrightrc.json` version 1 loads unchanged. Version 2 migration
  occurs only after the exact local Diffwright dependency is available.
- Existing custom scripts, PR templates, and unmarked agent prose remain owned
  by the repository.
- Existing command aliases, ChangeScribe bridge behavior, provider support, and
  noninteractive mutation safety remain intact.
- DCO, required commit signatures, Changesets, automatic issue-body fetching,
  GitHub admin changes, and merge-queue support are deliberately not introduced.

## Security and privacy

- No raw gate output, policy contents, repository paths in timing reports, or
  credentials are added to provider requests.
- Criticism is a separate terminal request using the configured provider/model;
  it is not represented as an independent model-family review.
- Git and GitHub mutations remain fixed-argv/no-shell and snapshot-bound.
- Merge rejects queues, ambiguous repositories/PRs, stale heads/bases, unsafe
  titles, non-green checks, unresolved reviews, and unknown outcomes.
- `pull_request_target` title validation checks out and executes only the exact
  trusted base SHA with read-only permissions.

## Rollout

1. Commit this final documentation/evidence checkpoint through `npm run commit`.
2. Regenerate PR #20 through `npm run feature:pr -- --timings`.
3. Inspect the generated title/body, deterministic change map, exact Validation,
   and timing report; do not hand-edit the artifact.
4. Wait for every hosted CI check and CodeRabbit review at the final head.
5. Address valid findings in new Diffwright-generated commits, regenerate the
   PR, and repeat until no required finding remains.
6. Run `npm run pr:merge -- --yes`. Verify PR #20 is `MERGED` and `main`
   advances by one squash commit with the reviewed Conventional Commit title.
7. Create a dedicated next-minor release PR that updates package manifests and
   moves `[Unreleased]` into a dated changelog section.
8. After that release PR merges, publish the matching GitHub Release/tag
   targeting `main`; the release workflow then publishes the exact provenance
   tarball to npm.

## Rollback

- Before npm publication, revert the single PR #20 squash commit through a new
  reviewed pull request. Do not rewrite `main` or move a tag.
- After publication, ship a new patch version. npm versions and published tags
  are immutable and are never overwritten.
- If GitHub merging is unavailable or a merge queue is required, leave PR #20
  open and use the platform workflow only after an explicit policy decision;
  do not bypass the guarded command with admin flags.
- If the title workflow cannot become a required rule immediately, keep its
  status visible and protect workflow changes by review until the repository
  ruleset is updated separately.

## Local release evidence

- Full repository gate: 434/434 tests passed.
- Packed install and focused governance/evaluation: 31/31 passed.
- Package dry run: 84 entries, executable bin and all compiled modules present.
- Dependency audit: 0 vulnerabilities.
- Registry signature audit: 39/39 verified.
- No runtime dependency was added.

## Live evidence to record before merge

- Final PR title and generated body reviewed: pending.
- `--timings` report captured locally without sensitive data: pending.
- Hosted CI final head: pending.
- CodeRabbit final head: pending.
- Guarded merge postcondition and resulting main SHA: pending.
