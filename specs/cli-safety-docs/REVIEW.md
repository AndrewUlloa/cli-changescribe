# Review: CLI safety and documentation hardening

> Status: approved for hosted CI
> Reviewed: 2026-08-13

## Scope

This review covers the branch implementation of
`specs/cli-safety-docs/SPEC.md`: strict command arguments, GitHub issue
linking, command help, npm/GitHub documentation, community security paths, and
the `0.3.2` package contract.

## TDD evidence

The following failures were observed before their implementations:

- CLI routing: unknown commit/PR options and missing values reached runners.
- GitHub issue linking: fake `gh` rejected the unsupported `--issue` flag.
- Help: subcommands printed only global help.
- Init: an idempotent run rewrote compact `package.json` formatting.
- Documentation: requirements, exact side effects, references, and community
  files failed their contract tests or did not exist.
- Distribution: the tarball omitted the new shipped documentation.
- Review hardening: unsafe huge/environment commit limits and raw
  attacker-controlled error text failed new regressions.

Each slice was implemented only after its focused failure, then rerun green.

## Five-axis review

### Correctness

- All accepted options, defaults, aliases, and validation rules match command
  source and help.
- Both new and existing PR paths append `Closes #N`; neither passes `--issue`
  to GitHub CLI.
- Positive safe integers bound PR history for CLI and environment values.

### Security and privacy

- Invalid options and commands fail before workflow side effects and never
  echo attacker-controlled tokens.
- Shell-known credentials and control text are redacted/normalized at the CLI
  boundary.
- Existing argv-based process execution, child credential stripping, provider
  routing, prompt/output redaction, no-redirect, and no-retry controls remain.
- Private GitHub vulnerability reporting is enabled.

### Performance and reliability

- No dependencies were added.
- Commit collection cannot silently become unbounded through `Infinity` or
  invalid environment input.
- Package remains compiled CommonJS on Node.js 18+.

### Test quality

- 93 strict TypeScript tests pass, including black-box CLI safety, local wire
  transport, real Git fixtures, fake GitHub CLI create/update, tarball install,
  and ChangeScribe resolution.
- The CI workflow runs typecheck, the full suite, and publish dry-run on Node
  18, 20, and 22.

### Documentation and release integrity

- README behavior was audited against source, not inferred from command names.
- Official provider links were checked online; Vercel gateway retry/fallback is
  explicitly separated from Diffwright's per-model-call behavior.
- The `0.3.2` tarball contains exactly 32 intended files and excludes tests,
  TypeScript sources, and unrelated workspace directories.

## Independent reviews

Three independent roles reviewed security/correctness, technical writing, and
release integrity. Their blockers—safe integer limits, error-token disclosure,
Vercel request wording, requirements scope, and source-link drift—were fixed
and re-tested. No local code or package blocker remains.

## Local gate results

- `npm run typecheck`: pass
- `npm test`: 93/93 pass
- `npm publish --dry-run --tag next --json`: pass, 32 files
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm audit signatures`: 39 verified signatures
- `git diff --check`: pass

## Remaining release gate

Hosted Node.js 18/20/22 CI must pass before merge and npm publication.
