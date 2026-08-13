# Spec: npm package page and 0.3.1 hardening

> Status: approved for implementation
> Approved: 2026-08-13

## One-line summary

Make Diffwright's npm page explain the product, prove its value, and get a new
user to a successful command in under a minute, while fixing the confirmed Git
option-injection issue before publishing the required patch release.

## Audience and outcome

The primary reader is a developer discovering Diffwright on npm. Above the
fold, they should understand:

1. what Diffwright turns into what;
2. that they bring their own provider or local model;
3. the recommended installation and first successful command;
4. where to inspect privacy and supported providers.

## Information architecture

Use Playwright's current public README hierarchy as inspiration without
copying its brand or prose:

1. centered product identity, tagline, badges, and navigation links;
2. one recommended install command;
3. a compact “choose your workflow” table;
4. a copy-paste quick start;
5. a concrete terminal example;
6. key capabilities and command reference;
7. provider configuration and security/privacy details;
8. migration, development, and project links.

The README remains useful on both npm and GitHub. It must not depend on a
website, JavaScript, custom CSS, or an image asset that does not already exist.

## Security release gate

An npm README update requires a new package version. Diffwright 0.3.0 must not
be republished cosmetically while the confirmed `--base` issue remains:

- validate CLI and `PR_SUMMARY_BASE` values as branch names before any Git or
  GitHub command;
- reject option-like, malformed, and control-character values;
- end Git option parsing where supported;
- prove a malicious `--upload-pack=` value cannot execute a local helper;
- retain valid branch behavior.

This is a focused patch. General secret scanning, automatic-staging redesign,
temporary-file hardening, and publishing provenance remain separately scoped
security work and must not be implied as solved by 0.3.1.

## Package metadata

- Version: `0.3.1`.
- Description: explicitly mention Git diffs, Conventional Commits, PR
  summaries, and bring-your-own AI.
- Existing binary, dependencies, compatibility bridge, and package contents
  remain unchanged.

## Success criteria

1. The first screen of README source contains identity, value proposition,
   badges, navigation, install, and two core workflow paths.
2. A first-time user can copy a complete OpenRouter quick start and run
   `diffwright doctor` before any mutating command.
3. Commit and PR examples clearly distinguish preview from mutation.
4. Provider statuses and direct-to-endpoint caveats remain accurate.
5. README links work on npm without relative links to unpublished files.
6. A regression test fails before and passes after Git base validation.
7. Existing 73 tests, strict typecheck, packed-install E2E, audit, and package
   allowlist remain green.
8. The published registry page is verified after `diffwright@0.3.1` ships.

## Boundaries

### Always

- Keep security and provider-status language honest.
- Use the existing ShieldCN badges and Diffwright name.
- Preserve detailed configuration below the quick start.
- Exclude unrelated untracked `docs/` and `signal/` directories.

### Ask first

- Creating a new logo or visual identity.
- Adding a documentation website or external analytics.
- Changing command semantics beyond base-ref validation.

### Never

- Copy Playwright branding or text.
- Claim live provider verification that did not happen.
- Hide that `commit` mutates Git unless `--dry-run` is used.
- Publish from a failing or unreviewed revision.

## References

- Playwright repository README: https://github.com/microsoft/playwright
- Playwright npm package: https://www.npmjs.com/package/playwright
- Diffwright npm package: https://www.npmjs.com/package/diffwright
