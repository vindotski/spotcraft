<script lang="ts">
  import { GITHUB, VERSION } from '#lib/site.ts'
  import { page } from '$app/state'
  import GitHubIcon from './GitHubIcon.svelte'

  const links = [
    { href: '/docs', label: 'Docs' },
    { href: '/docs/changelog', label: 'Changelog' },
  ]
  const current = (href: string) =>
    href === '/docs'
      ? page.url.pathname.startsWith('/docs') && !page.url.pathname.startsWith('/docs/changelog')
      : page.url.pathname.startsWith(href)
</script>

<header class="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
  <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
    <a href="/" class="font-heading text-lg font-bold tracking-tight" translate="no">Spotcraft</a>
    <a href="/docs/changelog" class="hidden border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground sm:inline">v{VERSION}</a>
    <nav class="ml-auto flex items-center gap-5 text-sm">
      {#each links as link (link.href)}
        <a href={link.href} class={current(link.href) ? 'font-medium' : 'text-muted-foreground hover:text-foreground'} aria-current={current(link.href) ? 'page' : undefined}>{link.label}</a>
      {/each}
      <a href={GITHUB} class="text-muted-foreground hover:text-foreground" rel="noopener noreferrer" aria-label="Spotcraft on GitHub">
        <GitHubIcon class="size-5" />
      </a>
    </nav>
  </div>
</header>
