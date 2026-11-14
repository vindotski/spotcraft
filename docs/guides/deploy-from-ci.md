# Deploy from CI

An app's CI can deploy each image it builds, through the app's **deploy hook**
([ADR 0029](../decisions/0029-deploy-hook.md)). The hook changes only the image tag. The image,
environment, limits and domain stay as set in the dashboard.

Deploys have no downtime: the new version starts next to the running one and takes traffic once
it is healthy ([ADR 0028](../decisions/0028-zero-downtime-deploys.md)). So for a few seconds
both run against the app's database, and its migrations must only add.

## Turn the hook on

1. In the dashboard, open the app and find **Deploy hook**. Choose **Turn on**.
2. Copy the token. It is shown only once.
3. In the app's GitHub repository, add it as the secret `SPOTCRAFT_DEPLOY_TOKEN` (Settings →
   Secrets and variables → Actions). If the job runs in an environment, such as `production`,
   add it to that environment.

**New token** makes another one and stops the old one at once. **Turn off** stops the hook.

## The workflow step

Add this step after the one that pushes the image. The dashboard's app page shows it with your
app's address filled in.

```yaml
- name: Deploy to Spotcraft
  timeout-minutes: 20
  env:
    URL: https://dash.example.com/hooks/deploy/blog
    TOKEN: ${{ secrets.SPOTCRAFT_DEPLOY_TOKEN }}
    # A pull may take 5 minutes and the health check 2, after other apps' deploys.
    WAIT_MINUTES: 15
  run: |
    TAG="sha-${GITHUB_SHA::7}"
    auth="Authorization: Bearer $TOKEN"
    curl -fsS --retry 5 --retry-all-errors -X POST "$URL" -H "$auth" \
      -H 'content-type: application/json' -d "{\"tag\":\"$TAG\"}"
    deadline=$((SECONDS + WAIT_MINUTES * 60))
    while [ "$SECONDS" -lt "$deadline" ]; do
      sleep 5
      # A failed poll (Spotcraft restarting, a network blip) is tried again.
      result=$(curl -fsS "$URL" -H "$auth") || continue
      case $(echo "$result" | jq -r '.state + " " + .tag') in
        "live $TAG") exit 0 ;;
        live*) echo "Another tag is live: $result"; exit 1 ;;
        failed*) echo "$result"; exit 1 ;;
      esac
    done
    echo "Not live after $WAIT_MINUTES minutes"; exit 1
```

It deploys the tag `sha-<first 7 characters of the commit>`. That is the tag
`docker/metadata-action` makes with `type=sha,format=short`. Change `TAG` if your images are
tagged differently.

It waits up to `WAIT_MINUTES` (15) for the release: the image pull may take up to 5 minutes
and the health check 2, and other apps' deploys may come first. A poll that fails (Spotcraft
restarting, a network blip) is tried again, and the POST is retried a few times.

It succeeds only when its own tag is live. If a newer run's tag went live first, or Spotcraft
restarted and the old tag still runs, it fails and says which tag is live. To keep runs from
overlapping, give the job a concurrency group:

```yaml
concurrency:
  group: deploy
  cancel-in-progress: false
```

Only one release per app waits at a time. If a newer one comes in while one is waiting, the
newer tag is deployed instead, after anything queued in the meantime.

To approve each deploy, put the job in an environment with required reviewers.

## The API

Both calls take `Authorization: Bearer <token>`.

| Call                           | Answer                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `POST` with `{"tag": "<tag>"}` | `202 {"state": "deploying", "tag", "at"}`: the deploy started |
| `GET`                          | `200` with the last release's `state`, `tag` and `at`         |

`state` is one of:

- `deploying`: still running;
- `live`: the new version serves;
- `failed`: the previous version still serves, and `error` says why. The command output, such
  as the app's last log lines, is in the agent's log (`docker compose logs agent` on the server).

A wrong, old or missing token, or an app that doesn't exist, gets `401`. A body that isn't JSON gets
`415`, and a bad tag `400`. While Spotcraft is restarting, the answer is `503`; try again.

After Spotcraft restarts, or once the dashboard has deployed the app, `GET` reports `live` with
the tag that is running, as it no longer knows about earlier releases. Until Spotcraft has
finished starting, that answer is `503`.
