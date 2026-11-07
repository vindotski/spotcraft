---

title: App state lives on the apps server; agent API
number: 7
status: accepted
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: []
notes: "The dashboard has no database (the ops server README earlier planned SQLite)."
---

# App state lives on the apps server; agent API

## Context

The dashboard needs a list of apps, and the apps server needs to know what to run. Keeping
the list in a dashboard database as well as on the apps server would mean two copies that
can disagree.

## Decision

- The agent's files on the apps server are the only record: `apps/<name>/app.json`, the
  generated `compose.yaml`, and `sites/<name>.caddy`. The dashboard has no database and asks
  the agent.
- The agent's HTTP API: `GET /apps`, `GET|PUT|DELETE /apps/:name`, `GET /apps/:name/logs`,
  bearer token, strict JSON Schema validation (unknown fields rejected).
- A deploy writes the files, pulls, starts with `--wait`, and reloads Caddy; on failure the
  previous files are restored. One change at a time.
- Compose files are generated as JSON, so user input never needs YAML escaping; `$` is
  doubled so Compose doesn't interpolate it. Commands run with `execFile`, never a shell.
- App containers are hardened by default (no capabilities, `no-new-privileges`, limits,
  read-only root filesystem unless turned off).

## Consequences

- Backing up `/opt/spotcraft` on the apps server backs up the whole configuration.
- Losing the apps server loses the app list too, until backups exist (post-MVP).
- Deploy history and audit would need storage later; not in the MVP.
