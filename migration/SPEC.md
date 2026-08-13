# Spec: ChangeScribe compatibility bridge

> Status: implemented
> Last updated: 2026-08-12

## Summary

Publish one final `cli-changescribe` release that preserves the `changescribe`
command while delegating all behavior to the renamed `diffwright` package.

## Objective

Existing ChangeScribe users should not be abandoned by the rename. Users who
update or reinstall `cli-changescribe` must receive Diffwright's implementation
and a clear, safe migration command. npm cannot rewrite an installed package
name or a consumer's `package.json`, so the bridge must not claim to do that.

## Assumptions

- `diffwright@0.2.1` is publicly available on npm.
- `cli-changescribe@0.2.2` remains owned by the same npm account.
- Supported users run Node.js 18 or newer.

## Success criteria

1. `cli-changescribe@0.2.2` exposes the legacy `changescribe` binary.
2. The binary prints migration commands and forwards arguments and exit behavior
   to `diffwright`.
3. A clean npm install can run `changescribe --help` successfully.
4. npm marks every `cli-changescribe` version deprecated with a redirect to
   `diffwright` while leaving all versions downloadable.

## Non-goals

- Silently installing or uninstalling global packages.
- Rewriting consumers' `package.json` or lockfiles.
- Removing `cli-changescribe` from npm.
- Maintaining two independent implementations.

## Boundaries

**Always:** preserve the legacy command, avoid lifecycle scripts, test a packed
artifact in a clean directory, and keep rollback possible through npm tags.

**Ask first:** unpublishing a package or changing Diffwright behavior.

**Never:** commit credentials, automatically modify a user's environment, or
include unrelated `docs/` and `signal/` worktree content.

## Sign-off

The requester approved this compatibility-release approach in the conversation
on 2026-08-12. `cli-changescribe@0.2.2` was published, installed from the public
registry, smoke-tested, and deprecated with the documented migration notice.
