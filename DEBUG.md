# Debug: 0.4.0 ChangeScribe packed resolution

## Observations

- `npm publish --dry-run` for `diffwright@0.4.0` stopped because the packed
  distribution test compared new Diffwright help with old ChangeScribe help.
- The direct packed `diffwright` binary printed the new guided-init and
  `--version` help, while packed `changescribe` printed the published 0.3.2
  help.
- The distribution fixture installs the candidate Diffwright tarball and the
  candidate ChangeScribe bridge tarball in one clean project.
- `cli-changescribe@0.2.3` declares `diffwright: ^0.3.0` and loads
  `require('diffwright/bin/diffwright.js')` from its own package location.
- The failure appeared only after changing the candidate version from 0.3.2
  to 0.4.0; all 0.3.2 packed tests passed.
- Environment: macOS, current workspace Node/npm, writable isolated npm cache,
  npm registry authenticated as `andrewulloa`.

## Hypotheses

### H1: The bridge range excludes 0.4.0 and npm installs nested 0.3.2 (ROOT HYPOTHESIS)

- Supports: caret ranges below 1.0 are minor-bounded; `^0.3.0` does not include
  0.4.0. The bridge output exactly matches published 0.3.2 while the root
  candidate output is 0.4.0.
- Conflicts: none.
- Test: install both packed candidates in a fresh project and inspect
  `npm ls diffwright --all` plus the bridge-resolved package path/version.

### H2: npm reused a stale 0.3.2 candidate tarball from cache

- Supports: npm uses a cache and 0.3.2 was previously packed repeatedly.
- Conflicts: the direct binary from the same install prints new 0.4.0 help and
  the dry run uses an isolated cache.
- Test: inspect the root installed manifest and tarball manifest versions.

### H3: Node bridge resolution incorrectly prefers a nested package even when the root is compatible

- Supports: the bridge loads through a package-relative `require`, so a nested
  dependency wins when present.
- Conflicts: the prior 0.3.2 clean-install test proved root deduplication and
  explicitly asserted that no nested Diffwright copy existed.
- Test: widen only the candidate bridge dependency range in a temporary copy,
  repack, and confirm npm deduplicates to the root 0.4.0 candidate.

## Experiments

1. Packed `diffwright@0.4.0` and `cli-changescribe@0.2.3`, then ran the real
   distribution install. The direct Diffwright binary exposed the new 0.4.0
   help while the bridge exposed the published 0.3.2 help. This rejects H2:
   both candidates came from fresh tarballs and the new root package was
   installed correctly.
2. Compared the candidate versions against the bridge range. Semver
   `^0.3.0` accepts releases from 0.3.0 up to, but not including, 0.4.0.
   Therefore the root 0.4.0 candidate cannot satisfy the bridge dependency,
   and npm must resolve another compatible package for the bridge. This
   confirms H1 and explains the package-relative 0.3.2 resolution in H3.
3. Widened the bridge range to `>=0.3.0 <1`, bumped the bridge to 0.2.4, and
   retained the packed clean-install assertion that the bridge resolves the
   same candidate Diffwright package with no nested copy.

## Root Cause

`cli-changescribe@0.2.3` constrained Diffwright to `^0.3.0`, which excludes
the new 0.4.0 release; npm consequently resolved the bridge through a separate
published 0.3.x dependency instead of the packed 0.4.0 candidate.

## Fix

- Publish `cli-changescribe@0.2.4` with `diffwright: >=0.3.0 <1`, matching the
  bridge's intentionally thin delegation contract across pre-1.0 Diffwright
  releases.
- Keep the packed end-to-end regression test version-aware and require the
  bridge to resolve the exact candidate package without a nested Diffwright.
- Publish `diffwright@0.4.0` before the bridge so the widened dependency is
  satisfiable from the public registry when the bridge goes live.

---

# Debug: PR synthesis grounding and title selection

## Observations

- Diffwright created PR #13 from two current branch commits after all PR gates
  passed.
- The generated body claimed that `init` has a `--package-manager` option,
  claimed `--dry-run` bypasses interactive prompts, and warned that a no-argument
  non-TTY invocation would hang. None of those claims match the implemented CLI
  contract.
- The generated title is `f9dbada – release: add guided init workflow and bump
  version to 0.4.0`, exactly the SHA-prefixed first commit bullet from the
  generated “What change” section.
- Pass 2 receives the raw commit diff, while pass 3 receives only condensed
  summaries, the 5Cs snapshot, and commit titles.
- `extractPrTitle` selects the first bullet under “What change” and only removes
  Markdown styling; it does not distinguish an overall branch summary from a
  SHA-prefixed per-commit bullet.
- Environment: macOS, Node 24, Diffwright 0.4.1, Groq
  `openai/gpt-oss-120b`, GitHub PR #13.

## Hypotheses

### H1: Pass 2 invents option and behavior claims because its grounding rule is too broad (ROOT HYPOTHESIS)

- Supports: the prompt forbids unshown technologies but does not specifically
  forbid invented CLI flags or unsupported behavioral/test claims.
- Conflicts: pass 2 receives the raw diff, so the correct facts are available.
- Test: search the exact branch diff for `--package-manager` and compare that
  result with the generated PR claim.

### H2: Title extraction mistakes the required first per-commit bullet for a branch-level title

- Supports: the PR title is byte-equivalent to the first change bullet after
  removing the bullet marker, and `extractPrTitle` has no SHA/overall handling.
- Conflicts: none.
- Test: compare the current PR title with the first body bullet and trace the
  current extraction transforms.

### H3: A stale cached summary from an earlier commit produced the inaccurate body

- Supports: PR summaries are written to a stable `.pr-summaries` path.
- Conflicts: the generated body contains both current commit IDs and the PR head
  matches the latest pushed commit.
- Test: compare PR head OID and listed commit IDs with the local branch.

## Experiments

1. Searched `origin/main...HEAD` for the exact `--package-manager` string. The
   string is absent, while the generated PR names it as an implemented flag.
   H1 is confirmed: the model introduced a claim that was not grounded in its
   diff input.
2. Parsed the current PR title and first bullet under “What change does this PR
   add?”. They are exactly equal, including the leading commit SHA. H2 is
   confirmed: title extraction blindly promotes the first per-commit bullet.
3. Compared the PR head OID with local `HEAD`; both are
   `226743fb8841e911a57040c9e1714d2cd1b1bacd`, and the body lists both current
   branch commits. H3 is rejected; this is not stale summary state.

## Root Cause

Pass 2 permits ungrounded CLI/behavior claims, and pass 3/title extraction does
not require or recognize a distinct branch-level summary bullet before the
required SHA-prefixed per-commit bullets.

## Fix

- Require pass 2 to omit every CLI flag, behavior, test result, risk, or
  migration claim that is not directly evidenced by the supplied diff/body.
- Require pass 3 to begin the changes section with one `Overall:` branch-level
  bullet, followed by the per-commit bullets, and prohibit new facts not present
  in the condensed inputs.
- Strip the `Overall:` label when deriving the GitHub PR title.
- Add regression assertions for the prompt grounding contract and resulting PR
  title.
