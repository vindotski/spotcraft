# Ops server

Runs the dashboard and the monitoring stack, from `/opt/spotcraft` with Docker Compose.
It is a separate machine so that it can still report when the apps server is down.

| Service           | Reachable from | Purpose                                                     |
| ----------------- | -------------- | ----------------------------------------------------------- |
| `caddy`           | public 80/443  | HTTPS for the dashboard                                     |
| `cloudflared`     | outbound only  | with `EDGE=cloudflare`: the tunnel to Caddy                 |
| `dashboard`       | via Caddy      | SvelteKit app; no database, asks the agent for the app list |
| `victoriametrics` | internal       | metrics storage (90 days)                                   |
| `vmagent`         | internal       | scrapes the apps server, runs probes                        |
| `blackbox`        | internal       | HTTP uptime probes of each app's public URL                 |

Files: `compose.yaml`, `scrape.yaml` (vmagent targets), `blackbox.yml` (probe modules), `Caddyfile`, `.env.example`
(copy to `.env`). A fresh server is prepared by [`../cloud-init.yaml`](../cloud-init.yaml) with
`role` set to `ops`.

Caddy adds HSTS and security headers, limits request bodies to 1 MB and times out slow
clients. Every service runs without Linux capabilities (Caddy keeps `NET_BIND_SERVICE`), with
`no-new-privileges`, a read-only root filesystem where possible, memory limits and health
checks. The network has IPv6 on, so the dashboard sees IPv6 visitors' real addresses.
Caddy sends the visitor's address as `X-Forwarded-For` (the login lockout keys on it) and
trusts `CF-Connecting-IP` only from `CADDY_TRUSTED_PROXIES` (loopback by default;
`private_ranges` behind a Cloudflare Tunnel, ADR 0021).

Behind Cloudflare (`EDGE=cloudflare`), the deploy also sets `COMPOSE_PROFILES=cloudflare`,
`CLOUDFLARE_TUNNEL_TOKEN`, `PUBLIC_BIND=127.0.0.1` and `DASHBOARD_SCHEME=http://`, so Caddy
serves the dashboard over plain HTTP to `cloudflared` only.

Uptime probes use blackbox's `http_2xx` module. For an app behind Cloudflare Access, the
dashboard labels its targets `module=http_access`: that module expects a 302 to
`<team>.cloudflareaccess.com`, so the probe shows Cloudflare and Access are up. It can't see
behind the sign-in.

Logs are read through the agent (`docker logs`); VictoriaLogs comes after the MVP.

Current state: runs end to end (checked locally with both stacks side by side); the
provisioning and deploy workflow come next.
