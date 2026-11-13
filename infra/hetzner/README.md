# Hetzner (optional)

OpenTofu module that creates both servers on Hetzner Cloud:

| Resource             | What                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `spotcraft-apps`     | `cax21` (4 ARM vCPU, 8 GB), Debian 13, private IP `10.0.0.2`                  |
| `spotcraft-ops`      | `cax11` (2 ARM vCPU, 4 GB), Debian 13, private IP `10.0.0.3`                  |
| `spotcraft` network  | `10.0.0.0/16`, subnet `10.0.0.0/24` in `eu-central`                           |
| `spotcraft` firewall | in: SSH (22), HTTP (80), HTTPS (443 TCP + UDP), ping; everything else dropped |
|                      | with `edge = "cloudflare"`, 80 and 443 are closed too (Cloudflare Tunnels)    |
| `spotcraft-deploy`   | the deploy user's SSH key                                                     |

Both servers boot with [`../cloud-init.yaml`](../cloud-init.yaml): a `deploy` user (key
login only, root and passwords off), Docker from Docker's apt repository, log rotation,
automatic security updates, ufw, and `/opt/spotcraft`. Delete and rebuild protection are on
by default (`protect_servers`). Changing the cloud-init later doesn't touch existing
servers; it only runs on first boot.

## Create the servers

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
   check `/var/log/spotcraft-ready` on each server and record the host keys with
   `ssh-keyscan` (the deploy workflow refuses unknown hosts).

The state (`terraform.tfstate`) stays in this folder and is git-ignored. Keep a copy
somewhere safe: without it, OpenTofu no longer knows it manages these servers.

| Variable                | Default        | Meaning                                          |
| ----------------------- | -------------- | ------------------------------------------------ |
| `deploy_ssh_public_key` | —              | public key line for the `deploy` user            |
| `hcloud_token`          | `HCLOUD_TOKEN` | API token (sensitive)                            |
| `location`              | `fsn1`         | `fsn1`, `nbg1` or `hel1` (where ARM servers are) |
| `apps_server_type`      | `cax21`        | apps server size                                 |
| `ops_server_type`       | `cax11`        | ops server size                                  |
| `ssh_source_ips`        | anywhere       | who may reach SSH (GitHub Actions needs it)      |
| `protect_servers`       | `true`         | Hetzner delete and rebuild protection            |
| `apps_server_backups`   | `false`        | daily Hetzner backups of the apps server (+20%)  |
| `edge`                  | `direct`       | `cloudflare` closes 80/443 (`../cloudflare`)     |

To remove everything: set `protect_servers = false`, `tofu apply`, then `tofu destroy`.

CI checks this module with `tofu fmt -check` and `tofu validate`.
