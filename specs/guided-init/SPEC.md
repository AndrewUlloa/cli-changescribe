# Spec: Guided project initialization

> Filed by: Codex orchestration session
> Status: implemented and verified
> Last updated: 2026-08-14

## One-line summary

Turn `npx diffwright@latest init` into a TTY-aware setup wizard that safely
configures a provider, project scripts, branch topology, agent workflow rules,
and validation while preserving deterministic legacy behavior for automation.

## Objective

Diffwright currently adds four package scripts and exits. A new user must still
read multiple documents, select and configure a provider, understand model and
credential variables, correct generic branch assumptions, teach coding agents
to use the scripts, and discover `doctor` independently. Build one guided flow
that detects the project, explains each decision, previews all writes, applies
only confirmed changes, and proves the resulting configuration.

The primary user is a developer adopting Diffwright in an existing npm, pnpm,
Yarn, or Bun-managed Git repository, including developers who delegate Git
workflows to Claude Code or Codex.

Success means an interactive user can go from an unconfigured repository to a
validated Diffwright setup through one command, while existing non-interactive
`diffwright init` callers retain the current script-only behavior.

## Approved product shape

`init` is interactive only when both stdin and stdout are TTYs and the caller
did not request a deterministic mode. Non-TTY invocation retains the existing
idempotent script migration. `--yes` selects safe detected defaults without
prompts, and `--dry-run` previews without writing files or making a live
provider request.

The interactive journey is:

1. Detect package manager, Git repository, default/current branch, existing
   scripts, provider configuration, and supported agent instruction files.
2. Select a provider and exact model, reusing detected values by default.
3. Pin the running Diffwright version as a local development dependency through
   the detected package manager so later scripts cannot resolve a stale global
   binary. When initializing Diffwright's own repository, use its validated
   local bin instead of adding a self-dependency.
4. Reuse an existing credential or optionally enter one through a masked TTY
   prompt for storage in `.env.local`; never accept credentials in argv.
5. Select the feature PR base, defaulting to `staging` only when that branch is
   present and otherwise to the detected default branch or `main`.
6. Select the existing lint, typecheck, test, and build gates that must pass
   before Diffwright creates a commit.
7. Select Claude Code and/or Codex workflow guardrails.
8. Preview every proposed file change and side effect.
9. Confirm once, then apply changes atomically where practical.
10. Run offline doctor validation and explicitly offer one live provider call.
11. Print the exact preview and live workflow commands appropriate to the
   detected package manager and branch topology.

## Assumptions

- Node.js 18 remains the minimum runtime.
- No new runtime dependency is necessary; prompts use Node built-ins behind an
  injectable interface.
- Existing explicit provider/model/credential configuration is preferred over
  introducing conflicting values.
- `.env.local` remains the supported project-local configuration file and
  shell variables continue to win.
- Agent guardrails are opt-in, marker-delimited, and idempotent; unrelated
  instruction content is never rewritten.
- The requester approved this shape and its secure masked-credential option by
  approving the complete proposal and requesting implementation.

## Success criteria

| # | Criterion | Measurement | Target |
|---|---|---|---|
| 1 | One-command guided setup | Black-box TTY fixture | `npx diffwright@latest init` reaches a confirmed, validated setup |
| 2 | Backward-compatible automation | Non-TTY and `--yes` tests | Legacy script-only init remains deterministic and never waits for input |
| 3 | Safe preview | `--dry-run` filesystem test | Reports planned changes with zero file writes and zero live requests |
| 4 | Complete provider configuration | Provider matrix tests | Every supported provider exposes the correct model, endpoint, and credential requirements |
| 5 | Secret-safe handling | Unit and integration tests | Credentials never appear in argv, previews, logs, errors, generated agent files, or test snapshots |
| 6 | Pinned executable provenance | Clean-install and package-manager tests | External projects install the exact running Diffwright version locally; the Diffwright repository invokes its validated local bin |
| 7 | Gate-aware commits | Script fixture tests | Selected existing lint/typecheck/test/build gates run successfully before `diffwright commit` |
| 8 | Branch-aware workflows | Git fixture tests | Main-only and staging-based repositories receive working feature/release commands |
| 9 | Agent enforcement | CLAUDE/AGENTS fixture tests | Selected files receive one replaceable Diffwright block and preserve all unrelated content |
| 10 | Idempotent writes | Second-run tests | Re-running the same choices produces no content changes or duplicate rules |
| 11 | Validated completion | Doctor handoff tests | Offline doctor runs after apply; live validation occurs only after explicit opt-in or `--live` |
| 12 | Release integrity | Full gates and clean packed install | Typecheck, 93+ tests, pack, audit, Node 18/20/22 CI contract, and ChangeScribe bridge stay green |

