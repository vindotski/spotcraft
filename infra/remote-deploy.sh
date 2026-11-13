#!/usr/bin/env bash
# Runs ON a Spotcraft server (via `ssh deploy@host bash -s`), after the deploy workflow has
# copied that server's compose files into /opt/spotcraft. The workflow prepends `export`
# lines with the values below; they arrive over SSH's stdin, never on a command line.
#
#   ROLE                      apps | ops
#   SPOTCRAFT_TAG             image tag to run, e.g. sha-abc1234 or latest
#   IMAGE_NAMESPACE           Docker Hub user that publishes spotcraft-agent/-dashboard
#   AGENT_TOKEN               shared by the agent and the dashboard
#   apps: PRIVATE_IP          this server's private address
#   apps: OPS_PRIVATE_IP      the ops server's private address (the only agent client)
#   apps: POSTGRES_AGENT_PASSWORD  password of the agent's Postgres role (spotcraft_agent)
#   apps: APPS_DOMAIN         optional; every app is also served at <name>.<APPS_DOMAIN>
#   apps: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_APPS_ZONE_ID,
#         CLOUDFLARE_TUNNEL_ID   optional; the agent sets up custom domains' DNS (ADR 0021)
#   apps: CLOUDFLARE_ACCESS_POLICY_ID  optional; lets apps be put behind Cloudflare Access
#   ops:  APPS_PRIVATE_IP, DASHBOARD_DOMAIN, DASHBOARD_PASSWORD_HASH, SESSION_SECRET
#   ops:  CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD  optional, both or neither; an Access sign-in
#         skips the dashboard password (ADR 0023)
#   EDGE                      optional; cloudflare = behind a Cloudflare Tunnel (ADR 0021)
#   CLOUDFLARE_TUNNEL_TOKEN   this server's tunnel token; required with EDGE=cloudflare
set -euo pipefail
cd /opt/spotcraft

require() {
  for name in "$@"; do
    value="${!name:-}"
    # Secrets pasted from `... | pbcopy` end in a newline; no valid value starts or ends with
    # whitespace, so trim it before checking.
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf -v "$name" '%s' "$value"
    if [ -z "$value" ]; then
      echo "::error::$name is empty" >&2
      exit 1
    fi
    # .env values are written unquoted: refuse anything Compose could misread.
    if [[ "$value" =~ [[:space:]\"\'\$\#\\] ]]; then
      echo "::error::$name contains a character .env can't hold safely" >&2
      exit 1
    fi
  done
}

# Like require, for values that may be left out.
optional() {
  for name in "$@"; do
    [ -n "${!name:-}" ] && require "$name"
    printf -v "$name" '%s' "${!name:-}"
  done
}

require ROLE SPOTCRAFT_TAG IMAGE_NAMESPACE AGENT_TOKEN

# Behind a Cloudflare Tunnel, cloudflared runs (its Compose profile), Caddy is only published
# on loopback and serves plain HTTP, and it trusts the visitor's address from cloudflared.
EDGE="${EDGE:-direct}"
case "$EDGE" in
  direct)
    CLOUDFLARE_TUNNEL_TOKEN=""
    EDGE_ENV=""
    ;;
  cloudflare)
    require CLOUDFLARE_TUNNEL_TOKEN
    EDGE_ENV="COMPOSE_PROFILES=cloudflare
CLOUDFLARE_TUNNEL_TOKEN=$CLOUDFLARE_TUNNEL_TOKEN
PUBLIC_BIND=127.0.0.1
CADDY_TRUSTED_PROXIES=private_ranges"
    ;;
  *)
    echo "::error::EDGE must be direct or cloudflare" >&2
    exit 1
    ;;
esac

