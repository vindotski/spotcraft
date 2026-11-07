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
#   ops:  APPS_PRIVATE_IP, DASHBOARD_DOMAIN, DASHBOARD_PASSWORD_HASH, SESSION_SECRET
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

require ROLE SPOTCRAFT_TAG IMAGE_NAMESPACE AGENT_TOKEN

# Only the deploy user can read the file with the secrets.
umask 077
case "$ROLE" in
  apps)
    require PRIVATE_IP
    DOCKER_GID="$(getent group docker | cut -d: -f3)"
    cat > .env.new <<ENV
PRIVATE_IP=$PRIVATE_IP
SPOTCRAFT_TAG=$SPOTCRAFT_TAG
SPOTCRAFT_AGENT_IMAGE=$IMAGE_NAMESPACE/spotcraft-agent
AGENT_TOKEN=$AGENT_TOKEN
DOCKER_GID=$DOCKER_GID
ENV
    ;;
  ops)
    require APPS_PRIVATE_IP DASHBOARD_DOMAIN DASHBOARD_PASSWORD_HASH SESSION_SECRET
    cat > .env.new <<ENV
DASHBOARD_DOMAIN=$DASHBOARD_DOMAIN
APPS_PRIVATE_IP=$APPS_PRIVATE_IP
SPOTCRAFT_TAG=$SPOTCRAFT_TAG
SPOTCRAFT_DASHBOARD_IMAGE=$IMAGE_NAMESPACE/spotcraft-dashboard
AGENT_TOKEN=$AGENT_TOKEN
DASHBOARD_PASSWORD_HASH=$DASHBOARD_PASSWORD_HASH
SESSION_SECRET=$SESSION_SECRET
ENV
    ;;
  *)
    echo "::error::ROLE must be apps or ops" >&2
    exit 1
    ;;
esac
mv .env.new .env

docker compose config --quiet
docker compose pull --quiet
docker compose up -d --wait --wait-timeout 180 --remove-orphans
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

# Old image layers pile up with every deploy; keep a week's worth for rollbacks.
docker image prune -af --filter "until=168h" > /dev/null