## Command contract

```text
diffwright init [options]

--yes                    Accept safe detected defaults; never prompt.
--dry-run                Preview without writes or live provider requests.
--provider <id>          Select a supported provider.
--model <id>             Set the exact provider model identifier.
--base <branch>          Set the feature pull-request base branch.
--agents <targets>       Comma-separated claude,codex,none.
--credential-source <s>  existing or file; never a credential value.
--live                   Run one provider request after offline validation.
```

Rules:

- Unknown, duplicated-conflicting, malformed, or incomplete options fail
  before prompting, Git, file writes, or provider calls.
- `--provider`, `--model`, `--base`, `--agents`, and
  `--credential-source` imply deterministic setup and therefore never prompt.
- A deterministic provider configuration that requires a missing credential
  fails with actionable instructions; credentials cannot be passed by flag.
- `--live` is never implied by `--yes` and is incompatible with `--dry-run`.
- `--agents none` is exclusive; `claude,codex` is accepted in either order and
  normalized.
- `init --help` documents every option and side effect without invoking init.

## Configuration contract

### Provider and environment

- Write only Diffwright-owned keys selected by the user:
  `DIFFWRIGHT_PROVIDER`, `DIFFWRIGHT_MODEL`, optional
  `DIFFWRIGHT_BASE_URL`, and the selected credential variable.
- Preserve comments, ordering, newline style, unrelated variables, and final
  newline behavior in an existing `.env.local` as far as practical.
- Shell credentials satisfy setup without being copied into `.env.local`.
- Masked credential input is available only on a real TTY, echoes no secret
  characters, restores terminal mode on success/error/interrupt, and is never
  retained outside the pending in-memory write plan.
- Add `.env.local` to `.gitignore` when needed. Never write a credential unless
  `.env.local` is ignored by Git in the resulting plan.
- Create a new `.env.local` with owner read/write permissions. Preserve the
  permissions of an existing file.

### Package scripts and topology

- In external projects, install the exact running Diffwright version as a local
  development dependency and update the detected package-manager lockfile.
  Installation is shown in preview and happens only after confirmation.
- Never add `diffwright` as its own dependency. In the Diffwright repository,
  verify `package.json.name`, the package version, and `bin/diffwright.js`, then
  generate self-hosted scripts that build and invoke `node ./bin/diffwright.js`.
- Preserve non-Diffwright custom scripts.
- Migrate exact legacy ChangeScribe-generated values.
- Detect existing `lint`, `typecheck`, `test`, and `build` scripts and let the
  interactive user confirm which gates precede commit generation. Generate a
  single `commit` script that runs those gates in order and invokes Diffwright
  only after every gate succeeds. Do not claim a gate is enforced unless it is
  present in the resulting command.
- In an interactive main-only repository, `feature:pr` targets the detected
  default branch (normally `main`) explicitly.
- When a `staging` branch exists and is selected as the feature base,
  `feature:pr` targets `staging` and `staging:pr` targets `main` in release
  mode.
- External-project script values invoke the locally installed `diffwright`
  binary supplied by the package manager. Self-hosted scripts invoke the
  repository bin directly. The wizard prints the pinned/running version and
  executable provenance in its completion summary.
- Legacy non-TTY init retains the existing four generic script values exactly.

### Agent workflow guardrails

- Claude Code targets root `CLAUDE.md`; Codex targets root `AGENTS.md`.
- Insert or replace a marker-delimited Diffwright section without altering
  text outside the markers.
- The block forbids raw `git add`, `git commit`, `git push`, `gh pr create`, and
  `gh pr edit` for shipping work; permits read-only inspection; names the exact
  project gate, commit, and PR commands; forbids bypass after failures; and
  treats generated commit/PR content as authoritative.
- Missing instruction files are created with a minimal title and the managed
  block. Existing files are preserved byte-for-byte outside that block.

### Preview, writes, cancellation, and validation

- Show paths and redacted semantic changes, never raw credential values.
- A declined confirmation or Ctrl-C exits without writes, provider calls, or
  partial configuration.
- Validate all proposed text in memory before applying writes.
- Use same-directory temporary files plus rename for project file updates when
  the platform permits; clean temporary files after failures.
- Reject non-regular sensitive targets and unsafe paths rather than following
  unexpected symlinks.
- Run offline doctor only after successful application. A doctor failure keeps
  the files and exits nonzero with corrective guidance.
- Live doctor is a separate explicit consent step and makes exactly one request.

## User stories

- As a first-time user, I want the CLI to explain each setup choice so I can
  succeed without reading several reference pages first.
