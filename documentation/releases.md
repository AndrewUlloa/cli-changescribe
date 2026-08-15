# Releasing Diffwright

Diffwright uses GitHub Releases as the source of truth for release events and
npm as the package registry. Every production release must use the same semantic
version in three places:

- `package.json`
- `package-lock.json`
- the Git tag, prefixed with `v`

For example, package version `0.5.0` is released with tag `v0.5.0`.
Pre-releases are not published by this workflow so they cannot accidentally
replace npm's `latest` tag.

## One-time npm setup

Configure `diffwright` on npmjs.com with a GitHub Actions trusted publisher:

| Setting | Value |
|---|---|
| Organization or user | `AndrewUlloa` |
| Repository | `diffwright` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | `npm publish` |

The workflow uses OpenID Connect rather than a long-lived npm token. The npm
registry automatically records provenance for the public package published by
the GitHub-hosted runner.

## Release process

1. Create a branch from `main`.
2. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` to the same
   semantic version.
3. Run the repository gates and merge the release PR into `main`.
4. From the repository's **Releases** page, draft a new release targeting
   `main`. Create the matching `vX.Y.Z` tag, generate release notes, and publish.
5. Watch the **Release** workflow. It verifies the tag and manifest versions,
   confirms the tagged commit belongs to `main`, reruns all gates, packs one
   tarball, publishes that exact tarball to npm, and attaches it to the GitHub
   Release.
6. Verify the GitHub Release and `npm view diffwright version` agree.

Do not publish from a feature branch or create the GitHub Release before the
version PR is merged. Do not reuse or move a published release tag.

## Failed releases

If validation fails, fix the version metadata in a new PR and publish a new
patch version. npm versions are immutable and must never be overwritten.

If npm publishing succeeds but the final asset upload fails, rerun only the
failed GitHub Actions job. Do not publish the same npm version again.
