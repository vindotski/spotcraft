# Decisions

Architecture decision records, numbered in order. A changed decision gets a new record
that supersedes the old one; old records are never rewritten.

| #    | Decision                                                                                   | Status   |
| ---- | ------------------------------------------------------------------------------------------ | -------- |
| 0001 | [Apps and ops on two servers](0001-two-servers.md)                                         | accepted |
| 0002 | [A small agent deploys apps](0002-agent-control-path.md)                                   | accepted |
| 0003 | [VictoriaMetrics and VictoriaLogs](0003-victoria-monitoring.md)                            | accepted |
| 0004 | [Generic VPS bootstrap, optional Hetzner](0004-provisioning.md)                            | accepted |
| 0005 | [One pnpm monorepo: SvelteKit and Fastify](0005-repo-and-stack.md)                         | accepted |
| 0006 | [Shared UI package with shadcn-svelte](0006-shared-ui.md)                                  | accepted |
| 0007 | [App state lives on the apps server; agent API](0007-app-state-on-apps-server.md)          | accepted |
| 0008 | [Dashboard login with one admin password](0008-dashboard-login.md)                         | accepted |
| 0009 | [Multi-arch images on Docker Hub, built by CI](0009-images-on-docker-hub.md)               | accepted |
| 0010 | [Hetzner ARM servers, deploy user only, one first-boot template](0010-hetzner-servers.md)  | accepted |
| 0011 | [Spotcraft deploys itself with a manual GitHub workflow over SSH](0011-deploy-workflow.md) | accepted |
| 0012 | [Hardening from the v0.1.0 audit](0012-hardening-before-v0-1.md)                           | accepted |