# Only the deploy user can read the file with the secrets.
umask 077
case "$ROLE" in
  apps)
    require PRIVATE_IP OPS_PRIVATE_IP POSTGRES_AGENT_PASSWORD
    optional APPS_DOMAIN CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_APPS_ZONE_ID CLOUDFLARE_TUNNEL_ID
    optional CLOUDFLARE_ACCESS_POLICY_ID
    DOCKER_GID="$(getent group docker | cut -d: -f3)"
    # Postgres needs a superuser password once, when its data directory is created; nobody
    # uses it afterwards (the superuser only works over the container's local socket). It is
    # generated here on the first deploy and kept in .env, never stored in GitHub.
    POSTGRES_SUPERUSER_PASSWORD="$(sed -n 's/^POSTGRES_SUPERUSER_PASSWORD=//p' .env 2>/dev/null || true)"
    if [ -z "$POSTGRES_SUPERUSER_PASSWORD" ]; then
      POSTGRES_SUPERUSER_PASSWORD="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    cat > .env.new <<ENV
PRIVATE_IP=$PRIVATE_IP
OPS_PRIVATE_IP=$OPS_PRIVATE_IP
SPOTCRAFT_TAG=$SPOTCRAFT_TAG
SPOTCRAFT_AGENT_IMAGE=$IMAGE_NAMESPACE/spotcraft-agent
AGENT_TOKEN=$AGENT_TOKEN
DOCKER_GID=$DOCKER_GID
POSTGRES_AGENT_PASSWORD=$POSTGRES_AGENT_PASSWORD
POSTGRES_SUPERUSER_PASSWORD=$POSTGRES_SUPERUSER_PASSWORD
APPS_DOMAIN=$APPS_DOMAIN
EDGE=$EDGE
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_APPS_ZONE_ID=$CLOUDFLARE_APPS_ZONE_ID
CLOUDFLARE_TUNNEL_ID=$CLOUDFLARE_TUNNEL_ID
CLOUDFLARE_ACCESS_POLICY_ID=$CLOUDFLARE_ACCESS_POLICY_ID
ENV
    ;;
  ops)
    require APPS_PRIVATE_IP DASHBOARD_DOMAIN DASHBOARD_PASSWORD_HASH SESSION_SECRET
    optional CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD
    if { [ -n "$CF_ACCESS_TEAM_DOMAIN" ] && [ -z "$CF_ACCESS_AUD" ]; } ||
      { [ -z "$CF_ACCESS_TEAM_DOMAIN" ] && [ -n "$CF_ACCESS_AUD" ]; }; then
      echo "::error::Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither" >&2
      exit 1
    fi
    cat > .env.new <<ENV
DASHBOARD_DOMAIN=$DASHBOARD_DOMAIN
APPS_PRIVATE_IP=$APPS_PRIVATE_IP
SPOTCRAFT_TAG=$SPOTCRAFT_TAG
SPOTCRAFT_DASHBOARD_IMAGE=$IMAGE_NAMESPACE/spotcraft-dashboard
AGENT_TOKEN=$AGENT_TOKEN
DASHBOARD_PASSWORD_HASH=$DASHBOARD_PASSWORD_HASH
SESSION_SECRET=$SESSION_SECRET
CF_ACCESS_TEAM_DOMAIN=$CF_ACCESS_TEAM_DOMAIN
CF_ACCESS_AUD=$CF_ACCESS_AUD
ENV
    if [ "$EDGE" = cloudflare ]; then echo "DASHBOARD_SCHEME=http://" >> .env.new; fi
    ;;
  *)
    echo "::error::ROLE must be apps or ops" >&2
    exit 1
    ;;
esac
if [ -n "$EDGE_ENV" ]; then printf '%s\n' "$EDGE_ENV" >> .env.new; fi
mv .env.new .env

