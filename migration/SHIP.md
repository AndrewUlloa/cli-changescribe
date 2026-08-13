# Launch plan: ChangeScribe compatibility bridge

> Owner: Andrew Ulloa
> Target: 2026-08-12
> Spec: `migration/SPEC.md`

## Pre-launch status

- Full repository test suite: green.
- Packed-artifact installation and legacy-command smoke test: green.
- Production dependency audit: zero vulnerabilities.
- Tarball contents and executable mode: verified.
- Review: approved with no required findings.
- Feature flag: not applicable to an npm compatibility package.

## Launch

1. Publish `cli-changescribe@0.2.2` with the `latest` tag.
2. Verify registry metadata and install the public artifact in a fresh directory.
3. Deprecate `cli-changescribe@*` with instructions to install `diffwright`.
4. Confirm deprecation metadata while ensuring `0.2.2` remains downloadable.

## Launch result

- [x] `cli-changescribe@0.2.2` published as `latest`.
- [x] Public package installed and `changescribe --help` exited successfully.
- [x] All versions deprecated with the Diffwright migration notice.
- [x] All seven historical versions remain listed and downloadable.

## Rollback

If the public bridge fails verification:

```bash
npm dist-tag add cli-changescribe@0.2.1 latest
```

Then update the deprecation message to identify the issue. Do not unpublish any
version. The bridge does not write data, modify installations, or change the
Diffwright package, so restoring the previous tag completes rollback.

## Monitoring

- Registry metadata: `npm view cli-changescribe`.
- Critical flow: clean install followed by `changescribe --help`.
- User signal: npm/GitHub issues after the migration notice appears.
