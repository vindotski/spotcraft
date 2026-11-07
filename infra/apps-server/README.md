# Apps server

Hosts the apps. Runs from `/opt/spotcraft` with Docker Compose.

| Service         | Reachable from        | Purpose                                 |
| --------------- | --------------------- | --------------------------------------- |
| `caddy`         | public 80/443         | HTTPS + reverse proxy to each app       |
| `agent`         | private network :4000 | deploys apps on the dashboard's request |
| `node-exporter` | private network :9100 | host metrics                            |
| `cadvisor`      | private network :8080 | per-container metrics                   |

Hosted apps join the `spotcraft-edge` network; each has a site block in `sites/`.

Files: `compose.yaml`, `Caddyfile`, `.env.example` (copy to `.env`), `cloud-init.yaml`
(bootstrap for a fresh Debian/Ubuntu VPS).

Current state: placeholder skeleton, not deployable yet.
