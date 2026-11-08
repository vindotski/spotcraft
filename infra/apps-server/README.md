# Apps server

Hosts the apps. Runs from `/opt/spotcraft` with Docker Compose.

| Service         | Reachable from        | Purpose                                 |
| --------------- | --------------------- | --------------------------------------- |
| `caddy`         | public 80/443         | HTTPS + reverse proxy to each app       |
| `agent`         | private network :4000 | deploys apps on the dashboard's request |
| `node-exporter` | private network :9100 | host metrics                            |
| `cadvisor`      | private network :8080 | per-container metrics                   |
| `postgres`      | Docker networks :5432 | databases for hosted apps               |

Hosted apps join the `spotcraft-edge` network; each has a site block in `sites/`.

Files: `compose.yaml`, `Caddyfile`, `pg_hba.conf`, `.env.example` (copy to `.env`). A fresh server is prepared
by [`../cloud-init.yaml`](../cloud-init.yaml) with `role` set to `apps`.

Every service runs without Linux capabilities (Caddy keeps `NET_BIND_SERVICE`), with
`no-new-privileges`, a read-only root filesystem, and memory and process limits; Caddy and
the exporters have health checks. The `spotcraft-edge` network has IPv6 on, so Caddy sees
IPv6 visitors' real addresses. The agent only answers the ops server (`OPS_PRIVATE_IP`).

cAdvisor gets the Docker and containerd sockets (read-only) to name containers and read their
Compose labels; the dashboard finds each app's metrics by `com.docker.compose.project`.

**Postgres** (18, [ADR 0015](../../docs/decisions/0015-shared-postgres.md)) is reachable as
`postgres` on `spotcraft-edge`, where hosted apps are, and on the internal `db` network meant
for the agent. It is never published on a host port. It runs as its image's own user (999)
with a read-only root and a 1 GB memory limit, tuned for a small server, and keeps its data in
the `postgres_data` volume. Logins (`pg_hba.conf`):

- the superuser `postgres` only over the container's local socket;
- every other role with a password (SCRAM).

The deploy script manages the agent's role, `spotcraft_agent`, on every deploy: it creates the
role or updates its password from `POSTGRES_AGENT_PASSWORD`. The role may create databases and
roles but is not a superuser. It may `SET ROLE` to roles it creates (`createrole_self_grant`),
which Postgres requires to make them a database's owner. The built-in `postgres` and
`template1` databases are closed to everyone else. The superuser's password is generated on the
first deploy and kept in `.env` (`POSTGRES_SUPERUSER_PASSWORD`); Postgres only uses it once,
when it creates its data directory.

Current state: runs end to end (checked locally with both stacks side by side); the
provisioning and deploy workflow come next. The agent creates app databases when an app asks
for one ([agent README](../../agent/README.md#app-databases)); it reaches Postgres on the `db`
network as `spotcraft_agent` (`POSTGRES_URL`).
