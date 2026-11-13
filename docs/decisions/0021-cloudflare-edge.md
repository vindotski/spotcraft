---
title: Apps get a default subdomain; Cloudflare can sit in front
number: 21
status: accepted
implementation: done
date: 2026-11-13
supersedes: []
superseded_by: []
notes: "Built: default subdomains, client-address handling, the infra/cloudflare module, the Hetzner edge switch, tunnel mode on both servers, custom domains through the API and per-app Access. Protected apps are probed only up to the Access sign-in."
---

# Apps get a default subdomain; Cloudflare can sit in front

## Context

Every app needs a domain typed in by hand, and its A and AAAA records made by hand. Caddy on
public ports 80 and 443 gets a certificate for each domain. Both servers' addresses are public,
and nothing in front of them filters traffic.

Hosting platforms like Vercel give every project an address from its name and let a custom
domain point at it with one CNAME record. A self-hosted Spotcraft can do the same, and
Cloudflare's free plan adds a hidden origin, TLS, a WAF, DDoS protection and sign-in (Access).
Not every owner uses Cloudflare, so it must stay optional.

## Decision

- **A default host per app.** With `APPS_DOMAIN` set on the agent, every app is served at
  `<name>.<APPS_DOMAIN>`. App names are already DNS labels. One wildcard record
  (`*.<APPS_DOMAIN>`) covers every app. `APPS_DOMAIN` should be a zone apex, so Cloudflare's
  free certificate (one level of wildcard) covers it. `www` and `fallback` are reserved names.
- **`domain` becomes the optional custom domain**, served next to the default host. Without
  `APPS_DOMAIN`, it is required, as before. No host can belong to two apps. Existing `app.json`
  files need no change.
- **Cloudflare is optional (`EDGE=direct|cloudflare`, default `direct`).** `direct` is today's
  setup. With `cloudflare`:
  - Each server runs `cloudflared` for its own Cloudflare Tunnel. The tunnel dials out, so ports
    80 and 443 are closed in the firewall and the servers' addresses stay hidden.
  - Caddy serves plain HTTP behind the tunnel and still routes by host. Cloudflare holds the
    certificates.
  - Caddy trusts `CF-Connecting-IP` only from private addresses (cloudflared) and only in this
    mode, and passes the visitor's address on as `X-Forwarded-For`. The dashboard's login
    lockout and the apps keep seeing real visitors.
- **Zone-level setup is OpenTofu** (`infra/cloudflare`, next to `infra/hetzner`): the tunnels,
  the wildcard and dashboard records, TLS settings, the free managed WAF rules, a rate limit on
  the dashboard's login, bot switches (off by default) and Access in front of the dashboard.
  Zones are looked up, never created, so records made by hand survive. Cloudflare's free managed
  WAF rules are on by default and left alone. `route_dns = false` builds everything but leaves
  the records alone, so an existing instance can prepare everything first and keep the switch
  itself to a few minutes' outage. It can't be zero: behind the tunnel, Caddy serves plain
  HTTP to `cloudflared` only, so the public records stop working once Spotcraft switches modes.
- **Every app follows a mode change.** When the agent starts, it rewrites every app's Caddy site
  for the current `EDGE` and `APPS_DOMAIN` and reloads Caddy, so switching modes doesn't wait for
  each app's next deploy.
- **Custom domains are set up by the agent through the Cloudflare API**, because the agent
  already deploys apps one at a time and rolls back:
  - A domain whose zone is in the same Cloudflare account gets a proxied CNAME to the apps
    tunnel. A root domain works through CNAME flattening.
  - Any other domain becomes a Cloudflare for SaaS custom hostname on the apps zone. Its owner
    adds a CNAME to `<name>.<APPS_DOMAIN>`, and the dashboard shows the verification and
    certificate status.
  - The agent only changes records it made itself (marked with the comment `spotcraft:<name>`),
    unless the owner explicitly takes over an existing record.
- **Per-app sign-in**: an app can be put behind Cloudflare Access with the owners' policy, for
  staging apps and previews.

## Consequences

- An app is reachable before anyone touches DNS for it, once the wildcard exists.
- With Cloudflare, Cloudflare is in every request's path: if it is down, so are the apps.
- The agent's Cloudflare token can edit DNS in the account's zones. It lives only in the apps
  server's `.env`, like the agent's other secrets. The token's scopes are listed in
  `infra/cloudflare`.
- Apps on sibling subdomains of the apps domain can set cookies for the whole zone. One
  instance hosts one owner's apps, so this is accepted. A dedicated apps zone avoids it.
- `direct` mode still works on any VPS without a Cloudflare account.
