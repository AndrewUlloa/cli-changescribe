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
