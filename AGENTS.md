# Codex Agent Instructions

<!-- diffwright:workflow:start -->
## Git workflow

Branch each independent feature from `main`. This workflow does not use a staging branch. Never branch new work from another unfinished feature branch.

Never use raw `git add`, `git commit`, `git push`, `gh pr create`, `gh pr edit`, or `gh pr merge` for work intended to ship. Read-only Git and GitHub inspection commands are allowed.

Commit and push only with `npm run commit`. Create or update a feature pull request only with `npm run feature:pr`. Merge a completed pull request only with `npm run pr:merge`; it validates the live repository, title, head, checks, reviews, and merge state before creating one squash commit. The commit script enforces these project gates first: typecheck, test, build.

Use Conventional Commit types semantically: `feat` adds a user-visible capability, `fix` corrects faulty behavior, `docs`/`test`/`ci`/`build` describe exclusive work in those domains, `refactor` preserves behavior, and `perf` requires performance evidence. Use a scope only when one subsystem clearly dominates, and only from: cli, commit, evidence, init, merge, policy, pr, provider, release, setup.

Provide issue or context evidence for behavioral or substantial changes. Generated pull requests must account for every substantive final-diff area and report only validation that actually ran, including limitations.

If a generated command or gate fails, fix the underlying error and rerun the same project script. Never use `--no-verify`, skip hooks or gates, replace generated commit/PR text by hand, or fall back to raw Git/GitHub mutation.
<!-- diffwright:workflow:end -->
