# Plan: npm package page and 0.3.1 hardening

> Status: approved — implementation in progress
> Spec: `specs/npm-page/SPEC.md`

## 1. Base-ref security regression

- RED: add a temporary-repository test whose option-like base would execute a
  harmless upload-pack probe under the old implementation.
- GREEN: validate base refs before Git/GitHub use and terminate Git option
  parsing where supported.
- Verify the focused security and PR dry-run tests.

## 2. Product-first README

- RED: add a package-page contract test for the hero, quick start, workflow
  table, security section, and npm-safe links.
- GREEN: rewrite README in the approved hierarchy while preserving complete
  provider and development reference material.
- Verify the focused branding/package-page tests.

## 3. Patch metadata

- Bump Diffwright to 0.3.1 and improve the npm description.
- Update the root lockfile without changing dependencies.
- Verify the exact tarball allowlist and published README inclusion.

## 4. Review and ship

- Review correctness, readability, architecture, security, and performance.
- Record RED → GREEN evidence, rollback, and registry verification steps.
- Run typecheck, full tests, pack dry-run, production audit, signature audit,
  and whitespace checks.
- Open a focused PR, pass Node 18/20/22 CI, merge, publish, and verify npm.
