<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import * as AlertDialog from '@spotcraft/ui/components/alert-dialog'
  import { Button, buttonVariants } from '@spotcraft/ui/components/button'
  import Sparkline from '#lib/components/Sparkline.svelte'
  import Stat from '#lib/components/Stat.svelte'
  import StatusBadge from '#lib/components/StatusBadge.svelte'
  import { bytes, milliseconds, percent, uptime } from '#lib/format.ts'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  const app = $derived(data.app)
  const m = $derived(data.metrics)
  const last = (series: Array<[number, number]>) => (series.length ? series[series.length - 1][1] : null)
  let redeploying = $state(false)

  const stateLabel = { active: 'Active', pending: 'Pending', missing: 'Missing', unknown: 'Not checked' }
  const modeLabel = { zone: 'DNS by Spotcraft', saas: 'Cloudflare custom hostname', manual: 'DNS set by hand' }
  let purge = $state(false)

  // A GitHub Actions step for the app's workflow, after its image is pushed (ADR 0029).
  const hookStep = $derived(`- name: Deploy to Spotcraft
  env:
    URL: ${data.hook.url}
    TOKEN: \${{ secrets.SPOTCRAFT_DEPLOY_TOKEN }}
  run: |
    TAG="sha-\${GITHUB_SHA::7}"
    auth="Authorization: Bearer $TOKEN"
    curl -fsS -X POST "$URL" -H "$auth" -H 'content-type: application/json' -d "{\\"tag\\":\\"$TAG\\"}"
    for _ in $(seq 60); do
      result=$(curl -fsS "$URL" -H "$auth")
      case $(echo "$result" | jq -r '.state + " " + .tag') in
        "live $TAG") exit 0 ;;
        live*) echo "Another tag is live: $result"; exit 1 ;;
        failed*) echo "$result"; exit 1 ;;
      esac
      sleep 5
    done
    echo "Still deploying after 5 minutes"; exit 1`)
</script>

<svelte:head><title>{app.name} · Spotcraft</title></svelte:head>

<a href="/" class="text-sm text-muted-foreground hover:text-foreground">← Apps</a>

