<script lang="ts">
  import { Badge } from '@spotcraft/ui/components/badge'

  let { state, health }: { state: string; health: string } = $props()

  // Status is never color alone: every state has its own word.
  const view = $derived.by(() => {
    if (state === 'running' && health === 'unhealthy') return { label: 'Unhealthy', bad: true }
    if (state === 'running' && health === 'starting') return { label: 'Starting', bad: false }
    if (state === 'running') return { label: health === 'healthy' ? 'Healthy' : 'Running', bad: false }
    if (state === 'restarting') return { label: 'Restarting', bad: true }
    if (state === 'missing') return { label: 'Not running', bad: true }
    return { label: state.charAt(0).toUpperCase() + state.slice(1), bad: true }
  })
</script>

<Badge variant={view.bad ? 'destructive' : 'secondary'}>{view.label}</Badge>
