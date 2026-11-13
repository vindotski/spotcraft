---
title: One image runs the agent and the dashboard as two containers
number: 25
status: accepted
implementation: done
date: 2026-11-13
supersedes: [9]
superseded_by: []
notes: "Partly supersedes ADR 0009: which images are published. Its build, tag, platform and pinning rules stand. Built: root Dockerfile, one CI build and scan, Compose picks the program per service."
---

# One image runs the agent and the dashboard as two containers

## Context

ADR 0009 publishes two images, `spotcraft-agent` and `spotcraft-dashboard`, from two
Dockerfiles that share the same Node build stage and distroless base. Each release builds,
scans and pushes both, and a deploy checks and pulls both. They always carry the same version.

Running both programs in one process would be simpler still, but the agent holds the Docker
socket, which is root on the host, and the dashboard faces the internet. A bug in the dashboard
must not reach the socket.

## Decision

- **One image, `<DOCKERHUB_USERNAME>/spotcraft`**, built from the root `Dockerfile`: the agent
  in `/app/agent` (its TypeScript and production `node_modules`, plus the Docker CLI and Compose
  plugin) and the dashboard in `/app/dashboard` (its bundled `build/`). Distroless Node, uid
  1000, no default command.
- **Two containers, as before.** Compose chooses the program with `working_dir` and `command`,
  and sets each one's own settings (ports, proxy headers, paths) and health check. Only the
  agent's container mounts the Docker socket and joins the database network.
- Tags, platforms, provenance, SBOM, the vulnerability scan and pinning follow ADR 0009,
  for the one image.
- `spotcraft-agent` and `spotcraft-dashboard` are no longer published.

## Consequences

- One build, one scan, one pull per release; "Spotcraft X.Y.Z" is one artifact.
- The dashboard's container carries the agent's code and the Docker CLI, unused: without the
  socket they can't do anything.
- Breaking for operators: the compose files and the deploy use the new image name
  (`SPOTCRAFT_IMAGE`). Forks publish `<user>/spotcraft`.
