<script lang="ts">
  import { clock } from '#lib/format.ts'

  interface Props {
    /** [unix seconds, value] points. */
    series: Array<[number, number]>
    format: (value: number) => string
    /** What the line shows, for screen readers. */
    label: string
  }

  let { series, format, label }: Props = $props()

  const WIDTH = 240
  const HEIGHT = 48
  const PAD = 3

  let hover = $state<number | null>(null)

  const geometry = $derived.by(() => {
    if (series.length < 2) return null
    const t0 = series[0][0]
    const t1 = series[series.length - 1][0]
    const max = Math.max(...series.map(([, v]) => v))
    const top = max > 0 ? max * 1.1 : 1
    const x = (t: number) => PAD + ((t - t0) / (t1 - t0 || 1)) * (WIDTH - 2 * PAD)
    const y = (v: number) => HEIGHT - PAD - (v / top) * (HEIGHT - 2 * PAD)
    const points = series.map(([t, v]) => [x(t), y(v)] as const)
    const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
    return { points, line }
  })

  const summary = $derived(
    series.length
      ? `${label}: now ${format(series[series.length - 1][1])}, peak ${format(Math.max(...series.map(([, v]) => v)))}`
      : `${label}: no data`,
  )

  function onpointermove(event: PointerEvent) {
    if (!geometry) return
    const box = (event.currentTarget as SVGElement).getBoundingClientRect()
    const px = ((event.clientX - box.left) / box.width) * WIDTH
    let nearest = 0
    for (let i = 1; i < geometry.points.length; i++) {
      if (Math.abs(geometry.points[i][0] - px) < Math.abs(geometry.points[nearest][0] - px)) nearest = i
    }
    hover = nearest
  }
</script>

<div class="relative">
  {#if geometry}
    <svg
      viewBox="0 0 {WIDTH} {HEIGHT}"
      class="h-12 w-full overflow-visible text-foreground"
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
      {onpointermove}
      onpointerleave={() => (hover = null)}
    >
      <path d={geometry.line} fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      {#if hover !== null}
        {@const [hx, hy] = geometry.points[hover]}
        <line x1={hx} x2={hx} y1="0" y2={HEIGHT} class="stroke-muted-foreground" stroke-width="1" vector-effect="non-scaling-stroke" />
        <circle cx={hx} cy={hy} r="3" class="fill-foreground stroke-background" stroke-width="2" vector-effect="non-scaling-stroke" />
      {/if}
    </svg>
    <p class="mt-1 h-4 text-xs text-muted-foreground tabular-nums" aria-hidden="true">
      {#if hover !== null}
        {clock(series[hover][0])} · {format(series[hover][1])}
      {:else}
        Last hour
      {/if}
    </p>
  {:else}
    <p class="flex h-12 items-center text-xs text-muted-foreground">No data yet</p>
  {/if}
</div>
