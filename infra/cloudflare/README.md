# Cloudflare (optional)

OpenTofu module that puts Spotcraft behind Cloudflare (ADR 0021). It needs zones that are
already in your Cloudflare account. It looks them up and never creates or deletes them, so
records you made by hand stay.

| Resource                                         | What                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| tunnel `spotcraft-apps`                          | managed here; every request goes to the server's Caddy (ADR 0026)             |
| `*.<apps_domain>` (proxied CNAME)                | every app's default host, through the tunnel                                  |
| `<dashboard_domain>` (proxied CNAME)             | the dashboard, through the same tunnel                                        |
| `fallback.<apps_domain>` + fallback origin       | with `custom_hostnames`: Cloudflare for SaaS for domains outside it           |
| zone settings                                    | SSL Full (strict), Always Use HTTPS, TLS 1.2+, HTTP/3, Rocket Loader off      |
| bot management                                   | Bot Fight Mode and "Block AI bots", both off by default                       |
| rate limit (dashboard zone)                      | `/login`: `login_rate_limit` requests per 10 s per visitor, then 10 s blocked |
| Access policy `spotcraft-owners` + dashboard     | with `access_emails`: a one-time code by email before the dashboard           |
| Access bypass, `<dashboard_domain>/hooks/deploy` | with `access_emails`: apps' CI reaches the deploy hook (ADR 0029)             |

The zone settings and bot switches apply to the apps zone, the dashboard's zone and
`extra_zones`. Cloudflare's free managed WAF rules are on by default on every zone; this
module doesn't change them.

## Before you start

- Every zone (`apps_domain`, the dashboard's zone, `extra_zones`) is active in the account.
- **Access** (`access_emails`): Zero Trust is set up once in the Cloudflare dashboard (a team
  name and the free plan). One-time PIN login is on by default. The `dashboard_settings`
  output's `CF_ACCESS_AUD`, plus `CF_ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`), let
  that sign-in skip the dashboard's password (ADR 0023).
- **Custom hostnames** (`custom_hostnames = true`): on the apps zone, open **SSL/TLS → Custom
  Hostnames** and enable Cloudflare for SaaS. The first 100 hostnames are free.
- If the wildcard or the dashboard's host already has a record (e.g. an A record pointing at the
  server), delete it right before the apply, or import it:
  `tofu import 'cloudflare_dns_record.dashboard[0]' '<zone id>/<record id>'`.

## API tokens

Create tokens under **My Profile → API Tokens → Custom token**.

This module's token:

| Scope   | Permission                      | Why                                  |
| ------- | ------------------------------- | ------------------------------------ |
| Account | Cloudflare Tunnel: Edit         | the tunnel and its ingress           |
| Account | Access: Apps and Policies: Edit | the owners policy, the dashboard app |
| Zone    | Zone: Read                      | look up zones                        |
| Zone    | DNS: Edit                       | wildcard, dashboard, fallback        |
| Zone    | Zone Settings: Edit             | TLS settings, Rocket Loader          |
| Zone    | Zone WAF: Edit                  | the login rate limit                 |
| Zone    | Bot Management: Edit            | bot switches                         |
| Zone    | SSL and Certificates: Edit      | fallback origin for custom hostnames |

The agent's token (`CLOUDFLARE_API_TOKEN` on the server), for custom domains and protected
apps:

| Scope   | Permission                      | Zones                                     |
| ------- | ------------------------------- | ----------------------------------------- |
| Zone    | Zone: Read, DNS: Edit           | all zones of the account (custom domains) |
| Zone    | SSL and Certificates: Edit      | the apps zone (custom hostnames)          |
| Account | Access: Apps and Policies: Edit | the account (protected apps)              |

## Apply

```sh
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars
export CLOUDFLARE_API_TOKEN=...
tofu init
tofu plan
tofu apply
```

