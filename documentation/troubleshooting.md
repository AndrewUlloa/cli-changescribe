# Troubleshooting

Start with the offline diagnostic:

```bash
diffwright doctor
```

It prints the winning provider, model, endpoint hostname, credential variable
and source, transport, and compatibility status without contacting a provider.
Then use `diffwright doctor --live` if one real request is appropriate.

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
  passing `test` and `build` npm scripts.
- Existing PR updates do not push local commits; push them separately.

## Commit preview surprises

`commit --dry-run` calls the provider and may run `git add .` if nothing is
staged. It does not commit or push. The candidate is not saved for the later
live command, so a subsequent `commit` calls the provider again.

## Safe bug reports

Include:

- Diffwright version (`diffwright --version` is not currently supported; use
  `npm list diffwright` or `npm view diffwright version`)
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
