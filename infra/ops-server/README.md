# Ops server

Runs the dashboard and the monitoring stack, from `/opt/spotcraft` with Docker Compose.
It is a separate machine so that it can still report when the apps server is down.

| Service           | Reachable from | Purpose                                                     |
| ----------------- | -------------- | ----------------------------------------------------------- |
| `caddy`           | public 80/443  | HTTPS for the dashboard                                     |
| `dashboard`       | via Caddy      | SvelteKit app; no database, asks the agent for the app list |
| `victoriametrics` | internal       | metrics storage (90 days)                                   |
| `vmagent`         | internal       | scrapes the apps server, runs probes                        |
| `blackbox`        | internal       | HTTP uptime probes of each app's public URL                 |

Files: `compose.yaml`, `scrape.yaml` (vmagent targets), `Caddyfile`, `.env.example`
(copy to `.env`). A fresh server is prepared by [`../cloud-init.yaml`](../cloud-init.yaml) with
`role` set to `ops`.

Logs are read through the agent (`docker logs`); VictoriaLogs comes after the MVP.

Current state: runs end to end (checked locally with both stacks side by side); the
provisioning and deploy workflow come next.
