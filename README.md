<div align="center">

<h1>Diffwright</h1>

<p><strong>Compile Git evidence into Conventional Commits and PRs—with your own AI.</strong></p>

<p>Bring OpenAI, Anthropic, Gemini, xAI, DeepSeek, OpenRouter, Vercel AI<br>
Gateway, Cerebras, Groq, Ollama, or any compatible endpoint.</p>

<a href="https://www.npmjs.com/package/diffwright"><img alt="npm version" src="https://img.shields.io/npm/v/diffwright?style=flat-square"></a>
<a href="https://www.npmjs.com/package/diffwright"><img alt="npm downloads" src="https://img.shields.io/npm/dw/diffwright?style=flat-square"></a>
<a href="https://github.com/AndrewUlloa/diffwright/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/AndrewUlloa/diffwright?style=flat-square"></a>
<a href="https://github.com/AndrewUlloa/diffwright/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/AndrewUlloa/diffwright?style=flat-square"></a>
<a href="https://github.com/AndrewUlloa/diffwright/blob/main/LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/npm/l/diffwright?style=flat-square"></a>

</div>

[Quick start](#quick-start) · [Commands](#commands) · [Providers](#providers) · [Security](#security-and-privacy) · [Documentation](#documentation) · [Releases](https://github.com/AndrewUlloa/diffwright/releases)

Run guided setup with the package runner already used by your project:

| Package runner | Command |
|---|---|
| pnpm | `pnpm dlx diffwright@latest init` |
| npm | `npx diffwright@latest init` |
| Yarn 2+ | `yarn dlx diffwright@latest init` |
| Bun | `bunx diffwright@latest init` |

Yarn Classic does not provide `yarn dlx`. Launch the wizard with `npx` in a
Yarn Classic project; Diffwright still detects `yarn.lock` and uses Yarn for
the exact local installation and generated scripts.

## Choose your workflow

| You want to… | Preview or inspect | Run it |
|---|---|---|
| Configure a project | Use the matching `init --dry-run` command in [Quick start](#quick-start) | Use the matching guided setup command in [Quick start](#quick-start) |
| Write a Conventional Commit | Stage files, then `diffwright commit --dry-run` | Stage files, then `diffwright commit` |
| Summarize a branch for a PR | `diffwright pr --dry-run` | `diffwright pr` |
| Create or update the GitHub PR | — | `diffwright pr --create-pr` |
| Check provider configuration | `diffwright doctor` | `diffwright doctor --live` |

`commit` commits and pushes by default. It reads only the staged diff unless
`--all` explicitly stages the working tree first. Its dry run prevents commit
and push but still calls the provider twice: once for a structured draft and
once for a separate terminal evidence critique. One draft-repair request is
possible.
PR dry run has a different contract: it
does not call the provider or write summaries, but it may fetch the base branch.
See [Command behavior](#command-behavior) before running Diffwright in automation.

## Requirements

- Node.js 18 or newer
- Commit and PR workflows require a Git repository with at least one commit.
- Commit, PR, and doctor require an AI provider API key or a local
  Ollama/compatible loopback endpoint.
- GitHub CLI (`gh`) authenticated with `gh auth login` only when using
  `--create-pr`

## Quick start

### 1. Run guided setup

From the project you want to configure:

| Package runner | Preview without project writes | Guided setup |
|---|---|---|
| pnpm | `pnpm dlx diffwright@latest init --dry-run` | `pnpm dlx diffwright@latest init` |
| npm | `npx diffwright@latest init --dry-run` | `npx diffwright@latest init` |
| Yarn 2+ | `yarn dlx diffwright@latest init --dry-run` | `yarn dlx diffwright@latest init` |
| Bun | `bunx diffwright@latest init --dry-run` | `bunx diffwright@latest init` |

These commands only choose the temporary package runner. The wizard separately
detects the target project's `packageManager` declaration and lockfile, then
uses npm, pnpm, Yarn, or Bun for the permanent exact-version development
dependency, lockfile update, and generated project commands.

When stdin and stdout are an interactive TTY, `init` walks through the provider,
exact model, credential source, feature-branch base, existing lint/typecheck/test/
build gates, and optional Claude Code or Codex guardrails. It detects npm, pnpm,
Yarn, or Bun and whether the repository uses a `staging` branch.

The wizard also configures repository policy: confirmed optional scopes,
linked-issue expectations, guarded squash versus platform-managed merging,
post-squash branch deletion, and whether a reviewer-oriented PR template should
be created when none exists. Scope suggestions come only from bounded workspace
or component names and existing scoped history, and remain suggestions until
you confirm them. Headless `--yes` never invents an allowlist.

Before changing anything, the wizard shows one redacted preview and asks for
confirmation. It never prints a credential. Declining or pressing Ctrl-C before
confirmation exits without writes or provider calls.

For an external project, confirmed setup pins the exact running Diffwright
version as a local development dependency and updates the detected lockfile;
install lifecycle scripts are disabled. In Diffwright's own validated checkout,
the self-hosted workflow does not create a self-dependency: generated scripts
build and invoke `node ./bin/diffwright.js` directly.

The wizard can add branch-aware, gate-aware package scripts, a `pr:merge`
script for guarded squash policy, and one managed block to selected `CLAUDE.md`
and/or `AGENTS.md` files. The managed guidance covers semantic Conventional
Commit types, confirmed scopes, context, substantive PR coverage, exact
validation, and the approved merge path. When requested, init also creates a
reviewer-oriented `.github/pull_request_template.md` only if the repository has
no user template; reruns update only Diffwright's own marked block. Text outside
those marked blocks and custom package scripts are preserved.

### 2. Configure your provider

The wizard prefers existing configuration. A shell credential can be reused
without copying it. In an interactive TTY, you may instead enter a credential
with no character echo for storage in `.env.local`; Diffwright protects the file
with `.gitignore` before writing the key. Shell values—including explicitly
empty values—override `.env.local`.

You can also choose **Configure later**. The wizard applies only nonsecret
workflow/configuration files, skips doctor, and clearly reports that setup is
incomplete until you add the credential and pass the offline check.

For manual setup, the equivalent configuration is:

```bash
DIFFWRIGHT_PROVIDER="openrouter"
DIFFWRIGHT_MODEL="anthropic/claude-sonnet-4"
OPENROUTER_API_KEY="your-key-here"
```

Use the exact model ID listed by your provider. The
[provider guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md)
links to official key and model pages for every preset.

### 3. Validate and preview

After setup, `init` runs the offline doctor: it resolves and prints the provider,
model, endpoint hostname, and credential source without making a network
request. A live check is a separate opt-in and makes exactly one provider
request.

The wizard prints commands for the detected package manager. For npm projects:

```bash
npm run commit -- --dry-run
npm run feature:pr -- --dry-run
```

Important: a commit dry-run candidate is not reused. Running `diffwright commit`
afterward calls the provider again, so the final text may differ. A successful
generation normally makes two requests: the draft and its evidence critique.

### Headless and automation modes

A no-argument, non-TTY `diffwright init` retains the legacy behavior: it only
adds the four generic Diffwright scripts or migrates exact ChangeScribe values.
It does not prompt, install a package, write credentials or agent rules, or run
doctor.

`--yes` never prompts. It uses supplied choices and safe detected defaults, but
it cannot invent a missing credential and does not install agent rules unless
`--agents` names them. `--live` is never implied by `--yes`.

`--dry-run` computes and prints the same redacted setup plan with no installs,
writes, or live provider request. Provider, model, base, agent, and credential-
source flags select deterministic setup without putting any credential in argv.
See the [CLI reference](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md)
for every combination.

When launched through `pnpm dlx`, `npx`, `yarn dlx`, or `bunx`, the package
runner may first download Diffwright to its own cache or temporary environment.
`--dry-run` prevents a dependency install or file write in the target project;
it cannot prevent the selected runner from resolving the CLI itself.

Global installation remains available for personal use, but project scripts
created by guided setup use the exact local pin instead of a global executable:

```bash
npm install -g diffwright
```

## Example output

Commit preview:

```text
$ diffwright commit --dry-run
🔍 Analyzing staged changes...
🤖 Generating commit message with AI (openrouter)...

fix(parser): reject empty tokens

Preserve the original token offset in validation errors.
```

PR-ready output:

```markdown
## Summary

- Reject unknown CLI options before Git or provider side effects.

## Changes

- Add a supported `Closes #123` directive to the final body.

## Validation

- Passed: `npm test` in 2.14 s — 327/327 tests passed

## Review focus

- Check argument validation and GitHub CLI boundaries.

Closes #123
```

## Why Diffwright

| Capability | What it gives you |
|---|---|
| Commit and PR workflows | One CLI turns staged changes into commit text and branch history into review-ready summaries. |
| Evidence-backed claims | Every generated claim cites immutable Git, intent, constraint, history, or verification evidence before rendering. |
| Terminal critique | A separate call to the resolved provider and model checks all rendered model-authored claims against their cited original evidence. |
| Deterministic artifacts | Diffwright validates structured JSON, then renders Conventional Commit syntax and PR Markdown locally. |
| Bring your own AI | Use a direct provider, a gateway, or a local OpenAI-compatible server. |
| Deterministic routing | One invocation resolves one provider and never silently fails over to another. |
| Local-first configuration | Keys stay in process memory and requests go directly to the resolved endpoint. |
| Guided project setup | Detect package manager, branches, gates, and agent harnesses, then preview before writing. |
| Fail-closed CLI | Unknown options, missing values, and invalid limit/issue/mode values stop before workflow side effects. |
| Legacy compatibility | Existing Cerebras, Groq, and ChangeScribe setups continue to work. |

## Commands

| Command | Behavior |
|---|---|
| `diffwright doctor` | Validate configuration offline; no provider request. |
| `diffwright doctor --live` | Make one minimal request through the production transport. |
| `diffwright commit --dry-run` | Generate from the staged diff and print a candidate; no index mutation, commit, or push. |
| `diffwright commit --all --dry-run` | Explicitly stage all changes, then generate and print a candidate. |
| `diffwright commit --context-file <path>` | Add bounded source-agnostic intent from a regular project file. |
| `diffwright commit --timings` | Print local phase durations after success or failure. |
| `diffwright commit` | Generate from the staged diff, commit it, and push the current branch. |
| `diffwright commit --all` | Explicitly stage all changes, then generate, commit, and push. |
| `diffwright pr --dry-run` | Fetch when possible, resolve the commit range, and print the plan; no provider call or output write. |
| `diffwright pr` | Generate detailed and PR-ready summaries. |
| `diffwright pr --create-pr` | Run project gates, then create or update the GitHub PR with `gh`. |
| `diffwright pr --create-pr --yes` | Explicitly approve validated GitHub mutation in noninteractive automation. |
| `diffwright pr --timings` | Print local phase durations after success or failure. |
| `diffwright merge --dry-run` | Validate and preview the current PR's pinned squash merge; no mutation. |
| `diffwright merge` | Validate twice, confirm interactively, and squash-merge the exact reviewed PR head. |
| `diffwright merge --yes` | Explicitly approve the same pinned squash merge in noninteractive automation. |
| `diffwright title-check --event-file "$GITHUB_EVENT_PATH"` | Validate a PR-event title against the policy pinned to its base revision. |
| `diffwright init` | Guide an interactive TTY through project setup; preserve legacy script-only behavior in a no-argument non-TTY. |
| `diffwright --version` | Print the exact installed Diffwright version. |

Run `diffwright <command> --help` for focused help. The
[complete CLI reference](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md)
documents every flag, default, alias, side effect, and exit behavior.

## Command behavior

| Command | Provider requests | Files/index | Network or repository effects |
|---|---:|---|---|
| `doctor` | 0 | none | none |
| `doctor --live` | 1 | none | calls the resolved endpoint |
| `commit --dry-run` | 2 normally; up to 5 across bounded draft and primary-claim repairs | reads the staged diff only | no commit or push |
| `commit --all --dry-run` | 2 normally; up to 5 across bounded draft and primary-claim repairs | explicitly stages all changes | no commit or push |
| `commit` | 2 normally; up to 5 across bounded draft and primary-claim repairs | reads the staged diff and creates an exact snapshot-bound commit | pushes the verified commit SHA |
| `commit --all` | 2 normally; up to 5 across bounded draft and primary-claim repairs | explicitly stages all changes and creates an exact snapshot-bound commit | pushes the verified commit SHA |
| `pr --dry-run` | 0 | no summary files | attempts an explicit base-ref fetch; falls back to local refs |
| `pr` | 2 normally; up to 5 across bounded draft and primary-claim repairs | overwrites the requested file, a sibling `.final.md`, and a temporary backup | attempts to fetch the base |
| `pr --create-pr` | Same structured generation | may run format, always runs the detected package manager's test/build scripts (`npm test` and `npm run build` for npm), then reviews and writes the exact final artifact | pushes the reviewed SHA when creating; an update requires the remote PR head to already equal it |
| `merge --dry-run` | 0 | none | reads the exact live PR, checks, reviews, title policy, and remote revisions; no merge |
| `merge` | 0 | none | after confirmation and a second full validation, requests one pinned squash merge, confirms its postcondition, and optionally deletes the unchanged reviewed branch |
| `title-check` | 0 | none | reads one bounded event file and the base revision's local policy; no network or GitHub mutation |
| `init --dry-run` | 0 | none | previews the redacted setup plan; no install or live request |
| no-argument non-TTY `init` | 0 | edits `package.json` only when generic scripts are added or migrated | none |
| guided or `--yes` `init` | 0 by default; 1 only with explicit live consent | may update `package.json`, a lockfile, `.diffwrightrc.json`, `.github/pull_request_template.md`, `.gitignore`, `.env.local`, `CLAUDE.md`, and `AGENTS.md` after interactive confirmation or deterministic `--yes` planning | may install the exact local package; runs offline doctor; live doctor is separately explicit |

Commit and PR synthesis send complete bounded evidence for a structured draft,
then send the same original evidence and every renderable model-authored claim
to a separate terminal critic call. The critic uses the same resolved provider
and model as the draft and cannot rewrite prose. Diffwright removes critic-
rejected optional claims and trailers before rendering. If the primary claim is
rejected, Diffwright requests one smaller replacement from the original evidence
and audits it again; a second rejection is terminal. One separate draft repair
is possible when deterministic validation rejects a provider response. Oversized
or incomplete evidence stops instead of being silently truncated.

`--timings` is opt-in for `commit` and `pr`. It prints fixed phase names and
millisecond durations after success or failure. Reports stay local and contain
no repository paths, evidence text, credentials, or telemetry.

`--create-pr` uses the detected package manager. It runs
`format` only when that script exists unless you skip it; test and build always
run (`npm test` and `npm run build` in an npm project). Those gates can modify
files and run arbitrary project code before Diffwright performs its dirty-tree
check.

In an interactive terminal, GitHub mutation shows the exact Conventional title
and body and offers Approve, Edit, or Cancel. Editing uses the executable named
by `DIFFWRIGHT_EDITOR`, then `EDITOR`, then `vi`; the value must be one executable
without arguments. A noninteractive `--create-pr` requires explicit `--yes`.
Generated consumer scripts keep this review enabled by default; automation can
append `-- --yes` deliberately.

`merge` operates on exactly one open same-repository PR for the current branch.
It requires GitHub CLI 2.50.0 or newer.
It requires a clean working tree, matching local and remote head SHA, a canonical
Conventional Commit PR title under the pinned base policy, a clean merge state,
no unresolved review changes, and at least one reported check with every check
passed or skipped. Repositories that require a merge queue are rejected rather
than bypassed, including for privileged callers. After confirmation, it repeats
the validation and calls GitHub's direct pull-request merge API with the numeric
PR, repository, reviewed
head SHA, validated title, and squash method. It never uses admin, auto-merge, rebase, merge-commit, or
branch-deletion fallbacks. A platform-managed policy stops before mutation. If
the pinned policy requests deletion, Diffwright rechecks the reviewed remote
repository and deletes the explicit remote ref with an atomic lease on the
reviewed head SHA, only after the exact squash commit is confirmed. If the
branch moved or deletion is uncertain, the merge remains complete and the
command says not to retry it.

The separate `PR title` workflow runs on opened, edited, synchronized,
reopened, and ready-for-review pull requests. It uses `pull_request_target`
only to execute the exact trusted base revision with read-only permissions; it
never checks out or runs pull-request code. The workflow passes only the fixed
GitHub event-file path to `title-check`, which loads policy from the event's
full base SHA. A feature branch therefore cannot replace the validator or
loosen the policy that reviews its own PR, and editing the title retriggers the
check. The workflow first becomes active after it lands on the default branch.

### Evidence contract

- Commits use the pinned `HEAD` and Git index tree. Working-tree changes are
  excluded unless `--all` explicitly stages them.
- PRs use the final `merge-base...HEAD` net diff. Reverted intermediate work is
  absent; deletions, renames, type changes, binary metadata, and unusual
  filenames remain visible to the collector.
- A changed test file is only a code change. Validation text comes only from
  a captured command receipt with its exact status. Recognized TAP totals are
  exact; unknown output formats are labeled unavailable.
- The model returns claims and evidence IDs, not final Markdown. Diffwright
  validates the links, chooses supported claims, and renders locally.
- Coverage limits fail closed. Diffwright does not silently slice a file or
  claim that a partially observed change is complete.
- Before mutation, Diffwright rechecks the pinned index, local head, remote
  base, and applicable remote PR head. Git-hook output must still match the
  reviewed tree, parent, and message.

This contract reduces unsupported prose; it does not prove that an arbitrary
natural-language interpretation is true. The critic can remove optional prose
or require one newly audited primary replacement, but it is not an oracle.

### Repository policy

An optional root `.diffwrightrc.json` can add accepted Conventional Commit
types, forbid or allowlist scopes, set the advisory title target from 1 through
72 characters, and configure advisory sentence, absolute-language,
duplicate-claim, and terminology checks. Version 2 also records bounded local
workflow preferences for issue context, PR-template creation, squash versus
platform-managed merging, and post-squash branch deletion. The 72-character
maximum and evidence/security boundaries cannot be loosened.

Additional types extend local validation and the interactive PR editing path.
Automatic generation intentionally asks for the standard Conventional Commit
types in this release; repository policy is not copied into provider prompts.

Commits read policy from the last committed `HEAD`; a staged policy change
applies to the next commit. PRs read policy from the pinned base SHA, so a
feature branch cannot weaken the rules that review it. Policy patch contents
are replaced with bounded metadata before any provider request. Warnings never
rewrite approved text.

Existing version-1 files retain their exact resolved shape and behavior.
Version 2 defaults to recommended issue context, creating a template only when
none exists, squash merging, and preserving the feature branch. Platform-
managed merging cannot request Diffwright branch deletion. Grounding, critic,
coverage, redaction, freshness, and request ceilings are not configuration
fields and cannot be disabled.

See the shipped
[JSON Schema](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/diffwrightrc.schema.json)
for the exact version-1 and version-2 fields and bounds.

The default PR output is `.pr-summaries/PR_SUMMARY.md`; the slim GitHub body is
`.pr-summaries/PR_SUMMARY.final.md`. A separate temporary backup is also
created. Choose `--out` when you need another path.

PR dry-run still resolves provider configuration so it can show the selected
provider and model; it simply does not send a request.

## Providers

Set `DIFFWRIGHT_PROVIDER`, the provider credential, and the exact
`DIFFWRIGHT_MODEL`. Cerebras and Groq retain legacy defaults.

| Provider | ID | Credential | Status |
|---|---|---|---|
| OpenAI | `openai` | `OPENAI_API_KEY` | `docs-verified` |
| Anthropic compatibility API | `anthropic` | `ANTHROPIC_API_KEY` | `experimental` |
| Google Gemini | `google` | `GEMINI_API_KEY` | `docs-verified` |
| xAI | `xai` | `XAI_API_KEY` | `docs-verified` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `docs-verified` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `docs-verified` |
| Vercel AI Gateway | `vercel` | `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | `docs-verified` |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | `docs-verified` |
| Groq | `groq` | `GROQ_API_KEY` | `docs-verified` |
| Ollama | `ollama` | none | `docs-verified` |
| Compatible endpoint | `custom` | `DIFFWRIGHT_API_KEY` | `user-defined` |

`docs-verified` means the adapter matches the provider's documented OpenAI
Chat Completions contract; it does not mean every model was live-tested.
Anthropic describes its compatibility layer as suitable for testing and
comparison rather than a long-term native integration, so it is marked
`experimental`.

### Direct provider

```bash
DIFFWRIGHT_PROVIDER="openai"
DIFFWRIGHT_MODEL="your-exact-model-id"
OPENAI_API_KEY="your-key-here"
```

### Vercel AI Gateway

```bash
DIFFWRIGHT_PROVIDER="vercel"
DIFFWRIGHT_MODEL="provider/model"
AI_GATEWAY_API_KEY="your-gateway-key"
```

Gateway authentication is required even when downstream provider BYOK is
configured in Vercel. `AI_GATEWAY_API_KEY` wins over `VERCEL_OIDC_TOKEN`; OIDC
is eligible only when Vercel is explicitly selected. For each model call,
Diffwright sends one outbound request to Vercel and does not retry or reroute
it itself; a PR workflow makes multiple model calls. Vercel may independently
route, retry, or use system-credit fallback. Use Vercel's BYOK key test and
attempt observability to confirm which downstream credential was used.

### Ollama and compatible endpoints

```bash
DIFFWRIGHT_PROVIDER="ollama"
DIFFWRIGHT_MODEL="qwen3:8b"
```

The preset uses `http://localhost:11434/v1`. Custom remote endpoints require
HTTPS and a key; keyless HTTP is allowed only for loopback hosts.

For precedence, legacy configuration, custom URLs, and official provider setup
links, see the [provider guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md).

## Security and privacy

Diffwright sends credentials and diff content directly from your machine to
the resolved endpoint. It does not operate a proxy or credential vault.

- One invocation resolves one provider; Diffwright never fails over to another.
- SDK retries are disabled and HTTP redirects are rejected.
- Provider credentials are removed from environments inherited by Git hooks,
  GitHub CLI, npm, tests, builds, and formatters.
- Exact configured provider-key values are redacted from prompts, responses,
  diagnostics, console output, and generated files.
- Repository-policy patch contents stay local; only bounded policy metadata can
  enter change evidence.
- Custom remote endpoints require HTTPS; keyless endpoints are loopback-only.

Diffwright does not scan diffs for arbitrary secrets. Review what is staged
before calling a remote provider: any non-provider secret in a diff can still
be sent. Use least-privilege keys and review each provider or gateway's
retention, billing, fallback, and privacy policies.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/AndrewUlloa/diffwright/security/advisories/new).
Read the [security policy](https://github.com/AndrewUlloa/diffwright/blob/main/SECURITY.md)
before reporting.

## Troubleshooting

- Run `diffwright doctor` first; it is offline and shows which configuration won.
- Use `diffwright doctor --live` for one request and a categorized failure.
- A provider `404` usually means the endpoint or exact model ID is unavailable.
- `429` is a provider quota or rate-limit response, not automatic failover.
- If PR range fetch fails, Diffwright says so and tries local refs.

The [troubleshooting guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/troubleshooting.md)
maps every diagnostic category to likely causes and safe information to include
in a bug report.

## Documentation

- [CLI reference](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md)
- [Repository-policy JSON Schema](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/diffwrightrc.schema.json)
- [Provider setup](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md)
- [Troubleshooting](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/troubleshooting.md)
- [Release process](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/releases.md)
- [Changelog](https://github.com/AndrewUlloa/diffwright/blob/main/CHANGELOG.md)
- [Contributing](https://github.com/AndrewUlloa/diffwright/blob/main/CONTRIBUTING.md)
- [Support](https://github.com/AndrewUlloa/diffwright/blob/main/SUPPORT.md)
- [Security policy](https://github.com/AndrewUlloa/diffwright/blob/main/SECURITY.md)

## Migrating from ChangeScribe

The `cli-changescribe` compatibility package delegates existing commands to
Diffwright. Migrate when convenient:

```bash
npm uninstall -g cli-changescribe
npm install -g diffwright
```

## Development

Diffwright is strict TypeScript compiled to CommonJS for Node.js 18 and newer.

```bash
git clone https://github.com/AndrewUlloa/diffwright.git
cd diffwright
npm ci
npm run typecheck
npm test
```

The source lives in `src/`; `bin/diffwright.js` remains the stable executable
for npm and ChangeScribe compatibility.

## Project

- [Source](https://github.com/AndrewUlloa/diffwright)
- [Issues](https://github.com/AndrewUlloa/diffwright/issues)
- [npm](https://www.npmjs.com/package/diffwright)
- [Apache 2.0 license](https://github.com/AndrewUlloa/diffwright/blob/main/LICENSE)
- [Attribution notice](https://github.com/AndrewUlloa/diffwright/blob/main/NOTICE)

Diffwright `0.5.0` and later are licensed under Apache 2.0. Versions through
`0.4.4` remain available under the MIT license that accompanied those releases.
