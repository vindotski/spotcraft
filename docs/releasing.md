# Releasing

How Spotcraft and the kit are released. What a version promises is in
[ADR 0019](decisions/0019-one-version-with-npm.md); the kit's own version is in
[ADR 0027](decisions/0027-kit-version.md).

## A kit release (only when `packages/kit` changed)

`@spotcraft/kit` has its own version and changelog (`packages/kit/CHANGELOG.md`). It is released
**before** the Spotcraft version that ships it: a Spotcraft release refuses a kit that isn't on
npm or whose source changed since its tag.

1. Set its version: `node scripts/check-versions.ts --kit 0.3.1`.
2. In `packages/kit/CHANGELOG.md`, rename `Unreleased` to the version and date. If the change
   raises `AUTH_SCHEMA_VERSION`, say which Spotcraft version it needs (the next one).
3. Merge to `main`, then tag and push: `git tag -s kit-v0.3.1 -m kit-v0.3.1 && git push origin kit-v0.3.1`.
4. CI verifies the tagged commit and publishes `@spotcraft/kit` alone (no image, no CLI).

Apps upgrade the kit only after a Spotcraft that ships it is deployed; an app that upgrades
first gets a clear error until then. Rolling Spotcraft back past a schema change blocks apps with
a database from deploying until it's upgraded again.

## A Spotcraft release

1. Set the version everywhere but the kit: `node scripts/check-versions.ts 0.2.0`.
2. In `CHANGELOG.md`, rename `Unreleased` to the version and date, and add its compare link.
3. Merge to `main`, then tag and push: `git tag -s v0.2.0 -m v0.2.0 && git push origin v0.2.0`.
4. CI verifies the tagged commit, then publishes:
   - the `spotcraft` image, tagged `0.2.0` and `0.2`;
   - `spotcraft` (the CLI) on npm (`latest`, or `next` for a pre-release), with provenance,
     pinned to the kit's exact version. A version already on npm is skipped, so a failed run
     can be re-run.

   Before anything is published, it checks that the kit in the release is on npm and unchanged
   since its `kit-v` tag.
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
