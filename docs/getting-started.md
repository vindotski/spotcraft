# Getting started

Spotcraft runs on two servers: an **apps server** for your apps and an **ops server** for the
dashboard and monitoring, joined by a private network. You deploy Spotcraft itself from GitHub
Actions, then add apps from the dashboard.

You need: a GitHub account, a Docker Hub account if you publish your own images, two
Debian/Ubuntu servers (or a Hetzner Cloud account), and a domain for the dashboard.

## 1. Fork the repository

Fork [vindotski/spotcraft](https://github.com/vindotski/spotcraft). Everything personal goes into
your fork's settings, never into its files.

## 2. Create the servers

**On Hetzner Cloud**, the OpenTofu module in `infra/hetzner` creates both servers (ARM, Debian 13),
the private network, a firewall and the deploy key:

```sh
ssh-keygen -t ed25519 -N "" -C spotcraft-deploy -f ~/.ssh/spotcraft_deploy
cd infra/hetzner
printf 'deploy_ssh_public_key = "%s"\n' "$(cat ~/.ssh/spotcraft_deploy.pub)" > terraform.tfvars
export HCLOUD_TOKEN=...   # a Hetzner project token with read and write access
tofu init && tofu apply
```

It prints both servers' addresses. Keep `terraform.tfstate` somewhere safe.

**On any other provider**, create two Debian 13 (or 12) or Ubuntu 24.04 servers with a private
network between them (`10.0.0.2` for apps and `10.0.0.3` for ops by default), and give each the
first-boot setup from `infra/cloud-init.yaml` as user data, with its placeholders filled in.

Either way, wait a few minutes for the first boot, then check that both servers are ready:

```sh
ssh -i ~/.ssh/spotcraft_deploy deploy@<server ip> cat /var/log/spotcraft-ready
```

## 3. Point the dashboard's domain

Create A and AAAA records for the dashboard's domain (e.g. `dash.example.com`) pointing at the
**ops server**. If your DNS is on Cloudflare, leave the records **DNS only** (not proxied): Caddy
gets the certificate itself, and the dashboard needs visitors' real addresses for its login
lockout.

## 4. Choose the images

Use the published images (`vindotski/spotcraft-agent` and `vindotski/spotcraft-dashboard`), or
publish your own: set the repository variable `DOCKERHUB_USERNAME` and the secret
`DOCKERHUB_TOKEN` (a Docker Hub access token with read and write access), then push to `main`.
CI builds both images for amd64 and arm64.

## 5. Create the GitHub environment

In your fork's **Settings → Environments**, create `production` with:

| Kind     | Name                      | Value                                                                |
| -------- | ------------------------- | -------------------------------------------------------------------- |
| variable | `APPS_HOST`               | apps server public IP                                                |
| variable | `OPS_HOST`                | ops server public IP                                                 |
| variable | `DASHBOARD_DOMAIN`        | e.g. `dash.example.com`                                              |
| secret   | `DEPLOY_SSH_KEY`          | the deploy user's private key (`~/.ssh/spotcraft_deploy`)            |
| secret   | `KNOWN_HOSTS`             | `ssh-keyscan -t ed25519 <apps ip> <ops ip>` (check the fingerprints) |
| secret   | `AGENT_TOKEN`             | `openssl rand -hex 32`                                               |
| secret   | `SESSION_SECRET`          | `openssl rand -hex 32`                                               |
| secret   | `POSTGRES_AGENT_PASSWORD` | `openssl rand -hex 32`                                               |
| secret   | `DASHBOARD_PASSWORD_HASH` | `pnpm --filter @spotcraft/dashboard hash-password`                   |

`APPS_PRIVATE_IP` and `OPS_PRIVATE_IP` are optional variables, for private addresses other
than `10.0.0.2` and `10.0.0.3`.

## 6. Deploy Spotcraft

Run the **Deploy** workflow (**Actions → Deploy → Run workflow**) with a version, such as
`0.1.0`. It deploys the apps server, then the ops server, waits until every service is healthy,
and checks the dashboard from outside. Then log in at your dashboard's domain.

## 7. Add your first app

In the dashboard, choose **Add app** and fill in:

- **Name**: lower-case letters, digits and dashes, e.g. `blog`.
- **Image** and **tag**: a public image on Docker Hub, e.g. `you/blog` and `1.0.0`. Recent tags
  are suggested.
- **Domain**: e.g. `blog.example.com`. Point its A and AAAA records at the **apps server**
  (DNS only, if on Cloudflare). A root domain like `example.com` also gets `www.` redirected.
- **Container port**, **memory** and **CPU** limits, and **environment variables**.
- **Database**: tick it to give the app its own Postgres database on the apps server, as
  `DATABASE_URL`. Removing the app keeps the database unless you also choose to delete it.

**Deploy** pulls the image, waits until the app is healthy and switches traffic to it. If
anything fails, you see why, and the previous version keeps running. The certificate arrives
on the first HTTPS request once DNS points at the apps server.

Apps run with a read-only filesystem by default; turn it off for apps that write outside
`/tmp`.

## Upgrading and rolling back

To upgrade Spotcraft, read the [changelog](../CHANGELOG.md) for the new version, then run the
Deploy workflow with it. To roll back, run it with the previous version. Your apps keep running
throughout; they are only restarted when a release says so.

To update an app, edit it in the dashboard and pick the new tag. To roll an app back, pick the
old tag.

## Next

- [Security model](security.md): what Spotcraft trusts and the risks it accepts.
- [Decision records](decisions/README.md): why it's built the way it is.
