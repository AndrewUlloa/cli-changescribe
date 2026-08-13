# Plan: Provider-neutral BYOK

> Status: approved — implementation in progress
> Spec: `specs/byok/SPEC.md`

Every implementation slice follows RED → GREEN → focused test → full gate.

## 1. Runtime configuration and child-process isolation

- RED: prove cwd-local loading, shell/explicit-empty precedence, no
  `process.env` mutation, credential source tracking, and complete child-env
  stripping.
- GREEN: add the side-effect-free runtime loader and central sanitized child
  environment/runner.
- Verify the focused tests, strict typecheck, and existing suite.

## 2. Provider profiles and deterministic resolution

- RED: table-test every preset, Vercel credential precedence/OIDC behavior,
  fail-closed partial activation, legacy commit/PR model order, immutable
  public profiles, secret separation, and URL rules including `[::1]`.
- GREEN: implement the profile registry and pure resolver.
- Verify the focused tests, strict typecheck, and existing suite.

## 3. One-attempt Chat Completions transport and safe failures

- RED: use a local HTTP server to assert URL path, redirect rejection, auth,
  body fields, response parsing, token policy, no retry/failover, timeout, and
  adversarial secret redaction.
- GREEN: add the client factory, request builder/parser, typed errors, and
  allowlisted formatter.
- Verify the focused tests, strict typecheck, and existing suite.

## 4. Commit and PR integration

- RED: preserve prompts, legacy provider/model behavior, dry-run semantics,
  staged-change behavior, PR passes, and sanitized Git/GitHub/npm children.
- GREEN: route both workflows through runtime config, resolver, shared
  transport, and the central child runner; remove import-time dotenv/global
  defaults, raw errors, and helper-level exits.
- Verify workflow tests, strict typecheck, and full suite.

## 5. Offline and live diagnostics

- RED: prove offline doctor makes zero network calls, live doctor makes one
  shared-transport call, flags are validated, output is non-secret, and error
  categories are actionable.
- GREEN: add `diffwright doctor` and `doctor --live` plus CLI help/routing.
- Verify focused tests, strict typecheck, and full suite.

## 6. Documentation and independent review

- Rewrite setup around explicit profiles and direct-to-endpoint privacy.
- Document Vercel Gateway's separate authentication, downstream BYOK fallback,
  and verification limitations.
- Run correctness/readability/architecture/security/performance review and
  resolve every release blocker.

## 7. Verification and release

- Run `npm test`, `npm run typecheck`, `npm pack --dry-run`,
  `npm audit --omit=dev`, and `git diff --check`.
- Run `diffwright doctor --live` only for credentials actually available;
  unavailable integrations remain `docs-verified`.
- Dogfood Diffwright on its own staged change.
- Create a focused PR and merge after CI.
- Publish `diffwright@0.3.0`, verify a clean install, then publish
  `cli-changescribe@0.2.3` against `diffwright:^0.3.0` and verify the bridge.
