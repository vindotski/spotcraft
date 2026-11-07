---
title: One pnpm monorepo: SvelteKit and Fastify
number: 5
status: accepted
implementation: skeleton
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# One pnpm monorepo: SvelteKit and Fastify

## Context

The dashboard, the website, the agent and the infrastructure change together.

## Decision

- One pnpm workspace: `apps/dashboard`, `apps/site`, `agent`, `infra/`, `docs/`.
- **SvelteKit** (adapter-node) for the dashboard and the website.
- **Fastify** for any HTTP API, starting with the agent.
- TypeScript throughout, run directly by Node where there is no build step; Biome for
  lint and format; Node 24 or newer.

## Consequences

- One CI workflow verifies everything.
- Hosted apps are only Docker images; Spotcraft never builds them.
