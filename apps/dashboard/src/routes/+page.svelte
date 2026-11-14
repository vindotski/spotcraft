<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import * as Table from '@spotcraft/ui/components/table'
  import { backupHealth } from '#lib/backup.ts'
  import StatusBadge from '#lib/components/StatusBadge.svelte'
  import { ago, uptime } from '#lib/format.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const backupLabel = { ok: 'Backed up', failed: 'Failed', overdue: 'Overdue', none: 'None yet' }
</script>

<svelte:head><title>Apps · Spotcraft</title></svelte:head>

<div class="mb-6 flex items-center justify-between gap-4">
  <h1 class="font-heading text-2xl font-bold">Apps</h1>
  <Button href="/apps/new">Add app</Button>
</div>

{#if data.agentError}
  <Alert variant="destructive" class="mb-6">
    <AlertTitle>Can't reach the agent</AlertTitle>
    <AlertDescription>{data.agentError}. Apps keep running; this page can't show or change them until the agent answers.</AlertDescription>
  </Alert>
{:else if data.apps.length === 0}
  <div class="border p-10 text-center">
    <p class="font-medium">No apps yet</p>
    <p class="mt-1 text-sm text-muted-foreground">Add a Docker image and Spotcraft runs it behind HTTPS, on its own subdomain or your domain.</p>
    <Button href="/apps/new" class="mt-4">Add your first app</Button>
  </div>
{:else}
  {#if data.backups === 'unavailable'}
    <Alert variant="destructive" class="mb-4"><AlertTitle>Backup status unavailable</AlertTitle><AlertDescription>The agent couldn't say how the backups went. Check its log.</AlertDescription></Alert>
  {/if}
  <div class="overflow-x-auto border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>App</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head class="hidden sm:table-cell">Image</Table.Head>
          {#if data.backups && data.backups !== 'unavailable'}<Table.Head class="hidden md:table-cell">Backup</Table.Head>{/if}
          <Table.Head class="text-right">Uptime (24h)</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.apps as app (app.name)}
          <Table.Row>
            <Table.Cell>
              <a href="/apps/{app.name}" class="font-medium hover:underline">{app.name}</a>
              {@const host = app.domain ?? app.hostnames[0]}
              <a href="https://{host}" class="block text-xs text-muted-foreground hover:underline" rel="noopener noreferrer" target="_blank">{host}</a>
            </Table.Cell>
            <Table.Cell><StatusBadge state={app.state} health={app.health} /></Table.Cell>
            <Table.Cell class="hidden font-mono text-xs sm:table-cell">{app.image}:{app.tag}</Table.Cell>
            {#if data.backups && data.backups !== 'unavailable'}
              {@const backup = data.backups[app.name]}
              {@const health = backupHealth(backup)}
              <Table.Cell class="hidden text-xs md:table-cell">
                <span class={health === 'ok' ? 'text-muted-foreground' : 'text-destructive'}>{backupLabel[health]}</span>
                {#if backup?.lastOkAt}<span class="block text-muted-foreground">{ago(backup.lastOkAt)}</span>{/if}
              </Table.Cell>
            {/if}
            <Table.Cell class="text-right tabular-nums">{uptime(data.uptime[app.name])}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}
