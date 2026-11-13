# Releasing

How a Spotcraft version is released. What a version promises is in
[ADR 0019](decisions/0019-one-version-with-npm.md).

## Every release

1. Set the version everywhere: `node scripts/check-versions.ts 0.2.0`.
2. In `CHANGELOG.md`, rename `Unreleased` to the version and date, and add its compare link.
3. Merge to `main`, then tag and push: `git tag -s v0.2.0 -m v0.2.0 && git push origin v0.2.0`.
4. CI verifies the tagged commit, then publishes:
   - the `spotcraft` image, tagged `0.2.0` and `0.2`;
   - `@spotcraft/kit` and `spotcraft` on npm (`latest`, or `next` for a pre-release), with
     provenance. A version already on npm is skipped, so a failed run can be re-run.
5. Deploy it with the Deploy workflow.

An npm version can't be replaced: fix a broken one with a new patch release and deprecate the
broken one (`npm deprecate spotcraft@0.2.0 "Use 0.2.1"`).

## One-time npm setup

Only the original repository (`vindotski/spotcraft`) publishes to npm; CI skips the step
in forks.

1. On npmjs.com, create the free organization `spotcraft` (it owns `@spotcraft/kit`).
2. **First release only:**
   - create a granular access token that can publish packages (expiry: a few days);
   - store it as the secret `NPM_TOKEN` in a GitHub environment named `npm`;
   - release as above. The first versions are published with that token and `--provenance`.
3. On npmjs.com, link a **trusted publisher** in the settings of each package (`@spotcraft/kit`
   and `spotcraft`). The fields are case-sensitive:
   - provider: GitHub Actions;
   - organization or user: `vindotski`, repository: `spotcraft`;
   - workflow filename: `ci.yml`, environment: `npm`;
   - allow `npm publish` (newer links only allow `npm stage publish` unless ticked).
4. Delete the `NPM_TOKEN` secret and revoke the token. From then on CI publishes through
   GitHub's OIDC token, with no stored secret.
