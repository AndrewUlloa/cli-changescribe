# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| Earlier versions | No |

Upgrade to the latest published version before reporting or reproducing a
problem.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use
[GitHub's private vulnerability report](https://github.com/AndrewUlloa/diffwright/security/advisories/new)
so the report and follow-up remain private.

Include a clear impact statement, affected command and version, reproduction
steps, and a minimal proof of concept. Redact provider credentials, repository
contents, personal information, and unrelated secrets.

You should receive an acknowledgment through GitHub within seven days. The
maintainer will validate the report, coordinate a fix and disclosure timeline,
and credit the reporter when requested and appropriate.

## Scope notes

Diffwright handles code diffs and AI provider credentials. Relevant reports
include credential disclosure, command or argument injection, unexpected data
exfiltration, unsafe package contents, and bypasses of provider routing or
redaction controls.

Provider retention, model behavior, and gateway routing are controlled by
their respective services unless Diffwright violates its documented boundary.
