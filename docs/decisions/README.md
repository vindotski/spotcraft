# Decisions

Architecture decision records, numbered in order. A changed decision gets a new record
that supersedes the old one; old records are never rewritten.

| #    | Decision                                                                                   | Status                                       |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 0001 | [Apps and ops on two servers](0001-two-servers.md)                                         | superseded by 0026                           |
| 0002 | [A small agent deploys apps](0002-agent-control-path.md)                                   | accepted                                     |
| 0003 | [VictoriaMetrics and VictoriaLogs](0003-victoria-monitoring.md)                            | accepted                                     |
| 0004 | [Generic VPS bootstrap, optional Hetzner](0004-provisioning.md)                            | accepted, partly superseded by 0026          |
| 0005 | [One pnpm monorepo: SvelteKit and Fastify](0005-repo-and-stack.md)                         | accepted                                     |
| 0006 | [Shared UI package with shadcn-svelte](0006-shared-ui.md)                                  | accepted                                     |
| 0007 | [App state lives on the apps server; agent API](0007-app-state-on-apps-server.md)          | accepted                                     |
| 0008 | [Dashboard login with one admin password](0008-dashboard-login.md)                         | accepted, partly superseded by 0023          |
| 0009 | [Multi-arch images on Docker Hub, built by CI](0009-images-on-docker-hub.md)               | accepted, partly superseded by 0025          |
| 0010 | [Hetzner ARM servers, deploy user only, one first-boot template](0010-hetzner-servers.md)  | accepted, partly superseded by 0026          |
| 0011 | [Spotcraft deploys itself with a manual GitHub workflow over SSH](0011-deploy-workflow.md) | accepted, partly superseded by 0026          |
| 0012 | [Hardening from the v0.1.0 audit](0012-hardening-before-v0-1.md)                           | accepted                                     |
| 0013 | [One Semantic Version for the whole project](0013-one-version.md)                          | superseded by 0019                           |
| 0014 | [The website is static and hosted on Spotcraft itself](0014-website.md)                    | accepted, partly superseded by 0024          |
| 0015 | [One Postgres on the apps server, a database per app](0015-shared-postgres.md)             | accepted                                     |
| 0016 | [A server-only backend kit, starting with guest accounts](0016-backend-kit.md)             | accepted                                     |
| 0017 | [A local stack that matches the server](0017-local-stack.md)                               | accepted                                     |
| 0018 | [The dashboard lists and deletes an app's users](0018-user-management.md)                  | accepted                                     |
| 0019 | [One version for the project, including its npm packages](0019-one-version-with-npm.md)    | accepted, partly superseded by 0027          |
| 0021 | [Apps get a default subdomain; Cloudflare can sit in front](0021-cloudflare-edge.md)       | accepted, partly superseded by 0022 and 0023 |
| 0022 | [Taking over a custom domain's DNS records is an app setting](0022-takeover-setting.md)    | accepted                                     |
| 0023 | [A Cloudflare Access sign-in also signs in to the dashboard](0023-access-sign-in.md)       | accepted                                     |
| 0024 | [The website is plain Astro, published on GitHub Pages](0024-website-on-pages.md)          | accepted                                     |
| 0025 | [One image runs the agent and the dashboard as two containers](0025-one-image.md)          | accepted                                     |
| 0026 | [Spotcraft runs on one server](0026-one-server.md)                                         | accepted                                     |
| 0027 | [The kit has its own version](0027-kit-version.md)                                         | accepted                                     |
| 0028 | [Deploys start the new version next to the old one](0028-zero-downtime-deploys.md)         | accepted                                     |
| 0029 | [An app's CI deploys a new tag through a deploy hook](0029-deploy-hook.md)                 | accepted                                     |
