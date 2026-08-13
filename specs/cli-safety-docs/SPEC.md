# Spec: CLI safety and documentation hardening

> Filed by: Codex
> Status: approved
> Last updated: 2026-08-13

## One-line summary

Make Diffwright's command boundary fail closed and make its npm/GitHub
documentation accurately describe requirements, provider usage, side effects,
support, and security reporting.

## Objective

Diffwright currently ignores some unknown or incomplete options. A typo in
`commit --dry-run` can therefore enter the live commit-and-push path. The PR
command also passes an unsupported `--issue` flag to GitHub CLI, and generic
help does not document subcommand options. At the same time, the README
conflates two different dry-run behaviors and understates provider request
counts and command side effects.

This change adds strict command parsing, supported issue-link behavior,
command-specific help, accurate task-oriented documentation, and the missing
community health files. It is for developers evaluating or operating
Diffwright and contributors or security researchers who need a clear support
path.

## Assumptions

- The requester's “make the changes” approves the evidence-backed roadmap from
  the preceding technical-writing and source audit.
- `--issue` accepts a GitHub issue number with or without a leading `#` and
  adds `Closes #NUMBER` to newly created or updated PR bodies.
- `--mode` supports only `feature` and `release`.
- The existing `docs/` and `signal/` worktree directories are unrelated user
  content and remain untouched.
- README changes ship as `diffwright@0.3.2`; the ChangeScribe bridge already
  accepts it through `diffwright@^0.3.0` and needs no release.

## Success criteria

| # | Criterion | Measurement | Target |
|---|---|---|---|
| 1 | Mutating commands fail closed | Black-box typo/missing-value tests | Unknown options return 1 before staging, provider calls, commits, fetches, or pushes |
| 2 | Help is command-specific | CLI output tests | `commit`, `pr`, `doctor`, and `init --help` describe their own options and effects |
| 3 | Issue linking uses supported GitHub syntax | Mock `gh` integration test | PR body contains `Closes #NUMBER`; argv contains no unsupported `--issue` |
| 4 | README behavior is accurate | Documentation contract tests and source review | Dry runs, request counts, files, gates, fetches, commits, and pushes are explicit |
| 5 | Reference remains discoverable | Link and file tests | README links to complete CLI, troubleshooting, provider, support, contribution, and security material |
| 6 | Repository trust surface improves | GitHub community profile and files | Root `SECURITY.md`, `CONTRIBUTING.md`, and `SUPPORT.md` exist; private reporting is enabled |
| 7 | Release stays compatible | Full test, pack, clean-install, bridge, and CI gates | Node 18/20/22 green; `diffwright@0.3.2` installs and ChangeScribe resolves it |

## Non-goals

- No terminal GIF, screenshot, logo, website, or additional badge.
- No provider transport changes or live-provider status promotion.
- No redesign of automatic staging, PR multi-pass synthesis, temporary backups,
  or existing/new PR push behavior; this release documents those behaviors.
- No changelog or GitHub release link until a maintained release-history
  workflow exists.

## User stories

- As a developer, I want a mistyped preview flag to fail instead of committing
  and pushing my work.
- As a developer, I want help and documentation to tell me exactly what a
  command contacts or changes before I run it.
- As a maintainer, I want issue links to work with current GitHub CLI.
- As a security researcher, I want a private, explicit reporting path.

## Technical contract

### Argument validation

- `commit`: only `--dry-run` is accepted.
- `doctor`: only `--live` is accepted.
- `init`: accepts no options.
- `pr`: accepts `--base`, `--out`, `--limit`, `--issue`, `--dry-run`,
  `--create-pr`, `--skip-format`/`--no-format`, and `--mode`.
- Value-taking options reject missing values, including when the following
  token is another option.
- `--limit` is a positive integer; `--mode` is `feature` or `release`; issue
  references are positive integers with an optional leading `#`.
- Unknown options fail before runtime configuration, Git, provider, npm, or
  GitHub operations.

### Issue linking

- Internally normalize `123` and `#123` to `#123`.
- Include the normalized reference as synthesis context.
- Append `Closes #123` to the final PR body for create and update operations.
- Never pass `--issue` to `gh pr create` or `gh pr edit`.

### Documentation architecture

- README: value, requirements, install, quick start, behavior table,
  representative commit/PR output, providers, common PR workflows, concise
  troubleshooting, security, and project links.
- `documentation/cli-reference.md`: complete syntax, flags, defaults, aliases,
  side effects, and exit behavior.
- `documentation/providers.md`: first-class provider variables and official
  API-key/model documentation links.
- `documentation/troubleshooting.md`: emitted categories, likely causes,
  diagnostics, remedies, and safe bug-report fields.
- Root community files: contribution, support, and security reporting.

## Tech stack and gates

- Strict TypeScript, CommonJS output, Node.js 18+.
- Node built-in test runner with TypeScript tests compiled into `.test-dist/`.
- Existing OpenAI SDK and no new dependency.

```bash
npm run typecheck
npm test
npm pack --dry-run
npm audit --omit=dev
npm audit signatures
git diff --check
```

## Boundaries

### Always

- Add failing regression tests before fixes.
- Keep errors secret-safe and fail before side effects.
- Preserve legacy provider resolution and ChangeScribe compatibility.
- Use only official provider, npm, GitHub, and GitHub CLI links.

### Ask first

- Adding dependencies or changing the supported Node range.
- Removing current commands, aliases, or compatibility behavior.
- Adding a hosted documentation or analytics service.

### Never

- Commit credentials, generated build output, or unrelated `docs/`/`signal/`.
- Claim a provider was live-tested when it was not.
- Direct security researchers to a public issue containing vulnerability
  details.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Strict parsing rejects previously ignored typos | High | Positive breaking edge | Patch release notes and clear errors; only invalid invocations change |
| Help and reference drift | Medium | Medium | Contract tests assert syntax and critical behavior in both surfaces |
| Issue normalization rejects free-form context | Medium | Low | Document numeric GitHub issues as the supported contract |
| README becomes too long | Medium | Medium | Keep task guidance in README and move exhaustive reference to `documentation/` |

## Open questions

None blocking. The requester approved implementation and instructed the agent
to continue through completion.

## References

- npm package README guidance: https://docs.npmjs.com/about-package-readme-files/
- GitHub README guidance: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes
- GitHub CLI PR creation: https://cli.github.com/manual/gh_pr_create
- GitHub community health: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions
- Google accessible documentation: https://developers.google.com/style/accessibility

## Sign-off

- [x] Author has written this spec
- [x] Assumptions confirmed by the request and preceding approved findings
- [x] Success criteria are measurable
- [x] Boundaries agreed
- [x] No blocking open questions
- [x] Human approved the work by requesting implementation
