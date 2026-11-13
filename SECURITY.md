# Security policy

## Supported versions

Spotcraft is pre-1.0. Security fixes go into the latest minor release only; upgrade to it
to receive them.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability**
on this repository. Don't open a public issue for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get
an answer within a week. Once a fix is released, the advisory is published with credit to you
unless you'd rather stay anonymous.

## Scope

In scope: the agent, the dashboard, the deploy workflow and script, the compose files, the
first-boot setup and the OpenTofu module in this repository, and the published
`spotcraft` image (the agent and the dashboard).

Out of scope: the apps you host with Spotcraft, and vulnerabilities in third-party images
(Caddy, VictoriaMetrics, cAdvisor and others) unless Spotcraft's configuration makes them
exploitable. Report those upstream.

How Spotcraft is meant to be secured, and the risks it accepts, are described in
[docs/security.md](docs/security.md).
