# Spec: Evidence-Backed Generation v2

> Filed by: Codex agent session
> Status: approved
> Last updated: 2026-08-14

## One-line Summary

Rebuild Diffwright's commit and pull-request generation around complete change
evidence, explicitly supplied intent, deterministic artifact rendering, and
factual validation.

## Objective

**What are we building?**

An evidence-to-artifact pipeline for commits and pull requests. Diffwright will
collect authoritative Git evidence and observed gate results, normalize them
into structured records, let the configured model propose evidence-linked
claims, and render validated Conventional Commit and pull-request artifacts.

**Why are we building it?**

The current commit template requires formulaic `change / why / risk` prose, and
the current PR pipeline summarizes truncated per-commit summaries instead of
the final branch change. These designs can turn partial evidence or plausible
inference into confident historical claims. Better prompt wording cannot make
missing evidence true.

**Who is it for?**

Developers and reviewers who use Diffwright to create durable Git history and
review-ready pull requests without surrendering factual accuracy or repository
conventions.

**What does success look like?**

Diffwright describes the complete relevant change, distinguishes evidence from
intent and inference, reports only observed verification, preserves valid
Conventional Commit history through squash merges, and omits unsupported
boilerplate. Existing provider, credential-redaction, subprocess-safety,
guided-init, ChangeScribe bridge, and package-distribution contracts remain
green.

## Assumptions

- [x] The research synthesis supplied by Andrew is the approved product
  direction for this implementation.
- [x] Conventional Commits remains the default grammar, while repository
  policy can expand types and permit scopes.
- [x] The staged diff is authoritative for a commit; the final
  `merge-base...HEAD` diff is authoritative for a PR.
- [x] Style rules from Google, Chris Beams, Tim Pope, and ASD-STE100 are
  editorial guidance, not claims of formal compliance.
- [x] Source integrations remain adapter concerns. The core accepts generic
  context rather than depending on a particular issue tracker or agent.
- [x] Interactive review is safe by default; automation can use an explicit
  noninteractive confirmation flag.

## Success Criteria

| # | Criterion | How we measure | Target |
|---|---|---|---|
| 1 | Generated material claims have recognized support | Structured claim validation | Every material claim references known evidence or supplied intent |
| 2 | PR evidence represents the final branch change | Git integration fixtures | Additions, modifications, deletions, renames, and reverted intermediate work are handled from `merge-base...HEAD` |
| 3 | Verification claims are observed | Gate-receipt tests | A command appears as passed only after a captured zero exit status |
| 4 | Commit grammar is useful and configurable | Commit contract matrix | Standard types, optional valid scopes, breaking markers, and extensible trailers parse and render deterministically |
| 5 | Commit history stays scan-friendly | Validator tests | Target 50 characters; configurable hard maximum defaults to 72 |
| 6 | Commit prose is adaptive | Golden fixtures | Simple changes may be subject-only; no forced `change / why / risk` or `(not provided)` content |
| 7 | Staging is intentional | CLI integration tests | `diffwright commit` analyzes only staged work; `--all` is required to stage all changes |
| 8 | Squash titles preserve policy | PR-title tests | Generated PR titles pass the same Conventional Commit header validator |
| 9 | Human review precedes GitHub mutation | TTY/headless orchestration tests | Interactive create/update asks for confirmation; headless mutation requires `--yes` |
| 10 | Incomplete evidence is honest | Large-diff and failure fixtures | No silent truncation; generation chunks complete bounded evidence or stops with a clear limitation |
| 11 | Style remains subordinate to truth | Style-validator tests | Plain-language checks warn; factual/schema violations fail |
| 12 | Existing supported workflows remain safe | Full repository and packed-package gates | Node 18/20/22-compatible build, tests, distribution, init, and ChangeScribe behavior stay green |

## Non-Goals

- Not in scope: formal ASD-STE100 conformance or its controlled dictionary.
- Not in scope: detecting whether prose was written by AI.
- Not in scope: automatically splitting or staging individual hunks.
- Not in scope: first-party Linear, Gmail, Granola, Vercel, or project-manager integrations.
- Not in scope: proving arbitrary natural-language truth beyond traceable
  evidence, supplied intent, and deterministic checks.
