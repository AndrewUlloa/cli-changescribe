# Plan: ChangeScribe compatibility bridge

> Derived from: `migration/SPEC.md`
> Status: done
> Last updated: 2026-08-12

## Architecture decisions

- Keep the bridge as a small package under `compat/cli-changescribe` so it has
  its own npm manifest and cannot alter the `diffwright` tarball.
- Depend on `diffwright` and load its CLI entry point instead of duplicating the
  implementation.
- Use npm deprecation metadata for the install-time notice and a short stderr
  notice for users who receive the bridge through an update.
- Do not use install hooks or automatic global-package mutation.

## Tasks

1. [x] Add a failing structural test for the bridge manifest and wrapper.
2. [x] Add the bridge manifest, wrapper, and migration README; make the test pass.
3. [x] Run the full repository tests and inspect both npm tarballs.
4. [x] Install the packed bridge in a clean temporary directory and run
   `changescribe --help`.
5. [x] Review correctness, simplicity, architecture, security, and performance.
6. [x] Publish `cli-changescribe@0.2.2`, verify it from npm, then deprecate the old
   package name with a migration notice.

## Rollback

If the bridge is broken, restore the `latest` tag to `0.2.1` immediately. npm
versions remain immutable and downloadable; do not unpublish either package.

## Sign-off

The requester approved implementation and publication in the conversation on
2026-08-12.
