---
title: A Cloudflare Access sign-in also signs in to the dashboard
number: 23
status: accepted
implementation: done
date: 2026-11-13
supersedes: [8, 21]
superseded_by: []
notes: "Partly supersedes ADR 0008 (the password is no longer the only way in) and ADR 0021 (Access in front of the dashboard now also signs in). Built: Access JWT check, logout through Access, dashboard_settings output, deploy variables. 0.4.1: Log out passes returnTo (the dashboard) and the CSP form-action allows *.cloudflareaccess.com, so the browser lands on the Access sign-in."
---

# A Cloudflare Access sign-in also signs in to the dashboard

## Context

With Cloudflare Access in front of the dashboard (ADR 0021), the owners sign in twice: first
with a one-time code at Cloudflare, then with the dashboard's admin password (ADR 0008). The
second step adds nothing: Access already decided who may reach the dashboard, and only the
owners pass its policy.

Access adds a signed token to every request it lets through, in the
`Cf-Access-Jwt-Assertion` header. Its signing keys are published at
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, and each token names the Access
application it was issued for (`aud`).

## Decision

- With `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` set (both or neither), the dashboard checks
  the `Cf-Access-Jwt-Assertion` header on every request: an RS256 signature by one of the
  team's published keys, the team as issuer, the dashboard application's AUD tag as audience,
  not expired, and an `email` claim. A valid token counts as signed in, with no password.
- Only the header counts, never the `CF_Authorization` cookie.
- The audience check is what matters: owners also get Access tokens for protected hosted apps,
  and those must not open the dashboard.
- Log out ends the dashboard session and, when the request came through Access, sends the
  browser to `/cdn-cgi/access/logout` on the dashboard's host, which ends the Access sign-in.
- The password login stays, unchanged, and `DASHBOARD_PASSWORD_HASH` stays required. It is
  the way in without Access (direct mode, local runs) and the break-glass login.
- `infra/cloudflare` outputs the dashboard application's AUD as `dashboard_settings`; the
  deploy passes both values to the dashboard.

## Consequences

- One sign-in behind Access.
- The dashboard trusts Cloudflare's signing keys. Anyone who could mint tokens for the team
  could open the dashboard; that was already true of reaching it.
- The keys are fetched from Cloudflare and cached. If that fails, Access sign-ins fall back
  to the password, and the dashboard logs why.
