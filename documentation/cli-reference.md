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
diffwright commit [--dry-run] [--all] [--timings] [--context-file <path>]
```

| Option | Meaning |
|---|---|
| `--dry-run` | Generate and print a candidate without committing or pushing. |
| `--all` | Explicitly stage all tracked and untracked working-tree changes before analysis. |
| `--timings` | Print privacy-safe phase durations after success or failure. |
| `--context-file <path>` | Add bounded source-agnostic intent from a regular project file. Repeatable. |

Diffwright reads only the staged diff by default. An empty index stops before
provider resolution and leaves the working tree unchanged. `--all` is the only
stage-all path and uses `git add --all`; combining it with `--dry-run` still
changes the index. Generation normally makes two provider requests: one
structured draft and one separate terminal evidence critique. If deterministic
draft validation fails, one repair request is possible. Unsupported optional
claims and trailers are removed. If the critic rejects the primary claim,
Diffwright requests one smaller replacement from the original evidence and
audits it again; a second rejection is terminal. The bounded failure path can
therefore make up to five provider requests.

Without `--dry-run`, Diffwright creates a commit from the staged snapshot and
verifies that Git hooks did not change its tree, parent, or message. It pushes
that exact commit SHA to the current branch. A dry-run candidate is not cached
or reused by a later live command.

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
| `--limit <number>` | `PR_SUMMARY_LIMIT` or `400` | Retained positive legacy history cap; never limits final net-diff evidence. |
| `--issue <number>` | `PR_SUMMARY_ISSUE` or empty | Add issue context and, with `--create-pr`, append `Closes #NUMBER` to the PR body. Accepts `123` or `#123`. |
| `--mode <mode>` | `release` only for branch `staging` with base `main`; otherwise `feature` | `feature` or `release`. |
| `--context-file <path>` | none | Add bounded source-agnostic intent from a regular project file. Repeatable. |
| `--dry-run` | off | Print the resolved range and plan without model calls or summary writes. |
| `--timings` | off | Print privacy-safe phase durations after success or failure. |
| `--create-pr` | off | Run project gates and create or update a PR with `gh`. |
| `--yes` | off | Approve GitHub mutation noninteractively after validation. Required with `--create-pr` outside a TTY. |
| `--skip-format` | off | Skip the optional format script. |
| `--no-format` | off | Alias for `--skip-format`. |

Normal PR generation sends one bounded final net-diff evidence bundle and
expects an evidence-linked JSON draft. It then makes one separate terminal critic
request over the original evidence and every renderable model-authored claim.
The critic uses the same resolved provider and model as the draft. Deterministic
validation can trigger one draft-repair request. Diffwright removes unsupported
optional claims and trailers. A rejected primary claim triggers one smaller
replacement generated from the original evidence and a second critique; another
rejection is terminal. Incomplete, binary, or oversized evidence stops explicitly
instead of being silently summarized. Diffwright renders Markdown locally and
writes the detailed output, a sibling `.final.md` file, and a temporary backup.

For both `commit` and `pr`, `--timings` prints fixed phase names and millisecond
durations in a final local report. The report contains no paths, evidence text,
credentials, or telemetry and is printed even when the workflow fails.

PR dry-run attempts an explicit fetch into `refs/remotes/origin/<base>` before
it prints the plan. It uses local refs if fetch fails. It does not call the
provider or write output.

### `--create-pr` order

1. Confirm `gh` is installed.
2. Detect the project package manager and run its `format` script when present,
   unless format was skipped (`npm run format` for npm).
3. Always run its test script (`npm test` for npm).
4. Always run its build script (`npm run build` for npm).
5. Reject a dirty working tree.
6. Generate and separately critique an evidence-linked artifact.
7. In a TTY, preview the exact title/body and choose Approve, Edit, or Cancel;
   outside a TTY, require explicit `--yes`.
8. Revalidate local and remote evidence snapshots, then write summaries.
9. Update the matching PR, or push the reviewed SHA and create a PR.

Project gates can execute arbitrary project code and may modify files. An
existing PR must be same-repository and its remote head SHA must exactly match
the reviewed local evidence; updates do not push local commits. New PR creation
pushes the immutable reviewed SHA, not a branch name resolved later. The base
and remote head are rechecked before GitHub mutation. Issue linkage uses the
body directive `Closes #NUMBER`; that exact suffix is included before review and
in both the `.final.md` file and GitHub body.

