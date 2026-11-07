<script lang="ts">
  import type { Snippet } from 'svelte'

  let { label, value, detail, children }: { label: string; value: string; detail?: string; children?: Snippet } =
    $props()
</script>

<div class="space-y-2 border p-4">
  <p class="text-sm text-muted-foreground">{label}</p>
  <p class="font-heading text-2xl font-semibold tabular-nums">{value}</p>
  {#if detail}<p class="text-xs text-muted-foreground">{detail}</p>{/if}
  {@render children?.()}
</div>