- As a BYOK user, I want my key masked and excluded from Git, arguments, and
  logs so onboarding does not weaken credential safety.
- As a maintainer with a main-only repository, I want generated PR scripts to
  target `main` rather than a nonexistent `staging` branch.
- As a Claude or Codex user, I want the wizard to install enforceable workflow
  rules so agents actually use Diffwright.
- As a CI maintainer, I want non-interactive init to remain deterministic and
  never hang on prompts.

## Non-goals

- Creating a new application or installing Git, GitHub CLI, Node, or a package
  manager.
- Fetching provider model catalogs or validating every possible model ID.
- Browser-based provider authentication or storing credentials outside the
  project `.env.local`/existing shell environment.
- Supporting agent harnesses other than Claude Code and Codex in this release.
- Automatically committing, pushing, opening a PR, publishing npm packages, or
  editing global installations during setup. Installing the exact running
  Diffwright version locally is in scope and always previewed.
- Changing commit/PR generation prompts or provider transport semantics.
- Adding analytics, telemetry, update checks, or a hosted Diffwright service.

## Tech stack and project structure

- Strict TypeScript compiled to CommonJS for Node.js 18+.
- Node built-in test runner with tests compiled into `.test-dist/`.
- Node built-in readline, filesystem, process, and child-process APIs.
- Existing OpenAI SDK and dotenv parser; no new dependency.

Likely ownership:

```text
src/init.ts             setup discovery, planning, writes, managed rules
src/init-prompts.ts     injectable TTY prompt implementation
src/arguments.ts        init option validation
src/cli.ts              async init routing and help
test/branding.test.ts   public CLI and legacy-init behavior
test/init-wizard.test.ts focused wizard/filesystem/security behavior
documentation/*         command and troubleshooting reference
README.md               guided quick start
```

## Verification commands

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

- Add failing behavior tests before each implementation slice.
- Redact secrets from previews, errors, child processes, and generated text.
- Preserve legacy non-TTY init and ChangeScribe compatibility.
- Preserve unrelated user files and instruction-file content.
- Keep the CLI usable on Node 18/20/22.

### Ask first

- Add a new runtime dependency.
- Change the supported Node range.
- Support another agent harness or configuration store.
- Change the existing commit/PR generation formats.

### Never

- Accept a credential on the command line.
- Echo, log, snapshot, commit, or send a credential to an unintended endpoint.
- Silently overwrite custom scripts, environment values, or agent instructions.
- Prompt or make a live request in non-interactive mode without an explicit
  flag.
- Fall back to raw Git/GitHub mutation when Diffwright fails.
- Modify the existing untracked root `docs/` directory.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Terminal secret prompt leaves raw mode enabled | Low | High | Centralized `finally` restoration plus interrupt/error tests around the prompt adapter |
| `.env.local` rewrite loses user formatting or comments | Medium | High | Line-aware upsert and fixtures covering CRLF, comments, duplicates, and no final newline |
| Agent rule update damages an existing instruction file | Low | High | Marker-only replacement, in-memory preview, confirmation, atomic rename, preservation tests |
| Interactive init breaks scripts or clean installs | Medium | High | TTY gating, exact non-TTY compatibility tests, and packed-install E2E |
| Branch detection selects the wrong PR base | Medium | Medium | Local-ref-only discovery, explicit displayed default, user override, and main/staging fixtures |
| Wizard writes a provider configuration that doctor cannot resolve | Medium | Medium | Reuse provider resolver rules and run offline doctor after apply |
| Prompt implementation behaves differently on Node versions | Medium | Medium | Keep a narrow injected interface and require hosted Node 18/20/22 CI |
| Stale global Diffwright still wins project scripts | Medium | High | Display resolution diagnostic and managed agent rule that stops rather than bypasses |
| Ephemeral `npx` setup leaves no local executable | High | High | Pin the running version as a local devDependency and test later npm-script resolution |
| Guardrails claim gates that the script does not run | Medium | High | Derive managed prose from the exact generated gate chain and assert both together |

## Open questions

None blocking. The requester approved the complete guided shape and authorized
autonomous implementation with delegated teammates.

## References

- shadcn CLI init: https://ui.shadcn.com/docs/cli
- Existing provider contract: `specs/byok/SPEC.md`
- Existing CLI safety contract: `specs/cli-safety-docs/SPEC.md`
- Provider setup reference: `documentation/providers.md`

## Sign-off

- [x] Author has written this spec.
- [x] Assumptions are explicit and consistent with the approved shape.
- [x] Success criteria are measurable.
- [x] Boundaries are explicit.
- [x] No blocking open questions remain.
- [x] Human approved the shape and requested complete implementation.
