# Ship: TypeScript migration

> Candidate: `diffwright@0.2.2`
> Channel: npm `next`, then `latest`

## Launch sequence

1. Merge the focused PR only after Node 18, 20, and 22 checks pass.
2. Publish `diffwright@0.2.2` under the `next` dist-tag.
3. Verify registry integrity and clean-install the exact version.
4. Run `diffwright --help`, unknown-command, and `diffwright init` smokes.
5. Install `cli-changescribe@0.2.2` alone and prove it resolves Diffwright
   0.2.2 and delegates help/init successfully.
6. Promote `diffwright@0.2.2` to `latest`; remove `next` if desired.

The existing bridge dependency is `diffwright@^0.2.1`, so no bridge release is
needed for this patch.

## Rollback

Restore `latest` to `diffwright@0.2.1`, deprecate 0.2.2 with a clear message,
and verify a bridge-only install resolves 0.2.1. Publish corrections as a new
version; do not overwrite or unpublish 0.2.2.
