# Hetzner (optional)

OpenTofu module that creates the Spotcraft server on Hetzner Cloud
([ADR 0026](../../docs/decisions/0026-one-server.md)):

| Resource             | What                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `spotcraft-apps`     | the server: `cax21` (4 ARM vCPU, 8 GB), Debian 13                             |
| `spotcraft` firewall | in: SSH (22), HTTP (80), HTTPS (443 TCP + UDP), ping; everything else dropped |
|                      | with `edge = "cloudflare"`, 80 and 443 are closed too (Cloudflare Tunnels)    |
| `spotcraft-deploy`   | the deploy user's SSH key                                                     |

The server boots with [`../cloud-init.yaml`](../cloud-init.yaml): a `deploy` user (key
login only, root and passwords off), Docker from Docker's apt repository, log rotation,
automatic security updates, ufw, and `/opt/spotcraft`. Delete and rebuild protection are on
by default (`protect_servers`). Changing the cloud-init later doesn't touch the existing
server; it only runs on first boot. The server keeps the name `spotcraft-apps` (and the key
`apps` in the state) from when there were two, so it is never replaced.

## Create the server

1. A deploy key just for Spotcraft (no passphrase, since GitHub Actions uses it):

   ```sh
   ssh-keygen -t ed25519 -N "" -C spotcraft-deploy -f ~/.ssh/spotcraft_deploy
   ```

2. In the Hetzner Cloud console, create a project and an API token with read and write access.

3. Plan and apply (OpenTofu 1.10+):

   ```sh
   cd infra/hetzner
   cp terraform.tfvars.example terraform.tfvars   # paste ~/.ssh/spotcraft_deploy.pub into it
   export HCLOUD_TOKEN=...
   tofu init
   tofu plan
   tofu apply
   ```

4. Wait about three minutes for the first boot, then follow the printed `next_steps`:
   check `/var/log/spotcraft-ready` on the server and record its host key with
   `ssh-keyscan` (the deploy workflow refuses unknown hosts).

The state (`terraform.tfstate`) stays in this folder and is git-ignored. Keep a copy
somewhere safe: without it, OpenTofu no longer knows it manages the server.

| Variable                | Default        | Meaning                                          |
| ----------------------- | -------------- | ------------------------------------------------ |
| `deploy_ssh_public_key` | —              | public key line for the `deploy` user            |
| `hcloud_token`          | `HCLOUD_TOKEN` | API token (sensitive)                            |
| `location`              | `fsn1`         | `fsn1`, `nbg1` or `hel1` (where ARM servers are) |
| `apps_server_type`      | `cax21`        | server size                                      |
| `ssh_source_ips`        | anywhere       | who may reach SSH (GitHub Actions needs it)      |
| `protect_servers`       | `true`         | Hetzner delete and rebuild protection            |
| `apps_server_backups`   | `true`         | daily Hetzner backups of the server (+20%)       |
| `edge`                  | `direct`       | `cloudflare` closes 80/443 (`../cloudflare`)     |

To remove everything: set `protect_servers = false`, `tofu apply`, then `tofu destroy`.

CI checks this module with `tofu fmt -check` and `tofu validate`.
