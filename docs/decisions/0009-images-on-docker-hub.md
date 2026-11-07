---
title: Multi-arch images on Docker Hub, built by CI
number: 9
status: accepted
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# Multi-arch images on Docker Hub, built by CI

## Context

The servers pull Spotcraft's own images (agent, dashboard) the same way they pull hosted apps.
The first deployment uses Hetzner's ARM servers; others may use x86.

## Decision

- CI publishes `<DOCKERHUB_USERNAME>/spotcraft-agent` and `spotcraft-dashboard` to Docker Hub
  for `linux/amd64` and `linux/arm64`, with provenance and an SBOM. `main` → `latest`,
  `v1.2.3` → `1.2.3`, `1.2`, `1`; every build → `sha-<short>`. A release tag must match the root
  `package.json` version.
- Pull requests build both images without pushing.
- Build stages run on the build machine's own platform (`--platform=$BUILDPLATFORM`), since
  their output is plain JavaScript; only the small final stage runs under emulation.
- Every base and third-party image is pinned by version and digest; every GitHub Action by
  commit SHA.

## Consequences

- Forks publish under their own Docker Hub user by setting `DOCKERHUB_USERNAME`.
- Updating an image means bumping its version and digest together.
