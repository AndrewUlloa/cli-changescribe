# Changelog

All notable changes to Diffwright will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Diffwright uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added evidence-linked commit and pull-request drafts, deterministic artifact
  rendering, a terminal evidence critic, and observed project-gate receipts.
- Added interactive pull-request review and editing, bounded context files, and
  versioned repository policy through `.diffwrightrc.json` plus a published
  JSON Schema.

### Changed

- Changed direct `diffwright commit` to analyze only staged work. Use `--all`
  to opt into staging every working-tree change; Diffwright-managed scripts are
  migrated automatically.
- Changed pull-request evidence to the final `merge-base...HEAD` net diff so
  deletions, renames, and reverted intermediate work are represented correctly.
- Changed GitHub mutation to require interactive approval or explicit `--yes`
  in headless workflows, while preserving approved title and body bytes.
- Changed commit and squash titles to share deterministic Conventional Commit
  grammar, advisory 50-character targets, and an immutable 72-character hard
  maximum.

### Security

- Bound Git and GitHub mutations to reviewed immutable snapshots, including
  staged trees, local and remote branch heads, base SHAs, and the explicit
  GitHub repository derived from `origin`.
- Expanded fail-closed validation and redaction for repository policy, context
  files, provider output, Git paths, Unicode controls, secrets, and subprocess
  environments.

## [0.5.0] - 2026-08-14

### Added

- Added a guarded GitHub Release workflow that publishes one verified npm
  tarball through tokenless trusted publishing and attaches it to the release.
- Added formal release documentation, a changelog, and a latest-release badge.

### Changed

- Changed Diffwright's license from MIT to Apache 2.0. Versions through `0.4.4`
  remain under their original MIT license.

## [0.4.4] - 2026-08-14

### Changed

- Replaced stale README badges with live Shields.io badges.
- Established `v0.4.4` as Diffwright's first formal GitHub Release.

[Unreleased]: https://github.com/AndrewUlloa/diffwright/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/AndrewUlloa/diffwright/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/AndrewUlloa/diffwright/releases/tag/v0.4.4
