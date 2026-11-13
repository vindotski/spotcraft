---
title: Taking over a custom domain's DNS records is an app setting
number: 22
status: accepted
implementation: done
date: 2026-11-13
supersedes: [21]
superseded_by: []
notes: "Partly supersedes ADR 0021: only how a take-over is asked for. Built: `takeOver` in app.json and the PUT body, the dashboard's checkbox keeps its value."
---

# Taking over a custom domain's DNS records is an app setting

## Context

ADR 0021 lets the agent replace a custom domain's A, AAAA and CNAME records that Spotcraft
didn't make, when the owner explicitly asks. That request was a flag on a single deploy
(`PUT /apps/:name?takeOver=true`). It was never stored, so the dashboard's edit form always
showed the box unchecked, even right after a take-over. Owners read that as the setting being
lost.

## Decision

- `takeOver` is a boolean in the app's settings: stored in `app.json`, returned by
  `GET /apps/:name`, and sent in the `PUT` body. The `?takeOver` query parameter is gone.
- Left out of a `PUT`, it keeps its current value, like `database` and `protected`.
- While it is on, **every** deploy may replace the custom domain's A, AAAA and CNAME records
  that Spotcraft didn't make. Other records (MX, TXT, …) are never touched, and a failed deploy
  still puts DNS back exactly as it was.
- The dashboard's checkbox shows the stored value.

The rest of ADR 0021 stands.

## Consequences

- The checkbox means what it shows.
- With it left on, a later domain change replaces that domain's foreign records without asking
  again. The owner turns it off to get the 409 safety check back.
- Breaking for the agent API: a client that sends `?takeOver=true` is now refused (unknown
  query parameters were never accepted). The dashboard is the only client and changes with it.
