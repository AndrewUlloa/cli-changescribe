# Diffwright CLI reference

This page is the complete command reference for Diffwright. Run
`diffwright <command> --help` for the same core syntax at the terminal.

## Global syntax

```text
diffwright <command> [options]
```

Unknown commands/options, incomplete value options, and invalid limit, issue,
or mode values fail with a nonzero exit status before workflow side effects.
Branch names are validated before fetch or GitHub use. Invalid invocations do
not stage files, fetch, call a model, write output, commit, or push.

`-h` and `--help` are supported globally and as the only option after a known
command. `-v` and `--version` print the exact installed Diffwright version and
exit without running a workflow.

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
diffwright init [options]
```

| Option | Meaning |
|---|---|
| `--yes` | Accept supplied choices and safe detected defaults without prompts. |
| `--dry-run` | Show the redacted plan without installs, writes, or a live request. |
| `--provider <id>` | Select `openai`, `anthropic`, `google`, `xai`, `deepseek`, `openrouter`, `vercel`, `cerebras`, `groq`, `ollama`, or `custom`. |
| `--model <id>` | Set the provider's exact model identifier. |
| `--base <branch>` | Set the feature pull-request base. |
| `--agents <targets>` | Install managed rules for `claude`, `codex`, both as `claude,codex`/`codex,claude`, or `none`. |
| `--credential-source <source>` | Use `existing` configuration or select `file` storage. In deterministic mode the file credential must already exist. This is a source selector, never a credential value. |
| `--live` | After offline doctor succeeds, make one provider request. Incompatible with `--dry-run`. |

### Package runners

Launch guided setup with the package runner already used by the project:

| Package runner | Preview without project writes | Guided setup |
|---|---|---|
| pnpm | `pnpm dlx diffwright@latest init --dry-run` | `pnpm dlx diffwright@latest init` |
| npm | `npx diffwright@latest init --dry-run` | `npx diffwright@latest init` |
| Yarn 2+ | `yarn dlx diffwright@latest init --dry-run` | `yarn dlx diffwright@latest init` |
| Bun | `bunx diffwright@latest init --dry-run` | `bunx diffwright@latest init` |

Yarn Classic does not include `yarn dlx`; use the `npx` launcher there. The
launcher and the detected project package manager are separate: after startup,
Diffwright reads the `packageManager` declaration and lockfile and uses the
detected npm, pnpm, Yarn, or Bun command for the exact local pin and project
scripts. Add `--dry-run` to any launcher command for a redacted project preview.

### Init modes

**Guided TTY.** With no deterministic configuration option and with stdin and stdout
attached to an interactive TTY, `init` starts the wizard. It detects
the package manager, Git branch topology, existing gates, configuration, and
agent files; then it asks for provider, exact model, credential source, PR base,
commit gates, and optional agent guardrails. It renders a redacted plan before
asking for confirmation.

The credential step also offers **Configure later**. That choice writes only
the nonsecret setup, skips doctor, and ends with an incomplete-setup message
and the exact offline-doctor command to run after adding the credential.

**Legacy non-TTY.** A no-argument, non-TTY invocation preserves the original
script-only contract. It adds missing `commit`, `pr:summary`, `feature:pr`, and
`staging:pr` values, migrates exact ChangeScribe-generated values, preserves
custom scripts, and does nothing else. It never prompts, installs, writes
credentials or agent files, or runs doctor.

**Deterministic.** `--yes` never prompts. It uses supplied choices and safe
detected defaults, but a provider that lacks required existing credentials
fails with corrective guidance. It does not add agent guardrails unless
`--agents` names them, and `--live` is never implied. Supplying `--provider`,
`--model`, `--base`, `--agents`, or `--credential-source` also selects headless
setup. No option accepts a credential value.

**Preview.** `--dry-run` may collect interactive answers and perform in-memory
validation, but performs no project dependency install, target-project file
write, or live provider request. `--live` and `--dry-run` cannot be combined.
When the command is launched with `pnpm dlx`, `npx`, `yarn dlx`, or `bunx`, the
runner may still resolve or download the CLI into its own cache or temporary
environment before Diffwright receives `--dry-run`.

### Init plan and side effects

The guided plan can:

1. Pin the running Diffwright version exactly as a local development dependency
   through the detected npm, pnpm, Yarn, or Bun command, with install lifecycle
   scripts disabled. This updates the applicable manifest and lockfile.
2. Add branch-aware `commit`, `pr:summary`, and feature/release PR scripts.
   Selected existing `lint`, `typecheck`, `test`, and `build` scripts run before
   commit generation. A feature PR targets `staging` only when that branch is
   present and selected; otherwise it targets the detected default branch.
3. Reuse an existing provider/model/credential, or write selected Diffwright
   variables to `.env.local`. A file credential is accepted only through the
   no-echo secret prompt in an interactive TTY. `.env.local` must be untracked
   and protected by `.gitignore` before a credential is written.
4. Add one marker-delimited managed block to selected root `CLAUDE.md` and/or
   `AGENTS.md` files. The block names the actual generated scripts and forbids
   raw Git/GitHub mutation for shipping work. Text outside the block is
   preserved.

Custom package scripts are not replaced. Exact managed Diffwright or
ChangeScribe values may be migrated; a custom collision receives a
`diffwright:*` fallback when that fallback is free. The preview names the
effective scripts.

An external project uses the exact local version rather than a global binary.
When the current project is Diffwright's own validated checkout, setup never
adds a self-dependency: it builds the current source and invokes
`node ./bin/diffwright.js`.

In guided mode, nothing above is applied until the user confirms the redacted
plan. Declining or pressing Ctrl-C before confirmation exits without writes or
provider calls. A deterministic invocation applies without an extra prompt;
use `--dry-run` first when automation needs a separate preview step.
After a successful apply, `init` runs doctor offline. The live check is a
separate explicit consent step and makes exactly one request to the resolved
provider. An install, offline-doctor, or live-doctor failure exits nonzero and
reports which phase failed; successfully applied files are not disguised as a
rollback. Recovery is documented in
[troubleshooting](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/troubleshooting.md).

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
| `--mode <mode>` | `release` only for branch `staging` with base `main`; otherwise `feature` | `feature` or `release`. |
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
2. Detect the project package manager and run its `format` script when present,
   unless format was skipped (`npm run format` for npm).
3. Always run its test script (`npm test` for npm).
4. Always run its build script (`npm run build` for npm).
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
invocation. Shell values, including explicitly empty values, override
`.env.local`. See the [provider guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md)
for provider activation and legacy precedence.

## Exit behavior

- Exit `0`: command completed or a valid help request was printed.
- Nonzero: invalid command/options, provider configuration failure, Git or
  GitHub failure, project-gate failure, transport failure, or incompatible
  model response.

Errors are formatted at the CLI boundary and configured provider secrets are
redacted. See [troubleshooting](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/troubleshooting.md).
