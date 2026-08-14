# Troubleshooting

Start with the offline diagnostic:

```bash
diffwright doctor
```

It prints the winning provider, model, endpoint hostname, credential variable
and source, transport, and compatibility status without contacting a provider.
Then use `diffwright doctor --live` if one real request is appropriate.

## Init setup

### The wizard did not appear

Guided init requires both stdin and stdout to be an interactive TTY. A
no-argument non-TTY invocation intentionally uses the legacy script-only path.
`--yes` and the provider/model/base/agents/credential-source options are also
deterministic and never prompt.

Use `npx diffwright@latest init` in a terminal for the walkthrough. Use
`--dry-run` when you want the same redacted plan without an install, write, or
live provider request. Declining the final confirmation or pressing Ctrl-C
before it produces no writes or provider calls.

### Local installation failed

Guided setup installs the exact running Diffwright version with the detected
package manager and disables install lifecycle scripts. If installation fails,
Diffwright reports that phase separately and never falls back to a global
executable. Check the package-manager/registry error and any `package.json` or
lockfile change left by the package manager, then rerun
`npx diffwright@latest init`; setup transforms are idempotent.

Conflicting lockfiles or a `packageManager` declaration that disagrees with the
lockfile must be resolved before retrying. For a local pin check, use the
manager's dependency listing command, such as `npm list diffwright --depth=0`.
Diffwright's own validated checkout is different: it does not install itself;
its managed scripts build and run `node ./bin/diffwright.js`.

### Setup applied but doctor failed

An offline doctor failure happens after apply, so the setup files remain. Fix
the provider, exact model, credential source, or shell-over-file conflict, then
run `diffwright doctor`. Re-running init is also safe when you need to change
the planned configuration. Init exits nonzero so automation does not mistake
the failed validation for complete setup.

If live validation fails, the configuration files remain in place. The single
opted-in provider request failed; use its diagnostic category below, correct the
provider/account/network issue, and retry `diffwright doctor --live` only when
another billed request is appropriate.

### Agent rules or scripts were not replaced

The wizard preserves custom package scripts and all text outside its managed,
marker-delimited `CLAUDE.md`/`AGENTS.md` blocks. A custom name collision may use
a printed `diffwright:*` fallback. Malformed or duplicate managed markers and
unsafe file targets stop setup for manual repair instead of overwriting content.

## Provider diagnostic categories

| Category | Likely cause | What to check |
|---|---|---|
| `request_incompatible` | HTTP 400; unsupported field or incompatible request shape | Exact model, provider Chat Completions support, and endpoint version |
| `authentication` | HTTP 401/403 | Correct provider key, account/project access, expiration, and shell-over-file precedence |
| `payment_required` | HTTP 402 | Provider or gateway credit balance and billing status |
| `not_found` | HTTP 404 | Exact model ID, base URL, model availability, and region |
| `rate_limit` | HTTP 429 | Account quota, rate limit, concurrency, and retry timing |
| `timeout` | HTTP 408 or request timeout | Provider status, model latency, and local connectivity |
| `dns` | DNS lookup failed | Endpoint spelling, DNS, VPN, and network policy |
| `tls` | Certificate or TLS negotiation failed | System clock, proxy certificates, and endpoint certificate chain |
| `incompatible_response` | Authenticated response did not contain usable completion text | Model/API compatibility and gateway transforms |
| `provider_error` | HTTP 5xx | Provider status and request ID; retry later manually |
| `connection` | Other connection failure | Proxy, firewall, VPN, endpoint reachability, and local server state |

Diffwright disables SDK retries and never fails over to a second provider.
Gateways can have their own downstream routing or retry policy.

## Configuration does not resolve as expected

- Run doctor from the same directory as the failing command; `.env.local` is
  loaded from the current working directory.
- Shell variables override `.env.local`, even when the shell value is empty.
- If init will store a credential, `.env.local` must be untracked and ignored by
  Git. Never work around that check by passing a key on the command line.
- Explicit `DIFFWRIGHT_PROVIDER` ignores unrelated provider keys.
- Use the exact model identifier from the provider, including namespace.
- For Vercel OIDC, explicitly set `DIFFWRIGHT_PROVIDER=vercel`.

## PR range or output problems

- PR dry-run and generation try to fetch `origin/<base>`, then fall back to
  local refs. Check the warning to see which ref was used.
- Confirm the base is a real Git branch and the current branch has commits not
  present on it.
- `--out` is the detailed file. The sibling `.final.md` file contains the slim
  GitHub-ready block, and a temporary backup path is printed.
- `--create-pr` requires `gh auth status` to succeed and the project to provide
  passing `test` and `build` scripts for its detected package manager.
- Existing PR updates do not push local commits; push them separately.

## Commit preview surprises

`commit --dry-run` calls the provider and may run `git add .` if nothing is
staged. It does not commit or push. The candidate is not saved for the later
live command, so a subsequent `commit` calls the provider again.

## Safe bug reports

Include:

- Diffwright version (`diffwright --version` or `diffwright -v`)
- Node version (`node --version`) and operating system
- Command name with secrets and private paths removed
- Provider ID, model ID, endpoint hostname, diagnostic category, HTTP status,
  and request ID when present
- Minimal reproduction and whether offline doctor succeeds

Never include an API key, Authorization header, `.env.local`, full provider
response, or proprietary diff. Diffwright redacts known provider values, but
you should still inspect output before posting it.

Use [GitHub issues](https://github.com/AndrewUlloa/diffwright/issues) for bugs.
Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/AndrewUlloa/diffwright/security/advisories/new).