- Not in scope: replacing line-by-line human code review.

## Users and User Stories

- As a developer, I want a short factual commit so future maintainers can
  understand the durable context without reading formulaic filler.
- As a developer, I want to supply intent without coupling Diffwright to my
  task-management system.
- As a reviewer, I want a PR description based on the final branch state so I
  do not review intermediate or reverted implementation history.
- As a reviewer, I want exact test receipts so I can distinguish tests changed
  from tests executed.
- As a maintainer, I want repository-configured commit types, scopes, and PR
  templates without weakening factual validation.
- As an automation author, I want explicit headless flags and stable structured
  behavior rather than interactive surprises.

## Tech Stack

- Language: TypeScript 5.9, strict mode
- Runtime: Node.js 18, 20, and 22; CommonJS package output
- Tests: compiled `node:test`
- Provider transport: existing OpenAI-compatible HTTP transport and provider
  resolution
- Git/GitHub execution: existing no-shell subprocess runner
- Dependencies: no new runtime dependency unless a later task proves one is
  necessary and receives separate approval

## Commands

```bash
# Build and test
npm run typecheck
npm test

# Distribution and security gates
npm pack --dry-run
npm audit --omit=dev
git diff --check

# Dogfooded workflow
npm run commit
npm run feature:pr
```

## Project Structure

```text
src/change-evidence.ts  -> source-agnostic evidence, claim, and artifact types
src/commit.ts           -> staged-change collection and commit orchestration
src/pr-summary.ts       -> final-branch evidence and PR orchestration
src/arguments.ts        -> explicit mutation/context/review options
test/                   -> contract, integration, security, and distribution tests
specs/evidence-backed-generation-v2/ -> lifecycle artifacts
```

## Code Style

```ts
export interface EvidenceRecord {
  id: string;
  kind: 'change' | 'intent' | 'verification' | 'constraint';
  source: string;
  content: string;
}

export interface SupportedClaim {
  statement: string;
  evidenceIds: readonly string[];
}
```

### Evidence-to-artifact example

The runtime uses the richer discriminated types in `src/change-evidence.ts`,
but the following compact example shows the trust boundary end to end:

```json
{
  "evidence": [
    {
      "id": "change-parser",
      "kind": "change",
      "basis": "observed",
      "source": { "kind": "git-index", "locator": "src/parser.ts" },
      "payload": {
        "status": "modified",
        "path": "src/parser.ts",
        "additions": 3,
        "deletions": 1,
        "binary": false,
        "patch": "+if (token.length === 0) throw new Error('Empty token');"
      }
    },
    {
      "id": "intent-empty-input",
      "kind": "intent",
      "basis": "provided",
      "source": { "kind": "context-file", "locator": "intent.md" },
      "payload": { "text": "Reject empty parser tokens." }
    },
    {
      "id": "verification-test",
      "kind": "verification",
      "basis": "observed",
      "source": { "kind": "gate", "locator": "npm test" },
      "payload": { "receiptId": "receipt-test" }
    }
  ],
  "receipt": {
    "id": "receipt-test",
    "command": {
      "file": "npm",
      "args": ["test"],
      "display": "npm test"
    },
    "status": "passed",
    "exitCode": 0,
    "durationMs": 412,
    "source": "diffwright"
  },
  "validatedClaims": [
    {
      "id": "claim-change",
      "kind": "change",
      "text": "Reject empty parser tokens",
      "evidenceIds": ["change-parser"],
      "basis": "observed",
      "significance": "primary"
    },
    {
      "id": "claim-rationale",
      "kind": "rationale",
      "text": "Match the supplied empty-input behavior",
      "evidenceIds": ["intent-empty-input"],
      "basis": "provided",
      "significance": "supporting"
    },
    {
      "id": "claim-verification",
      "kind": "verification",
      "text": "npm test passed",
      "evidenceIds": ["verification-test"],
      "basis": "observed",
      "significance": "supporting"
    }
  ],
  "renderedTitle": "fix(parser): reject empty parser tokens"
}
```

