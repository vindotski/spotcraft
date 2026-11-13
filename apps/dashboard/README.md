# @spotcraft/dashboard

SvelteKit app (adapter-node) on the Spotcraft server. One admin logs in with a password (or
through Cloudflare Access), then manages the apps through the agent and reads metrics from
VictoriaMetrics. It has no database: the agent's files are the app list.

## Screens

| Path                | What                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/login`            | password login (5 failures per address in 15 minutes locks it out)                                              |
| `/`                 | apps: status, address, image:tag, 24-hour uptime                                                                |
| `/apps/new`         | add an app: name, image, tag (Docker Hub suggestions), custom domain, port, limits, env, database, sign-in      |
| `/apps/:name`       | status, reachability, uptime, CPU, memory, response time, settings, domain status, logs; Edit, Redeploy, Remove |
| `/apps/:name/users` | an app's users (guests and registered), newest first; delete one with a confirmation                            |
| `/apps/:name/edit`  | change settings and deploy                                                                                      |
| `/server`           | the server's CPU, memory, disk, load, uptime                                                                    |

**Database** gives the app its own Postgres database on the server, as `DATABASE_URL`
([ADR 0015](../../docs/decisions/0015-shared-postgres.md)). The form refuses an own
`DATABASE_URL` while it is ticked. Removing such an app keeps its database unless "Also delete
its database" is ticked in the Remove dialog. If that delete fails after the app is gone, the
error page says so.

Signed-in pages end with the running Spotcraft version (from the dashboard's `package.json`,
which carries the project's version), linked to its release notes. It isn't shown before login.

A failed deploy shows the agent's error and command output; the previous version keeps
running. Metrics are optional: without VictoriaMetrics the pages show "No data yet".

Each time the app list is read or changed, the dashboard writes `PROBES_FILE`: one HTTPS
uptime-probe target per app, which vmagent reads (`file_sd_configs`).

## Settings

Checked when the server starts (`src/env.ts`); a missing or invalid value stops it with a
message naming the variable.

| Env                       | Default                                | Meaning                                                                            |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `AGENT_URL`               | —                                      | e.g. `http://agent:4000`                                                           |
| `AGENT_TOKEN`             | —                                      | same token as the agent, 32+ characters                                            |
| `DASHBOARD_PASSWORD_HASH` | —                                      | from the `hash-password` script                                                    |
| `SESSION_SECRET`          | —                                      | 32+ characters; changing it logs everyone out                                      |
| `VICTORIAMETRICS_URL`     | `http://victoriametrics:8428`          | metrics query API                                                                  |
| `PROBES_FILE`             | empty (Compose: `/probes/probes.json`) | where to write probe targets                                                       |
| `CF_ACCESS_TEAM_DOMAIN`   | empty                                  | `<team>.cloudflareaccess.com`; with the next, an Access sign-in skips the password |
| `CF_ACCESS_AUD`           | empty                                  | the dashboard Access application's AUD tag; set both or neither                    |

It runs from the `spotcraft` image (the root `Dockerfile`, shared with the agent; Compose starts
it with `working_dir: /app/dashboard` and `command: ["build"]`). Compose also sets `PORT=3000`,
`PROBES_FILE=/probes/probes.json` and the adapter-node proxy settings for running behind Caddy:
`PROTOCOL_HEADER=x-forwarded-proto`, `ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`.

```sh
pnpm --filter @spotcraft/dashboard hash-password   # prints DASHBOARD_PASSWORD_HASH (asks without echo)
pnpm --filter @spotcraft/dashboard build           # output in build/, no runtime node_modules needed
pnpm --filter @spotcraft/dashboard typecheck
pnpm --filter @spotcraft/dashboard test            # node:test, test/*.test.ts
docker build .                                     # the spotcraft image, from the repository root
```

## Security

- Every route but `/login` needs a session or a Cloudflare Access sign-in; `/api/*` answers 401
  instead of redirecting.
- **Access sign-in** (both `CF_ACCESS_*` set, [ADR 0023](../../docs/decisions/0023-access-sign-in.md)):
  a valid `Cf-Access-Jwt-Assertion` header counts as signed in. It must be signed with one of the
  team's published keys (cached, fetched from `/cdn-cgi/access/certs`), name the team as issuer and
  this app's AUD as audience, and carry an email, which the header shows. The `CF_Authorization`
  cookie alone doesn't count. Log out also ends the Access sign-in (`/cdn-cgi/access/logout`). If
  the keys can't be fetched, the dashboard logs it and the password login still works.
- Session cookie: `httpOnly`, `SameSite=Strict`, HMAC-signed with an expiry (7 days).
- Form posts get SvelteKit's origin check; pages send a nonce-based CSP, `X-Frame-Options: DENY`
  and `Cache-Control: no-store`.
- App settings are validated with the agent's own rules (`@spotcraft/agent/app-spec`).
