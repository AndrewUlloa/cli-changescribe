# Diffwright — Claude Instructions

## Git Workflow

**Always branch from `main`.** This repository does not use a `staging` branch.
Start each feature, fix, or documentation branch from an up-to-date `main`,
never from another unfinished topic branch. Branching from in-flight work
couples unrelated changes and creates avoidable merge conflicts.

**Diffwright must dogfood Diffwright for every commit and pull request.** NEVER
use raw `git add`, `git commit`, `git push`, `gh pr create`, `gh pr edit`, or `gh pr merge` for
work intended to ship. Those commands bypass Diffwright's generated and
validated Conventional Commit messages and structured pull-request summaries.
Read-only commands such as `git status`, `git diff`, `git log`, and `gh pr view`
are allowed.

Before committing, run the repository's required gates:

```bash
npm run typecheck
npm test
npm pack --dry-run
npm audit --omit=dev
git diff --check
```

Then commit and push only through the project script:

```bash
npm run commit
```

For feature, fix, and documentation branches, create or update the pull request
only through the branch-aware Diffwright project script:

```bash
npm run feature:pr
```

After the pull request is fully reviewed and every check is green, merge only
through the guarded squash workflow:

```bash
npm run pr:merge
```

This main-only repository intentionally has no `staging:pr` script. If it
deliberately adopts a `staging` branch later, rerun guided setup so both PR
scripts are regenerated from the detected topology.

Treat the Diffwright-generated commit message, pull-request title, and
pull-request body as the workflow output. Do not replace them with hand-written
versions afterward. If generation or a gate fails, fix the underlying problem
and rerun the same script. Do not fall back to raw Git/GitHub commands, use
`--no-verify`, or skip hooks or gates. If Diffwright cannot complete the
operation, stop and report the blocker.

The project scripts build and invoke `node ./bin/diffwright.js`, so this
repository dogfoods the checked-out Diffwright source and cannot fall back to a
stale global installation. To confirm the harness explicitly, run:

```bash
npm run commit -- --help
```

The output must include the focused `Usage: diffwright commit` help. If it
prints only the generic command list, the harness is stale; fix the executable
resolution before continuing and do not bypass Diffwright.

<!-- diffwright:workflow:start -->
## Git workflow

Branch each independent feature from `main`. This workflow does not use a staging branch. Never branch new work from another unfinished feature branch.

Never use raw `git add`, `git commit`, `git push`, `gh pr create`, `gh pr edit`, or `gh pr merge` for work intended to ship. Read-only Git and GitHub inspection commands are allowed.

Commit and push only with `npm run commit`. Create or update a feature pull request only with `npm run feature:pr`. Merge a completed pull request only with `npm run pr:merge`; it validates the live repository, title, head, checks, reviews, and merge state before creating one squash commit. The commit script enforces these project gates first: typecheck, test, build.

Use Conventional Commit types semantically: `feat` adds a user-visible capability, `fix` corrects faulty behavior, `docs`/`test`/`ci`/`build` describe exclusive work in those domains, `refactor` preserves behavior, and `perf` requires performance evidence. Use a scope only when one subsystem clearly dominates, and only from: cli, commit, evidence, init, merge, policy, pr, provider, release, setup.

Provide issue or context evidence for behavioral or substantial changes. Generated pull requests must account for every substantive final-diff area and report only validation that actually ran, including limitations.

If a generated command or gate fails, fix the underlying error and rerun the same project script. Never use `--no-verify`, skip hooks or gates, replace generated commit/PR text by hand, or fall back to raw Git/GitHub mutation.
<!-- diffwright:workflow:end -->
