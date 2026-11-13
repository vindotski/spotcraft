#!/usr/bin/env bash
# Publishes one workspace package to npm from CI (ADR 0019, ADR 0027): `latest`, or `next` for a
# pre-release. A version already on npm is skipped, so a failed run can be re-run. With
# NODE_AUTH_TOKEN (first publish only) provenance is asked for explicitly; with trusted
# publishing (OIDC) it is automatic.
# Usage: scripts/npm-publish.sh packages/kit
set -euo pipefail
dir="$1"
name="$(jq -r .name "$dir/package.json")"
version="$(jq -r .version "$dir/package.json")"
tag=latest
case "$version" in *-*) tag=next ;; esac
if npm view "$name@$version" version > /dev/null 2>&1; then
  echo "$name@$version is already on npm; skipping"
  exit 0
fi
extra=()
[ -n "${NODE_AUTH_TOKEN:-}" ] && extra=(--provenance)
cd "$dir"
npm publish --access public --tag "$tag" "${extra[@]}"
