---

title: Dashboard login with one admin password
number: 8
status: accepted
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# Dashboard login with one admin password

## Context

Spotcraft is a single-instance, self-hosted tool with one operator. The dashboard can deploy
and remove anything on the apps server, so it needs real authentication, but user accounts
would need storage the dashboard doesn't otherwise have (ADR 0007).

## Decision

- One admin password, stored only as a scrypt hash in `DASHBOARD_PASSWORD_HASH`
  (format `scrypt:<salt>:<hash>`, without `$` so Compose's `.env` doesn't interpolate it).
- A stateless session cookie: an expiry signed with HMAC-SHA256 (`SESSION_SECRET`),
  `httpOnly`, `SameSite=Strict`, 7 days. Rotating the secret ends all sessions.
- Five failed logins per client address within 15 minutes lock that address out (in memory).
- All settings are checked when the server starts; a wrong one stops it with a message.

## Consequences

- No logout-everywhere besides rotating the secret; no per-user audit. Both are fine for
  one operator and can come later with accounts if ever needed.
- The lockout resets when the dashboard restarts.