Then follow the printed `next_steps`. Put the tunnel token and the agent settings in the GitHub
`production` environment, deploy with `EDGE=cloudflare`, and close ports 80 and 443 with
`edge = "cloudflare"` in `infra/hetzner`.

The state stays in this folder and is git-ignored. It holds the tunnel tokens, so keep it
private, and keep a copy somewhere safe.

### Moving an existing instance

The switch takes a short, planned outage. Behind a tunnel, Caddy serves plain HTTP to
`cloudflared` only. So from the moment Spotcraft is deployed with `EDGE=cloudflare` until
visitors' DNS points at the tunnel, the old A and AAAA records lead nowhere. Keep that window
small:

1. Apply with `route_dns = false`. This creates the tunnel and settings but changes no records,
   and Access only takes effect on proxied records. Nothing changes for visitors yet.
2. A day before, lower the TTL of the existing A and AAAA records (the dashboard's, the
   wildcard's, and each app's domain) to 60 seconds, so resolvers forget them quickly.
3. Deploy with `EDGE=cloudflare` and the tunnel token. The outage starts here.
4. Right away, apply with `route_dns = true`. The wildcard and the dashboard now go through the
   tunnel. Then edit each app that has a custom domain and save it with **Take over existing DNS
   records** ticked (or point its record at the tunnel by hand). The outage ends as resolvers
   pick up the new records, usually within a few minutes.
5. Close ports 80 and 443 with `edge = "cloudflare"` in `infra/hetzner`.

Going back is the same in reverse, with the same short outage: re-create the A and AAAA records,
deploy without `EDGE`, and apply `edge = "direct"` in `infra/hetzner`. After either switch, the
agent rewrites every app's Caddy site for the new mode when it starts.

| Variable                  | Default                | Meaning                                                |
| ------------------------- | ---------------------- | ------------------------------------------------------ |
| `account_id`              | —                      | Cloudflare account id                                  |
| `apps_domain`             | —                      | zone apex for `<name>.<apps_domain>` (= `APPS_DOMAIN`) |
| `dashboard_domain`        | —                      | the dashboard's host (= `DASHBOARD_DOMAIN`)            |
| `dashboard_zone`          | `apps_domain`          | zone holding the dashboard's host                      |
| `cloudflare_api_token`    | `CLOUDFLARE_API_TOKEN` | this module's token (sensitive)                        |
| `access_emails`           | `[]`                   | who may sign in through Access; empty turns it off     |
| `access_session_duration` | `24h`                  | how long a sign-in lasts                               |
| `custom_hostnames`        | `false`                | Cloudflare for SaaS on the apps zone                   |
| `extra_zones`             | `[]`                   | more zones for the same settings                       |
| `login_rate_limit`        | `10`                   | requests to `/login` per 10 s; `0` turns it off        |
| `bot_fight_mode`          | `false`                | Bot Fight Mode (challenges probes and scripts too)     |
| `block_ai_bots`           | `false`                | "Block AI bots"                                        |
| `route_dns`               | `true`                 | point the records at the tunnel                        |

Limits of the free plan:

- **One rate-limit rule per zone**, matched on the path only. If the dashboard's zone already has
  a rate-limit rule, the apply fails; set `login_rate_limit = 0`.
- **Free certificates cover one level of subdomain**, so `apps_domain` must be a zone apex:
  `app.example.com` works, `app.apps.example.com` doesn't.

CI checks this module with `tofu fmt -check` and `tofu validate`.

### From two servers to one

Until 0.4.0, Spotcraft ran on two servers with a tunnel each (`spotcraft-apps` and
`spotcraft-ops`). The module now keeps only `spotcraft-apps`, under the same key, so its id
and every custom-domain CNAME the agent made stay valid. Once the server runs the dashboard
(deploy 0.4.0 first), `tofu plan` must show the dashboard record moving to that tunnel and the
`spotcraft-ops` tunnel being destroyed, and **no replacement** of `spotcraft-apps`; then apply.
Stop the old ops server's stack first so its tunnel has no connections left.
