# Getting started

Spotcraft runs on one server: your apps, the dashboard, Postgres and the monitoring. You deploy
Spotcraft itself from GitHub Actions, then add apps from the dashboard.

You need: a GitHub account, a Docker Hub account if you publish your own images, a
Debian/Ubuntu server with at least 8 GB of memory (or a Hetzner Cloud account), and a domain for
the dashboard. A Cloudflare account is optional: with it, the server hides behind Cloudflare and
DNS is set up for you.

## 1. Fork the repository

Fork [vindotski/spotcraft](https://github.com/vindotski/spotcraft). Everything personal goes into
your fork's settings, never into its files.

## 2. Create the server

**On Hetzner Cloud**, the OpenTofu module in `infra/hetzner` creates the server (ARM `cax21`,
Debian 13), a firewall and the deploy key:

```sh
ssh-keygen -t ed25519 -N "" -C spotcraft-deploy -f ~/.ssh/spotcraft_deploy
cd infra/hetzner
printf 'deploy_ssh_public_key = "%s"\n' "$(cat ~/.ssh/spotcraft_deploy.pub)" > terraform.tfvars
export HCLOUD_TOKEN=...   # a Hetzner project token with read and write access
tofu init && tofu apply
```

It prints the server's addresses. Keep `terraform.tfstate` somewhere safe.

**On any other provider**, create a Debian 13 (or 12) or Ubuntu 24.04 server and give it the
first-boot setup from `infra/cloud-init.yaml` as user data, with its placeholder filled in.

Either way, wait a few minutes for the first boot, then check that the server is ready:

```sh
ssh -i ~/.ssh/spotcraft_deploy deploy@<server ip> cat /var/log/spotcraft-ready
```

## 3. Point the domains

Pick a domain for the dashboard (e.g. `dash.example.com`) and, optionally, an **apps domain**
(e.g. `example.com`): every app is then served at `<name>.example.com` without any DNS work
per app. The apps domain must be a zone's apex (the root of a domain you own), so one
certificate covers every app.

**Without Cloudflare**, create these records yourself:

- A and AAAA records for the dashboard's domain, pointing at the server.
- With an apps domain, a wildcard A and AAAA record (`*.example.com`) pointing at the server.

If your DNS is on Cloudflare but you don't use the module below, leave the records **DNS only**
(not proxied). Caddy then gets the certificates itself, and the dashboard sees visitors' real
addresses for its login lockout.

**With Cloudflare**, apply [`infra/cloudflare`](../infra/cloudflare/README.md) instead. It
needs the zones in your Cloudflare account. It creates a Cloudflare Tunnel to the server, the
wildcard and dashboard records, TLS and WAF settings, a rate limit on the login page and,
optionally, Cloudflare Access in front of the dashboard. Its README lists the API tokens to
create. Once Spotcraft runs behind the tunnel, close ports 80 and 443 with `edge = "cloudflare"`
in `infra/hetzner`.

## 4. Choose the images

Use the published image (`vindotski/spotcraft`, which runs both the agent and the dashboard), or
publish your own: set the repository variable `DOCKERHUB_USERNAME` and the secret
`DOCKERHUB_TOKEN` (a Docker Hub access token with read and write access), then push to `main`.
CI builds the image for amd64 and arm64.

## 5. Create the GitHub environment

In your fork's **Settings → Environments**, create `production` with:

| Kind     | Name                      | Value                                                        |
| -------- | ------------------------- | ------------------------------------------------------------ |
| variable | `SERVER_HOST`             | the server's public IP                                       |
| variable | `DASHBOARD_DOMAIN`        | e.g. `dash.example.com`                                      |
| secret   | `DEPLOY_SSH_KEY`          | the deploy user's private key (`~/.ssh/spotcraft_deploy`)    |
| secret   | `KNOWN_HOSTS`             | `ssh-keyscan -t ed25519 <server ip>` (check the fingerprint) |
| secret   | `AGENT_TOKEN`             | `openssl rand -hex 32`                                       |
| secret   | `SESSION_SECRET`          | `openssl rand -hex 32`                                       |
| secret   | `POSTGRES_AGENT_PASSWORD` | `openssl rand -hex 32`                                       |
| secret   | `DASHBOARD_PASSWORD_HASH` | `pnpm --filter @spotcraft/dashboard hash-password`           |

Optional settings, all in the same environment:

| Kind     | Name                          | Value                                                         |
| -------- | ----------------------------- | ------------------------------------------------------------- |
| variable | `APPS_DOMAIN`                 | the apps domain, e.g. `example.com`                           |
| variable | `EDGE`                        | `cloudflare` to run behind the tunnel (default `direct`)      |
| secret   | `CLOUDFLARE_TUNNEL_TOKEN`     | `tofu output -raw tunnel_token` in `infra/cloudflare`         |
| secret   | `CLOUDFLARE_API_TOKEN`        | the agent's own token (`infra/cloudflare` README)             |
| variable | `CLOUDFLARE_ACCOUNT_ID`       | from the `agent_settings` output                              |
| variable | `CLOUDFLARE_APPS_ZONE_ID`     | from the `agent_settings` output                              |
| variable | `CLOUDFLARE_TUNNEL_ID`        | from the `agent_settings` output                              |
| variable | `CLOUDFLARE_ACCESS_POLICY_ID` | from the `agent_settings` output, if you use Access           |
| variable | `CF_ACCESS_TEAM_DOMAIN`       | `<team>.cloudflareaccess.com`, if Access guards the dashboard |
| variable | `CF_ACCESS_AUD`               | from the `dashboard_settings` output, with the one above      |

With the four `CLOUDFLARE_*` agent settings, Spotcraft sets up each app's custom domain itself.
With both `CF_ACCESS_*` variables, signing in at Cloudflare Access is enough to open the
dashboard; the password stays as the way in without Access.
With the Access policy as well, any app can be put behind a sign-in.

## 6. Deploy Spotcraft

Run the **Deploy** workflow (**Actions → Deploy → Run workflow**) with a version, such as
`0.1.0`. It deploys the server, waits until every service is healthy,
and checks the dashboard from outside. Then log in at your dashboard's domain.

The monitoring runs on the same server, so it can't tell you when the server itself is down.
Add an external uptime check (any free service) on the dashboard's URL for that.

## 7. Add your first app

In the dashboard, choose **Add app** and fill in:

- **Name**: lower-case letters, digits and dashes, e.g. `blog`.
- **Image** and **tag**: a public image on Docker Hub, e.g. `you/blog` and `1.0.0`. Recent tags
  are suggested.
- **Custom domain**: optional with an apps domain, since the app is always served at
  `<name>.<apps domain>`. A root domain like `example.com` also gets `www.` redirected.
  - Without Cloudflare: point the domain's A and AAAA records at the server, or a CNAME
    at `<name>.<apps domain>`.
  - With the Cloudflare agent settings: a domain in your Cloudflare account is set up for you.
    Tick **Take over existing DNS records** if it still points at an old server; while ticked,
    every deploy may replace records Spotcraft didn't make. For any other
    domain, the app's page shows the CNAME (and any TXT records) to add where its DNS is hosted.
- **Require sign-in**: with Cloudflare Access, visitors must sign in as one of the owners
  first, for example for a staging app.
- **Container port**, **memory** and **CPU** limits, and **environment variables**.
- **Database**: tick it to give the app its own Postgres database on the server, as
  `DATABASE_URL`. Removing the app keeps the database unless you also choose to delete it.

**Deploy** pulls the image, waits until the app is healthy and switches traffic to it. If
anything fails, you see why, and the previous version keeps running. Without Cloudflare, the
certificate arrives on the first HTTPS request once DNS points at the server; behind
Cloudflare, Cloudflare holds the certificates.

Apps run with a read-only filesystem by default; turn it off for apps that write outside
`/tmp`.

## Upgrading and rolling back

To upgrade Spotcraft, read the [changelog](../CHANGELOG.md) for the new version, then run the
Deploy workflow with it. To roll back, run it with the previous version. Your apps keep running
throughout; they are only restarted when a release says so.

To update an app, edit it in the dashboard and pick the new tag. To roll an app back, pick the
old tag.

To move a running instance behind Cloudflare with only a few minutes' outage, follow **Moving
an existing instance** in the [`infra/cloudflare` README](../infra/cloudflare/README.md).

## Next

- [Security model](security.md): what Spotcraft trusts and the risks it accepts.
- [Decision records](decisions/README.md): why it's built the way it is.