<div class="mt-2 mb-6 flex flex-wrap items-start justify-between gap-4">
  <div>
    <div class="flex items-center gap-3">
      <h1 class="font-heading text-2xl font-bold">{app.name}</h1>
      <StatusBadge state={app.state} health={app.health} />
    </div>
    <p class="mt-1 text-sm text-muted-foreground">
      {#each app.hostnames as host (host)}
        <a href="https://{host}" class="hover:underline" target="_blank" rel="noopener noreferrer">{host}</a><span aria-hidden="true" class="px-1">·</span>
      {/each}
      <span class="font-mono">{app.image}:{app.tag}</span>
      {#if app.status}· {app.status}{/if}
    </p>
  </div>
  <div class="flex gap-2">
    {#if app.database}<Button href="/apps/{app.name}/users" variant="outline">Users</Button>{/if}
    <Button href="/apps/{app.name}/edit" variant="outline">Edit</Button>
    <form
      method="POST"
      action="?/redeploy"
      use:enhance={() => {
        redeploying = true
        return async ({ update }) => {
          await update()
          redeploying = false
        }
      }}
    >
      <Button type="submit" variant="outline" disabled={redeploying}>{redeploying ? 'Redeploying…' : 'Redeploy'}</Button>
    </form>
    <AlertDialog.Root>
      <AlertDialog.Trigger class={buttonVariants({ variant: 'destructive' })}>Remove</AlertDialog.Trigger>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Remove {app.name}?</AlertDialog.Title>
          <AlertDialog.Description>
            Stops the container and removes its settings and its site. {app.hostnames.join(' and ')} stop answering. The image stays on Docker Hub, so you can add it again.
            {#if app.database}
              Its database is kept, so adding the app again brings its data back, unless you delete it below.
            {/if}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <form id="remove-app" method="POST" action="?/remove">
          {#if app.database}
            <label class="flex items-start gap-3 text-sm">
              <input type="checkbox" name="purge" bind:checked={purge} class="mt-1 size-4 accent-destructive" />
              <span>
                Also delete its database
                <span class="block text-xs text-muted-foreground">Every row in app_{app.name.replaceAll('-', '_')} is lost. This cannot be undone.</span>
              </span>
            </label>
          {/if}
        </form>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <Button type="submit" form="remove-app" variant="destructive">
            {purge ? `Remove ${app.name} and its data` : `Remove ${app.name}`}
          </Button>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </div>
</div>

{#if form && 'deployError' in form}
  <Alert variant="destructive" class="mb-6">
    <AlertTitle>Redeploy failed</AlertTitle>
    <AlertDescription>
      <p>{form.deployError}. The previous version is still running.</p>
      {#if form.output}<pre class="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">{form.output}</pre>{/if}
    </AlertDescription>
  </Alert>
{:else if form && 'redeployed' in form}
  <Alert class="mb-6"><AlertTitle>Redeployed</AlertTitle></Alert>
{/if}

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <Stat label="Reachable now" value={m.up === null ? '—' : m.up === 1 ? 'Yes' : 'No'} detail={app.protected ? "Every address, probed over the internet, up to the Access sign-in" : "Every address, checked over HTTPS through the internet"} />
  <Stat label="Uptime" value={uptime(m.uptimeDay)} detail="Last 24 hours · 7 days: {uptime(m.uptimeWeek)}" />
  <Stat label="CPU" value={percent(last(m.cpu) === null ? null : (last(m.cpu) ?? 0) * 100, 1)} detail="of one core · limit {app.cpus}">
    <Sparkline series={m.cpu.map(([t, v]) => [t, v * 100] as [number, number])} format={(v) => percent(v, 1)} label="CPU, last hour" />
  </Stat>
  <Stat label="Memory" value={bytes(last(m.memory))} detail="limit {app.memory}">
    <Sparkline series={m.memory} format={bytes} label="Memory, last hour" />
  </Stat>
</div>

<div class="mt-4 grid gap-4 sm:grid-cols-2">
  <Stat label="Response time" value={milliseconds(last(m.response))} detail="Full HTTPS request, over the internet">
    <Sparkline series={m.response} format={milliseconds} label="Response time, last hour" />
  </Stat>
  <div class="space-y-2 border p-4 text-sm">
    <p class="text-muted-foreground">Settings</p>
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt class="text-muted-foreground">Port</dt><dd class="tabular-nums">{app.port}</dd>
      <dt class="text-muted-foreground">Filesystem</dt><dd>{app.readOnly ? 'Read-only' : 'Writable'}</dd>
      <dt class="text-muted-foreground">Database</dt>
      <dd>
        {#if app.database}Postgres <span class="font-mono">app_{app.name.replaceAll('-', '_')}</span>{:else}None{/if}
      </dd>
      <dt class="text-muted-foreground">Sign-in</dt><dd>{app.protected ? 'Cloudflare Access' : 'Public'}</dd>
      <dt class="text-muted-foreground">Environment</dt><dd>{Object.keys(app.env).length === 1 ? '1 variable' : `${Object.keys(app.env).length} variables`}</dd>
    </dl>
  </div>
</div>

{#if data.hook.enabled !== undefined}
  {@const token = form && 'hookToken' in form ? form.hookToken : undefined}
  {@const enabled = token ? true : form && 'hookDeleted' in form ? false : data.hook.enabled}
  <section class="mt-8">
    <h2 class="mb-2 font-heading text-lg font-semibold">Deploy hook</h2>
    <div class="space-y-3 border p-4 text-sm">
      <p class="text-muted-foreground">
        Lets the app's CI deploy a new image tag, with no sign-in. Only the tag changes: the image, environment and limits stay as set here.
        {enabled ? 'On.' : 'Off.'}
      </p>
      {#if token}
        <Alert>
          <AlertTitle>Your new token, shown only once</AlertTitle>
          <AlertDescription>
            <p>Save it as the secret <span class="font-mono">SPOTCRAFT_DEPLOY_TOKEN</span> in the app's repository. Any older token no longer works.</p>
            <pre class="mt-2 overflow-x-auto border bg-muted p-2 font-mono text-xs select-all">{token}</pre>
          </AlertDescription>
        </Alert>
      {/if}
      <div class="flex flex-wrap gap-2">
        <form method="POST" action="?/createHook" use:enhance>
          <Button type="submit" variant="outline">{enabled ? 'New token' : 'Turn on'}</Button>
        </form>
        {#if enabled}
          <form method="POST" action="?/deleteHook" use:enhance>
            <Button type="submit" variant="outline">Turn off</Button>
          </form>
        {/if}
      </div>
      {#if enabled}
        <p class="text-muted-foreground">A step for the app's GitHub Actions workflow, after it pushes the image. It deploys the commit's <span class="font-mono">sha-…</span> tag and waits until it is live:</p>
        <pre class="overflow-x-auto border bg-muted p-3 text-xs leading-relaxed">{hookStep}</pre>
      {/if}
    </div>
  </section>
{/if}

{#await data.domain then domain}
{#if domain && domain.hosts.length > 0}
  <section class="mt-8">
    <h2 class="mb-2 font-heading text-lg font-semibold">Domain</h2>
    <ul class="space-y-3">
      {#each domain.hosts as host (host.host)}
        <li class="border p-4 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-mono">{host.host}</span>
            <span class={['text-xs', host.state === 'active' ? 'text-muted-foreground' : 'text-destructive']}>
              {stateLabel[host.state]} · {modeLabel[host.mode]}
            </span>
          </div>
          {#if host.detail}<p class="mt-1 text-xs text-muted-foreground">{host.detail}</p>{/if}
          {#if host.state !== 'active' && host.records.length > 0}
            <p class="mt-3 text-xs text-muted-foreground">Add these records where the domain's DNS is hosted:</p>
            <div class="mt-1 overflow-x-auto">
              <table class="w-full text-left font-mono text-xs">
                <tbody>
                  {#each host.records as record (record.type + record.name)}
                    <tr>
                      <td class="py-1 pr-4">{record.type}</td>
                      <td class="py-1 pr-4 break-all">{record.name}</td>
                      <td class="py-1 break-all">{record.value}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {#if host.mode === 'saas' && host.host.split('.').length === 2}
              <p class="mt-2 text-xs text-muted-foreground">A root domain needs CNAME flattening (or an ALIAS record) at its DNS provider.</p>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
{/await}

<section class="mt-8">
  <h2 class="mb-2 font-heading text-lg font-semibold">Logs</h2>
  <p class="mb-2 text-xs text-muted-foreground">Last 200 lines, newest at the bottom. Reload the page for newer lines.</p>
  <pre class="max-h-[32rem] overflow-auto border bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap">{data.logs || 'No logs yet.'}</pre>
</section>
