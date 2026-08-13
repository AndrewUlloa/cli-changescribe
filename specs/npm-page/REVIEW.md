# Review: npm package page and 0.3.1 hardening

> Status: approved for release candidate
> Reviewed: 2026-08-13
> Spec: `specs/npm-page/SPEC.md`

## Outcome

The patch is ready for hosted CI. The README now follows a product-first,
npm-safe hierarchy inspired by Playwright without copying its brand or prose.
The release also closes the confirmed Git base-ref option-injection path before
publishing a new package version.

## TDD evidence

The work was completed in two observed RED → GREEN slices:

- Base-ref security RED: the upload-pack probe test failed against the old
  implementation because Git executed the harmless local helper before the PR
  dry run returned. GREEN: base validation and explicit option termination made
  the focused security suite pass 4/4 without executing the probe.
- Package-page RED: the old README failed the three new contract tests for the
  centered product identity and first-minute workflow, retained reference
  hierarchy, and npm-safe navigation. GREEN: the redesigned README passed all
  three focused tests.

These are the failing and passing observations from this implementation, not
post-hoc inferred results.

## Quality review

### Correctness

- The quick start distinguishes offline doctor, non-mutating PR dry run, commit
  preview, and commands that commit, push, write files, or create a PR.
- Provider statuses, Vercel gateway fallback caveat, custom endpoint rules, and
  ChangeScribe compatibility match the shipped 0.3.x behavior.
- CLI and `PR_SUMMARY_BASE` values pass the same Git branch validation before
  they reach fetch, comparison, or GitHub operations.

### Readability

- A new reader sees identity, install, workflow choice, and a copy-paste setup
  before the detailed reference.
- Tables keep commands and providers scannable; detailed caveats remain next to
  the behavior they qualify.

### Architecture

- The README is the single package-page source used by GitHub and npm and needs
  no custom CSS, JavaScript, documentation site, or new image asset.
- The security fix stays inside PR argument/ref handling and does not change the
  provider or transport architecture.

### Security

- Leading-dash, malformed, whitespace-altered, and control-character base refs
  fail before Git or GitHub execution.
- The regression uses a real local bare remote and executable upload-pack probe
  to prove the previous option-parsing path cannot run a helper.
- The README explicitly says Diffwright redacts configured provider keys but
  does not scan arbitrary diff content for other secrets.
- General secret scanning, automatic staging behavior, temporary-file
  hardening, and package provenance remain outside this focused patch and are
  not claimed as solved.

### Performance

- Branch validation adds one local `git check-ref-format` process per PR
  invocation; there is no new network request or model request.
- README-only rendering has no CLI runtime cost and the packed package remains
  24 files.

## Local verification

- Strict application and test TypeScript typecheck: passed.
- Full suite: 77/77 passed, including packed Diffwright and ChangeScribe
  install/execute E2E.
- `diffwright@0.3.1` dry-run tarball: 24 expected files, 63.6 kB packed.
- Production dependency audit: zero vulnerabilities.
- Registry signature audit: 39 packages verified.
- Whitespace/error check: passed.
- Dogfood: Diffwright completed its own PR dry run on this release branch with
  an explicit keyless loopback profile and made no model request.
