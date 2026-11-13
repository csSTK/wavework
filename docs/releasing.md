# Releasing wavework

Releases are published to npm by `.github/workflows/publish.yml` when a `v*` tag is pushed. Version 0.1.0 is the exception: it was published by hand before the workflow could be used (see below). The workflow authenticates with npm trusted publishing: GitHub Actions gives the job an OIDC token (`id-token: write`) and npm accepts it in place of a token. No npm token is stored in this repository or in GitHub secrets, so there is nothing to rotate.

Requirements, from the npm documentation (checked for version 0.1.0):

- Trusted publishing needs npm CLI 11.5.1 or later and Node 22.14.0 or later ([docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers)). The workflow installs npm 11.21.1 (pinned) on Node 24.
- Trusted publishing supports only cloud-hosted runners (self-hosted runners are not supported), and `id-token: write` must be granted.
- Provenance attestations are generated automatically for trusted publishing, without `--provenance` ([docs.npmjs.com/generating-provenance-statements](https://docs.npmjs.com/generating-provenance-statements)). The repository must be public and `package.json` `repository` must match it case-sensitively (`git+https://github.com/csSTK/wavework.git`).

## One-time setup on npmjs.com

1. Sign in to npmjs.com as an owner of the `wavework` package.
2. Open the package's settings and find the trusted publisher section. Choose GitHub Actions and enter exactly:
   - Organization or user: `csSTK`
   - Repository: `wavework`
   - Workflow filename: `publish.yml` (filename only, no path)
   - Environment name: leave empty (the workflow uses no GitHub environment)
   - Allowed actions (optional): the docs say "`npm stage publish` is always allowed. Choose whether this trusted publisher can also publish directly with `npm publish`". Explicitly enable direct `npm publish`, because the workflow publishes with `npm publish --access public`.
3. Save. "npm does not verify your trusted publisher configuration when you save it." The first successful publish validates it and binds it to the repository's identity. A new trusted publisher must complete that first publish within 2 days, or the configuration expires and must be deleted and created again.

**First publish (0.1.0, done).** A trusted publisher can only be added to a package that already exists on npm, and the npm account had no packages, so the settings were not available before the first release. Version 0.1.0 was therefore published manually by the maintainer, without provenance. Now that the package exists, the trusted publisher is added under its settings, as in the setup above. From 0.1.1 on, releases go through `publish.yml` with provenance. No npm token was added to the repository for the first release.

## Version 0.1.0 and the `v0.1.0` tag

`wavework@0.1.0` is already on npm, published manually. The `v0.1.0` tag is a marker for that release. Pushing it runs `publish.yml`, and the workflow then checks the registry with `npm view wavework@0.1.0 version`: when the version exists it skips the publish step and prints a notice (`wavework@0.1.0 already on npm, publish skipped`), so the job stays green. The same applies to any tag whose version is already published. A 404 from the registry means "not published yet" and the publish runs; any other npm error fails the job without publishing.

## Per release

1. Decide the version (semantic versioning). Update `version` in `package.json`.
2. In `CHANGELOG.md`, move the entries from `## [Unreleased]` into `## [<version>] - <YYYY-MM-DD>`, keep an empty `## [Unreleased]` above it, and update the link references at the bottom.
3. Run `npm test` and `bash scripts/smoke.sh` locally, and `npm publish --dry-run` to check the package contents.
4. Commit the version and changelog change and push `main`.
5. Wait until CI is green for that commit (`.github/workflows/ci.yml`).
6. Tag the commit and push the tag:

   ```bash
   git tag v<version>
   git push origin v<version>
   ```

7. Watch `publish.yml` for the tag. The job fails before publishing if the tag does not equal `v` plus the `package.json` version. It skips the publish when that version is already on npm, and otherwise runs `npm test` and the smoke run before `npm publish --access public`.
8. Verify the release:

   ```bash
   npm view wavework version
   ```

   In a scratch directory, install the new version and check its provenance:

   ```bash
   npm i wavework@<version>
   npm audit signatures
   ```

A published version cannot be replaced on npm. If a release is wrong, publish a new version.

## Troubleshooting

- **The Publish step fails although the trusted publisher is set up.** Usually the "Allowed actions" option for direct `npm publish` is off on npmjs.com. Enable it in the package's trusted publisher settings and re-run the publish (`gh run rerun <id>`). Check the other fields too: owner `csSTK`, repository `wavework`, workflow filename `publish.yml`, environment empty.
- **The tag guard fails.** The tag and `package.json` `version` differ. Delete the tag only if it was never published (`git push origin :refs/tags/v<version>` and `git tag -d v<version>`, with the user's OK), fix the version, and tag again.
- **The publisher expired** (no publish within 2 days of creating it). Delete it on npmjs.com, create it again with the same fields, and publish.
