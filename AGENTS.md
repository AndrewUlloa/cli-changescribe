# Codex Agent Instructions

<!-- diffwright:workflow:start -->
## Git workflow

Branch each independent feature from `main`. This workflow does not use a staging branch. Never branch new work from another unfinished feature branch.

Never use raw `git add`, `git commit`, `git push`, `gh pr create`, or `gh pr edit` for work intended to ship. Read-only Git and GitHub inspection commands are allowed.

Commit and push only with `npm run commit`. Create or update a feature pull request only with `npm run feature:pr`. The commit script enforces these project gates first: typecheck, test, build.

If a generated command or gate fails, fix the underlying error and rerun the same project script. Never use `--no-verify`, skip hooks or gates, replace generated commit/PR text by hand, or fall back to raw Git/GitHub mutation.
<!-- diffwright:workflow:end -->
