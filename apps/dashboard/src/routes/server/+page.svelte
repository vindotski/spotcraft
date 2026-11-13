<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import Sparkline from '#lib/components/Sparkline.svelte'
  import Stat from '#lib/components/Stat.svelte'
  import { bytes, duration, percent } from '#lib/format.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Server · Spotcraft</title></svelte:head>

<h1 class="mb-6 font-heading text-2xl font-bold">Server</h1>

{#if data.cpu === null && data.memory === null}
  <Alert class="mb-6">
    <AlertTitle>No metrics yet</AlertTitle>
    <AlertDescription>VictoriaMetrics has no data from the server yet. It appears a minute after Spotcraft starts.</AlertDescription>
  </Alert>
{/if}

<div class="grid gap-4 sm:grid-cols-2">
  <Stat label="CPU" value={percent(data.cpu)} detail="{data.cores ?? '—'} cores · load {data.load?.toFixed(2) ?? '—'}">
    <Sparkline series={data.cpuSeries} format={(v) => percent(v)} label="CPU, last hour" />
  </Stat>
  <Stat label="Memory" value={percent(data.memory)} detail="of {bytes(data.memoryTotal)}">
    <Sparkline series={data.memorySeries} format={(v) => percent(v)} label="Memory, last hour" />
  </Stat>
  <Stat label="Disk" value={percent(data.disk)} detail="of {bytes(data.diskTotal)} on /" />
  <Stat label="Up for" value={duration(data.uptime)} detail="since the last reboot" />
</div>
