# Ops server

Runs the dashboard and the monitoring stack, from `/opt/spotcraft` with Docker Compose.
It is a separate machine so that it can still report when the apps server is down.

| Service           | Reachable from        | Purpose                                                     |
| ----------------- | --------------------- | ----------------------------------------------------------- |
| `caddy`           | public 80/443         | HTTPS for the dashboard                                     |
| `dashboard`       | via Caddy             | SvelteKit app; no database, asks the agent for the app list |
| `victoriametrics` | internal              | metrics storage (90 days)                                   |
| `victorialogs`    | private network :9428 | log storage (30 days); apps server ships here               |
| `vmagent`         | internal              | scrapes the apps server, runs probes                        |
| `blackbox`        | internal              | HTTP uptime probes of each app's public URL                 |

Files: `compose.yaml`, `scrape.yaml` (vmagent targets), `Caddyfile`, `.env.example`
(copy to `.env`), `cloud-init.yaml`.

Current state: placeholder skeleton, not deployable yet.
