# Diffwright CLI reference

This page is the complete command reference for Diffwright. Run
`diffwright <command> --help` for the same core syntax at the terminal.

## Global syntax

```text
diffwright <command> [options]
```

Unknown commands, unknown options, incomplete value options, and invalid
option values fail with a nonzero exit status. Validation occurs before a
command runner starts, so invalid arguments do not stage files, load provider
configuration, fetch, call a model, commit, or push.

`-h` and `--help` are supported globally and as the only option after a known
command.

## `commit`

```text
diffwright commit [--dry-run]
```

| Option | Meaning |
|---|---|
| `--dry-run` | Generate and print a candidate without committing or pushing. |

Diffwright reads the staged diff. If the repository has changes but the index
is empty, it runs `git add .` before analysis—even in dry-run mode. It then
makes one provider request; if the response violates the commit contract, one
repair request is possible.

Without `--dry-run`, Diffwright creates a commit and pushes the current branch.
A dry-run candidate is not cached or reused by a later live command.

## `doctor`

```text
diffwright doctor [--live]
```

| Option | Meaning |
|---|---|
| `--live` | Make one small provider request after resolving configuration. |

Without `--live`, doctor performs no network request. It prints the provider,
exact model, endpoint hostname, credential environment variable and source,
transport, compatibility status, and offline success.

## `init`

```text
diffwright init
```

`init` accepts no options. It adds missing `commit`, `pr:summary`, `feature:pr`,
and `staging:pr` scripts to the current `package.json`. It migrates exact
ChangeScribe-generated values, preserves custom script values, and does not
rewrite the file when no changes are needed.

## `pr`

```text
diffwright pr [options]
```

| Option | Default | Meaning |
|---|---|---|
| `--base <branch>` | `PR_SUMMARY_BASE` or `main` | Compare the current branch with this base. |
| `--out <path>` | `PR_SUMMARY_OUT` or `.pr-summaries/PR_SUMMARY.md` | Detailed output path. |
| `--limit <number>` | `PR_SUMMARY_LIMIT` or `400` | Positive maximum commit count. |
| `--issue <number>` | `PR_SUMMARY_ISSUE` or empty | Add issue context and, with `--create-pr`, append `Closes #NUMBER` to the PR body. Accepts `123` or `#123`. |
| `--mode <mode>` | inferred | `feature` or `release`. |
| `--dry-run` | off | Print the resolved range and plan without model calls or summary writes. |
| `--create-pr` | off | Run project gates and create or update a PR with `gh`. |
| `--skip-format` | off | Skip the optional format script. |
| `--no-format` | off | Alias for `--skip-format`. |

Normal PR generation makes at least three provider requests: a 5Cs snapshot,
one request per 20,000-character commit chunk, and final synthesis. A release
fallback can add another request. It writes the detailed output, a sibling
`.final.md` file, and a temporary backup.

PR dry-run attempts `git fetch -- origin <base>` before it prints the plan. It
uses local refs if fetch fails. It does not call the provider or write output.

### `--create-pr` order

1. Confirm `gh` is installed.
2. Run `npm run format` when that script exists, unless format was skipped.
3. Always run `npm test`.
4. Always run `npm run build`.
5. Reject a dirty working tree.
6. Generate and write summaries.
7. Update an existing PR, or push the current branch and create a PR.

Project gates can execute arbitrary project code and may modify files. When an
open PR already exists, Diffwright updates its title and body but does not push
local commits. Issue linkage uses the body directive `Closes #NUMBER`; no
unsupported GitHub CLI issue flag is used.

## Aliases

| Alias | Expansion |
|---|---|
| `pr:summary` | `pr` |
| `feature:pr` | `pr --base staging --create-pr --mode feature` |
| `staging:pr` | `pr --base main --create-pr --mode release` |

Explicit options placed after an alias override its prepended defaults.

## Configuration precedence

Diffwright reads `.env.local` from the current working directory at command
invocation. Shell variables override file values, including explicitly empty
shell values. See the [provider guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md)
for provider activation and legacy precedence.

## Exit behavior

- Exit `0`: command completed or a valid help request was printed.
- Nonzero: invalid command/options, provider configuration failure, Git or
  GitHub failure, project-gate failure, transport failure, or incompatible
  model response.

Errors are formatted at the CLI boundary and configured provider secrets are
redacted. See [troubleshooting](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/troubleshooting.md).
