# Plan: npm package page and 0.3.1 hardening

> Status: implementation complete — release candidate
> Spec: `specs/npm-page/SPEC.md`

## 1. Base-ref security regression

- [x] RED: add a temporary-repository test whose option-like base would execute a
  harmless upload-pack probe under the old implementation.
- [x] GREEN: validate base refs before Git/GitHub use and terminate Git option
  parsing where supported.
- [x] Verify the focused security and PR dry-run tests.

## 2. Product-first README

- [x] RED: add a package-page contract test for the hero, quick start, workflow
  table, security section, and npm-safe links.
- [x] GREEN: rewrite README in the approved hierarchy while preserving complete
  provider and development reference material.
- [x] Verify the focused branding/package-page tests.

## 3. Patch metadata

- [x] Bump Diffwright to 0.3.1 and improve the npm description.
- [x] Update the root lockfile without changing dependencies.
- [x] Verify the exact tarball allowlist and published README inclusion.

## 4. Review and ship

- [x] Review correctness, readability, architecture, security, and performance.
- [x] Record RED → GREEN evidence, rollback, and registry verification steps.
- [x] Run typecheck, full tests, pack dry-run, production audit, signature audit,
  and whitespace checks.
- [ ] Open a focused PR, pass Node 18/20/22 CI, merge, publish, and verify npm.