# --- Host settings --------------------------------------------------------------------------
# cloud-init only runs on a server's first boot; this keeps existing servers in line with the
# repository. The deploy user's docker group is root-equivalent anyway, so a short-lived
# privileged container edits the host. sshd's config is validated before it is reloaded.
HOST_TOOLS=debian:13-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
SSHD_CONF="$(cat <<'SSHD'
# Managed by Spotcraft (infra/remote-deploy.sh and infra/cloud-init.yaml); edits are overwritten.
# Modern algorithms only; Debian's defaults also offer NIST curves and SHA-1 MACs as fallbacks.
KexAlgorithms mlkem768x25519-sha256,sntrup761x25519-sha512,sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
HostKeyAlgorithms ssh-ed25519,ssh-ed25519-cert-v01@openssh.com,rsa-sha2-512,rsa-sha2-256
PubkeyAcceptedAlgorithms ssh-ed25519,ssh-ed25519-cert-v01@openssh.com,sk-ssh-ed25519@openssh.com,rsa-sha2-512,rsa-sha2-256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes128-ctr
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
)"
printf '%s\n' "$SSHD_CONF" | docker run --rm -i --privileged --pid host --network none "$HOST_TOOLS" \
  nsenter -t 1 -m -u -i -n -- sh -c '
    target=/etc/ssh/sshd_config.d/50-spotcraft.conf
    new="$(cat)"
    [ "$(cat "$target" 2>/dev/null)" = "$new" ] && exit 0
    printf "%s\n" "$new" > "$target.new"
    mv "$target.new" "$target"
    if sshd -t; then systemctl reload ssh && echo "sshd: settings updated"
    else rm -f "$target"; echo "::error::sshd rejected the settings; left unchanged" >&2; exit 1
    fi'

# --- One-time migration: IPv6 on Caddy's network --------------------------------------------
# A network's IPv6 setting can't change in place. If the stack's network still lacks IPv6,
# take the stack down (volumes and certificates stay) so `up` recreates it; on the apps
# server, hosted apps are on that network too, so they stop first and start again after.
case "$ROLE" in
  apps) network=spotcraft-edge ;;
  ops) network=spotcraft-ops_default ;;
esac
migrate=false
if [ "$(docker network inspect -f '{{.EnableIPv6}}' "$network" 2>/dev/null)" = false ]; then
  migrate=true
  echo "Recreating $network with IPv6 (hosted apps pause for about a minute)"
  if [ "$ROLE" = apps ]; then
    for app in apps/*/compose.yaml; do
      [ -e "$app" ] && docker compose -f "$app" down
    done
  fi
  docker compose down
fi

docker compose config --quiet
docker compose pull --quiet
# Back to direct: cloudflared isn't an orphan (its profile is just off), so stop it explicitly.
if [ "$EDGE" = direct ]; then
  docker compose --profile cloudflare rm --stop --force cloudflared
fi
docker compose up -d --wait --wait-timeout 180 --remove-orphans

# The agent's Postgres role: created on the first deploy, its password kept in step with the
# secret on every deploy. It may create databases and roles, but is not a superuser. Running
# this again changes nothing. The password travels on psql's stdin (as a psql variable), never
# on a command line.
if [ "$ROLE" = apps ]; then
  {
    printf '\\set pw %s\n' "$POSTGRES_AGENT_PASSWORD"
    cat <<'SQL'
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotcraft_agent') AS missing \gset
\if :missing
  CREATE ROLE spotcraft_agent LOGIN CREATEDB CREATEROLE PASSWORD :'pw';
\else
  ALTER ROLE spotcraft_agent LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD :'pw';
\endif
-- Roles the agent creates (one per app) are ones it may SET ROLE to, which Postgres requires
-- to make them a database's owner; it doesn't inherit their rights.
ALTER ROLE spotcraft_agent SET createrole_self_grant = 'set';
-- Apps get CONNECT on their own database only; the built-in ones are the agent's.
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO spotcraft_agent;
SQL
  } | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres
fi

if [ "$migrate" = true ] && [ "$ROLE" = apps ]; then
  for app in apps/*/compose.yaml; do
    [ -e "$app" ] && docker compose -f "$app" up -d --wait --wait-timeout 180
  done
fi

docker compose ps --format 'table {{.Service}}\t{{.Status}}'

# Old image layers pile up with every deploy; keep a week's worth for rollbacks.
docker image prune -af --filter "until=168h" > /dev/null
