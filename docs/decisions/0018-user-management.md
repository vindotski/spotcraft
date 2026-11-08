---
title: The dashboard lists and deletes an app's users
number: 18
status: accepted
implementation: done
date: 2026-11-08
supersedes: []
superseded_by: []
notes: "Banning, editing and impersonation are left for later."
---

# The dashboard lists and deletes an app's users

## Context

Apps that use the backend kit keep their users in the `auth` schema of their own database
(ADRs 0015 and 0016). The operator needs to see those users and remove one when necessary,
without each app building an admin screen.

## Decision

- **The agent reads the `auth` tables directly**, as their owner. Its routes, with strict schemas:
  - `GET /apps/:name/users` (paged): id, created, last seen and whether the user is a guest;
  - `DELETE /apps/:name/users/:id`: the user's sessions and the app's rows go through the
    foreign-key cascades.
- **The dashboard shows a Users tab per app**, with a confirmation before deleting. It still talks
  only to the agent and keeps no data.
- An app database without the `auth` schema is shown as "not using the kit".

## Consequences

- It works while the app is down.
- It depends on the kit's table layout, which Spotcraft migrates itself, so the agent always
  knows that layout.
- Deleting is the only moderation tool until banning is added.
