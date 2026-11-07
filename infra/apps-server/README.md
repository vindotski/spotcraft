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

cAdvisor gets the Docker and containerd sockets (read-only) to name containers and read their
Compose labels; the dashboard finds each app's metrics by `com.docker.compose.project`.

Current state: runs end to end (checked locally with both stacks side by side); the
provisioning and deploy workflow come next.
