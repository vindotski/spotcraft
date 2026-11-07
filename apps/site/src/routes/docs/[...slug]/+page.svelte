<script lang="ts">
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
  const page = $derived(data.page)
  const facts = $derived(
    [page.meta.status, page.meta.date].filter(Boolean).join(' · '),
  )
</script>

<svelte:head>
  <title>{page.title} · Spotcraft docs</title>
</svelte:head>

<article>
  <header class="mb-8">
    {#if page.meta.number}<p class="font-mono text-sm text-muted-foreground">Decision {page.meta.number.padStart(4, '0')}</p>{/if}
    <h1 class="font-heading text-3xl font-bold text-balance">{page.title}</h1>
    {#if facts}<p class="mt-2 text-sm text-muted-foreground capitalize">{facts}</p>{/if}
  </header>
  <div class="doc">
    <!-- The repository's own Markdown, rendered at build time. -->
    {@html page.html}
  </div>
  <p class="mt-12 border-t pt-4 text-sm text-muted-foreground">
    <a href={page.source} class="underline underline-offset-4" rel="noopener noreferrer">View this page on GitHub</a>
  </p>
</article>