By contrast, a verification claim such as `npm test passed` that cites only
`change-parser` is rejected: editing a test or production file is not evidence
that a command ran successfully. Only `verification-test`, backed by the
zero-exit `receipt-test`, can support that statement.

Key conventions:

- External data is untrusted until parsed and bounded.
- Git and package commands use executable-plus-argv calls, never shell strings.
- Models propose structured data; deterministic code owns grammar and output.
- Optional information is omitted rather than replaced with filler.
- Existing secrets remain redacted from prompts, logs, errors, and children.

## Testing Strategy

- Unit tests cover parsers, renderers, evidence IDs, style warnings, and title
  policy.
- Integration tests create real temporary Git repositories for staged-only
  behavior, net diffs, deletions, renames, reverts, and mixed history.
- Workflow tests inject provider completions and subprocess receipts.
- Distribution tests confirm every new compiled module ships through the packed
  Diffwright and ChangeScribe bridge.
- Golden fixtures cover representative commits and PRs; blind human review is
  recorded separately from deterministic CI assertions.

## Boundaries

**Always do:**

- Build a complete bounded evidence plan before generation.
- Keep evidence, supplied intent, verification, and inference distinct.
- Require recognized evidence IDs for every generated material claim.
- Use the staged diff for commits and `merge-base...HEAD` for PRs.
- Include deleted and renamed paths in branch evidence.
- Capture command, exit status, and package manager for verification receipts.
- Revalidate edited or repaired output before mutation.
- Preserve provider redaction and no-shell subprocess execution.
- Keep noninteractive mutation explicit.
- Leave the tree green after every committed slice.

**Ask first:**

- Add a runtime dependency.
- Change provider request or credential semantics.
- Introduce a network source beyond the configured model and existing GitHub
  mutation.
- Change the public default away from Conventional Commits.
- Automatically manipulate individual Git hunks or rewrite user commits.

**Never do:**

- Infer unprovided motivation, test success, risk, rollout, or guarantees and
  present it as fact.
- Silently truncate evidence while claiming full coverage.
- Stage all changes without the explicit `--all` contract.
- Put intent or secrets into generated files, subprocess argv, logs, or errors
  without the user's explicit input and existing redaction protections.
- Use the same model output as the sole judge of its own factual correctness.
- Make every optional section or commit body mandatory.
- Import Founder Update's audience, connectors, cadence, or voice into the core.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Models attach a plausible claim to an unrelated evidence ID | Medium | High | Structured critic sees original evidence; deterministic existence checks; adversarial corpus; human preview |
| Complete diffs exceed one model request | High | High | File-aware chunking, explicit coverage accounting, deterministic merge, fail closed when limits are exceeded |
| New staged-only default breaks one-command project scripts | High | Medium | Add explicit `--all` to generated/dogfooded scripts and migration tests |
| PR preview blocks automation | Medium | Medium | Require `--yes` only for noninteractive GitHub mutation and migrate generated scripts |
| Conventional title limits reject precise repository terms | Medium | Low | Configurable hard maximum with a documented 72-character default |
| Context files expose sensitive information | Medium | High | Fixed size limits, regular-file checks, redaction, local-only reads, no output echo |
| Large refactor regresses packaging or ChangeScribe | Medium | High | Thin commits, module inventory updates, packed-package tests after each slice |

## Open Questions

No blocking product questions remain. The following are explicitly deferred and
must not expand this implementation:

- Whether evidence adapters become a public plugin API.
- Whether issue text is fetched automatically in a future release.
- Whether review metrics are reported through an opt-in quality dashboard.

## References

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Google Engineering Practices](https://google.github.io/eng-practices/)
- [Google developer documentation style guide](https://developers.google.com/style)
- [Chris Beams: How to Write a Git Commit Message](https://cbea.ms/git-commit/)
- [Tim Pope: A Note About Git Commit Messages](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html)
- [ASD-STE100](https://www.asd-ste100.org/)

## Sign-off

- [x] Author has written this spec
- [x] Assumptions confirmed through the approved research discussion
- [x] Success criteria are measurable
- [x] Boundaries agreed
- [x] Open questions resolved or explicitly deferred
- [x] Human reviewed and approved through “work on doing it all”