Editing uses `DIFFWRIGHT_EDITOR`, then `EDITOR`, then `vi`. The setting must be
one executable name without arguments. The edited title and body are
revalidated, including Conventional Commit grammar, repository policy, UTF-8,
control characters, size, and known-secret checks. Approved bytes are not
trimmed or rewritten afterward.

## Aliases

| Alias | Expansion |
|---|---|
| `pr:summary` | `pr` |
| `feature:pr` | `pr --base staging --create-pr --mode feature` |
| `staging:pr` | `pr --base main --create-pr --mode release` |

Explicit options placed after an alias override its prepended defaults.
Because the PR aliases include `--create-pr`, they require interactive review in
a TTY or an explicitly appended `--yes` in headless automation. Guided setup
generates consumer package scripts without `--yes` by default.

## Evidence and rendering contract

Commit evidence pins `HEAD` and the index tree; PR evidence pins the fetched
base SHA, merge base, and final branch `HEAD`. PR material changes come from the
final net diff, not a chain of per-commit summaries. Deletions, renames,
type changes, binary metadata, and NUL-delimited unusual filenames are handled
explicitly. The retained `--limit` option caps supplemental history only.

The provider returns a strict JSON draft of claims and evidence IDs. Diffwright
requires one observed primary change as the sole Summary/title anchor, prevents
supporting documentation, tests, manifests, and lockfiles from displacing source
work, rejects unknown evidence IDs, and omits unsupported inference. It renders
the Conventional title and adaptive body locally. Empty sections are absent.

Validation is never inferred from a changed test file or model prose. PR gate
commands produce receipts with exact command, status, exit code, and duration.
When Diffwright recognizes a bounded TAP summary, it includes the exact test
totals. Otherwise it says that test counts are unavailable instead of inventing
them. Raw gate output remains local and never enters provider evidence.

After deterministic parsing and rendering, a separate critic checks every
renderable model-authored claim and trailer against only its cited original
evidence. Validation receipt text is excluded from that model audit because it is
rendered from receipts. The critic cannot rewrite. A negative verdict removes
an optional claim or trailer. A negative primary verdict permits one grounded
replacement and second audit; malformed, missing, duplicate, mismatched, or a
second negative primary verdict stops before preview or mutation.

This is a grounding and provenance contract, not proof that arbitrary prose is
true and not a claim of formal ASD-STE100 compliance. Editorial checks are
bounded advisories and never silently rewrite the artifact.

## Repository policy

Diffwright optionally reads `.diffwrightrc.json` from the repository root. The
file is strict UTF-8 JSON, at most 64 KiB, versioned, tracked at the applicable
Git revision, and must use only documented keys. Unsafe Git entries, duplicate
keys, unknown fields, unsupported controls, and out-of-range values fail closed.

```json
{
  "$schema": "https://raw.githubusercontent.com/AndrewUlloa/diffwright/main/documentation/diffwrightrc.schema.json",
  "version": 1,
  "title": {
    "additionalTypes": ["security"],
    "scopeMode": "optional",
    "allowedScopes": ["cli", "release"],
    "targetLength": 50
  },
  "editorial": {
    "maxSentenceWords": 25,
    "duplicateClaimMinWords": 4,
    "vagueAbsolutes": ["always", "never", "guarantees"],
    "terminologyGroups": [
      { "name": "pull request", "terms": ["pull request", "PR"] }
    ]
  }
}
```

`additionalTypes` extends the standard Conventional Commit types; it cannot
remove `feat` or `fix`. `scopeMode` is `optional` or `forbidden`; an allowlist
can further restrict optional scopes. `targetLength` sets the advisory target
from 1 through 72 characters and cannot exceed the immutable 72-character
header maximum. Editorial
findings cover sentence length, vague absolutes, normalized duplicate claims,
and mixed terminology. They are warnings only.

Additional types extend local validation and can be selected during
interactive PR editing. Automatic generation continues to request only the
standard Conventional Commit types in this release because repository policy is
not sent to the configured provider.

Commit generation loads policy from the last committed `HEAD`, before staging;
a staged policy change applies on the next commit. PR generation loads policy
from the pinned base commit, not the feature branch. When the policy itself is
changed, its raw patch is replaced with bounded change metadata before provider
serialization. Policy values are enforced locally and are not added as a
free-form prompt suffix.

See the shipped
[JSON Schema](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/diffwrightrc.schema.json)
for exact bounds.

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
