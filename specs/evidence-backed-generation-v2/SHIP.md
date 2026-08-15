# Ship: Evidence-Backed Generation v2

> Pull request: [#18](https://github.com/AndrewUlloa/diffwright/pull/18)
> Prepared: 2026-08-15
> Current package version: `0.5.0`
> Recommended next version: `0.6.0`

## Release decision

The branch is ready for maintainer review and a separate merge decision. This
document does not authorize or perform a merge, npm publication, GitHub
release, version bump, or dist-tag change.

`0.6.0` is the recommended pre-1.0 release because the staged-only commit
default, explicit headless PR approval, evidence-linked generation, and
repository-policy surface are meaningful behavioral changes.

## Release scope

- Replace formulaic commit prose and chained per-commit PR summaries with a
  structured evidence-to-artifact pipeline.
- Make staged Git state authoritative for direct commits and the final
  `merge-base...HEAD` diff authoritative for pull requests.
- Add deterministic Conventional Commit rendering, advisory editorial checks,
  observed gate receipts, terminal evidence criticism, and exact Git/GitHub
  freshness checks.
- Add bounded generic context files, interactive PR review/editing, and pinned
  repository policy through `.diffwrightrc.json` plus its published JSON Schema.
- Preserve guided init, package-manager-aware gates, ChangeScribe compatibility,
  credential redaction, fixed-argv subprocesses, and Node 18/20/22 support.

## Compatibility and migration

- `diffwright commit` analyzes the existing index and never stages working-tree
  changes. Use `diffwright commit --all` for the previous stage-all behavior.
- Diffwright-managed initializer scripts migrate to explicit `commit --all`.
  Custom scripts remain unchanged.
- Interactive `pr --create-pr` previews the exact title/body before mutation.
  Headless automation must add `--yes` explicitly.
- A normal successful generation makes two provider requests: draft and
  terminal critic. Deterministic validation can trigger one provider repair
  request, raising the maximum to three. There is no SDK retry or provider
  failover.
- Repository policy is optional. An absent `.diffwrightrc.json` uses immutable
  safe defaults; malformed or unsafe committed policy fails closed.

## Release gates

Before merge or publication, run from the release candidate SHA:

```bash
npm run typecheck
npm test
npm pack --dry-run
npm audit --omit=dev
npm audit signatures
git diff --check
```

Required GitHub checks are the CI matrix on Node 18, 20, and 22 plus the review
status. The package tarball must include
`documentation/diffwrightrc.schema.json` and every compiled v2 module/source
map.

### Local release-candidate verification

| Gate | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | Pass: 316 tests, 0 failures |
| `npm pack --dry-run --json` | Pass: 70 package entries; policy Schema and compiled v2 modules/maps present |
| `npm audit --omit=dev` | Pass: 0 vulnerabilities |
| `npm audit signatures` | Pass: 39 of 39 packages have verified registry signatures |
| `git diff --check` | Pass |

These results were recorded on 2026-08-15 from the final pre-commit working
tree. The Diffwright commit workflow reruns typecheck, tests, and build against
the exact committed contents. GitHub CI and review status are rechecked after
the commit is pushed.

## Rollout

1. Review and merge PR #18 only after the final evidence commit is green and no
   actionable review thread remains.
2. Bump to `0.6.0` in a separate release change and update release notes.
3. Draft and publish the `v0.6.0` GitHub Release targeting `main`, following
   `documentation/releases.md`. Publishing that release triggers the existing
   GitHub Actions release workflow.
4. Let the workflow run the same typecheck, test, audit, signature, pack,
   provenance, npm publication, and GitHub Release attachment gates.
5. Verify the npm page, provenance badge, GitHub release assets, `latest`
   dist-tag, and a clean temporary-project install before announcing.

## Failure recovery and rollback

- **Before merge:** keep PR #18 open or close it; no registry or consumer state
  changes.
- **After merge but before publication:** revert the merge through a reviewed
  pull request or ship a focused fix-forward change. Do not publish a known-bad
  candidate.
- **After publication:** prefer a patch release. If immediate containment is
  necessary, deprecate the affected version and restore the prior stable
  dist-tag only after explicit maintainer approval:

  ```bash
  npm deprecate diffwright@0.6.0 "Use 0.6.1 or later"
  npm dist-tag add diffwright@0.5.0 latest
  ```

- Do not delete tags, rewrite published provenance, force-push release refs, or
  unpublish the package as an automatic rollback.

## Release-note draft

Diffwright 0.6 makes Git evidence—not a prose template—the source of truth for
commits and pull requests. Commits now inspect only intentionally staged work by
default. Pull requests describe the final branch diff, including deletions and
renames, while excluding intermediate work reverted back to the base. Generated
claims cite structured
evidence, verification comes from commands that actually ran, and a terminal
critic can veto unsupported prose. Conventional Commit titles, repository
policy, interactive GitHub review, credential redaction, and snapshot freshness
remain deterministic local safeguards around the configured model.

## Approval boundary

No merge, version bump, npm publication, GitHub release, or dist-tag mutation
is authorized by this artifact. Each remains a separate maintainer action.
