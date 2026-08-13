# Review: Provider-neutral BYOK

> Status: approved for release
> Reviewed: 2026-08-13
> Spec: `specs/byok/SPEC.md`

## Outcome

The implementation satisfies the approved direct-to-endpoint, one-profile,
Chat Completions contract. Independent architecture, provider-contract, and
TDD/acceptance reviews found no remaining implementation or local-test
blockers after the findings below were resolved.

## TDD evidence

The implementation was developed in vertical RED → GREEN slices. Observed
failing tests included:

- Runtime/resolver: 20 expected failures before the modules existed, then
  47 passing tests.
- Transport/error handling: missing transport and error modules, then 55
  passing tests.
- Subprocess isolation: missing central runner and architecture guard, then
  57 passing tests.
- Workflow migration: legacy request fields failed shared-transport
  assertions, then 59 passing tests.
- Doctor: missing command and CLI route, then 62 passing tests.
- Final hardening: five focused failures proved incorrect implicit Vercel
  model fallback, misleading loopback diagnostics, unsafe direct module entry
  points, and selected/ambient credentials in commit and PR prompts; the same
  focused command then passed 36/36.
- Output hardening: two focused failures proved a provider could echo a known
  credential into commit output or PR files; the same command then passed 2/2.

These are the actual observed failures and passing reruns from this work, not
tests inferred after implementation.

## Quality review

### Correctness

- Every first-class provider profile, deterministic precedence rule, legacy
  model fallback, Vercel credential rule, URL constraint, and token field is
  covered by table or integration tests.
- Commit, PR, and doctor use the same resolver, request builder, OpenAI client
  factory, response parser, and typed error path.
- Real local HTTP tests prove the final URL path, authorization behavior,
  minimal custom payload, no redirects, no SDK retry, timeouts, and parsing.

### Readability

- Runtime loading, provider resolution, transport, diagnostics, errors, and
  subprocess isolation are separate modules with narrow responsibilities.
- Provider and credential metadata are explicit rather than inferred from
  model names.

### Architecture

- The CLI calls the resolved endpoint directly; Diffwright has no hosted
  proxy, key store, fallback router, or billing layer.
- Public profile metadata and private credential values are separate and
  frozen. Only the transport client factory consumes the credential value.
- `src/cli.ts` is the sole command boundary. Internal modules cannot bypass
  the safe error formatter through direct execution.

### Security

- `.env.local` is parsed without mutating global process state.
- Provider credentials are stripped from both exec and spawn child
  environments.
- Known credential values are redacted from outbound prompt bodies, model
  responses, CLI output, generated files, and allowlisted errors.
- Custom remote endpoints require HTTPS and a key; keyless HTTP is limited to
  normalized loopback hosts. Redirects are rejected.
- Shell interpolation remains eliminated for Git refs and filenames.

### Performance

- Resolution and redaction are local linear passes over small configuration
  maps and bounded prompt/response text.
- The network remains the dominant cost. SDK retries are disabled and no
  provider-probing or discovery request is added to normal commands.

## Findings resolved

- Prevented ambient Vercel OIDC and legacy model variables from activating or
  completing implicit Vercel configuration.
- Removed an undocumented hard-coded Google client header.
- Updated OpenRouter to its current `max_completion_tokens` field.
- Corrected keyless loopback validation and IPv6 URL handling.
- Removed unsafe direct internal-module entry points.
- Added prompt-side and response-side credential redaction.
- Added CLI error, keyless wire auth, spawn isolation, URL, and legacy
  `.env.local` acceptance coverage.

## Verification limitation

No supported provider credentials or running local model were available in
the maintainer environment during review. Accordingly, no profile is labeled
`live-verified`; provider claims remain `docs-verified`, `experimental`, or
`user-defined` as specified. Local wire tests validate Diffwright's complete
request/response path without claiming a third-party service was contacted.

## Final local gate

- Strict application and test TypeScript typecheck: passed.
- Full suite: 73/73 passed, including packed Diffwright and ChangeScribe
  install/execute E2E.
- `diffwright@0.3.0` dry-run tarball: 24 expected files, 62.3 kB packed.
- Production dependency audit: zero vulnerabilities.
- Whitespace/error check: passed.
- Dogfood: the staged feature branch completed Diffwright's own PR dry-run
  with an explicit keyless loopback profile and made no model request.
