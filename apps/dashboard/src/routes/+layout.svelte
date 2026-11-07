<script lang="ts">
  import './layout.css'
  import favicon from '#lib/assets/favicon.svg'
  import { page } from '$app/state'
  import type { LayoutProps } from './$types'

  let { data, children }: LayoutProps = $props()

  const nav = [
    { href: '/', label: 'Apps' },
    { href: '/server', label: 'Server' },
  ]
  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' || page.url.pathname.startsWith('/apps') : page.url.pathname.startsWith(href)
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{#if data.authed}
  <header class="border-b">
    <div class="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
      <a href="/" class="font-heading font-bold">Spotcraft</a>
      <nav class="flex gap-4 text-sm">
        {#each nav as item (item.href)}
          <a href={item.href} class={isActive(item.href) ? 'font-medium' : 'text-muted-foreground hover:text-foreground'} aria-current={isActive(item.href) ? 'page' : undefined}>{item.label}</a>
        {/each}
      </nav>
      <form method="POST" action="/logout" class="ml-auto">
        <button type="submit" class="text-sm text-muted-foreground hover:text-foreground">Log out</button>
      </form>
    </div>
  </header>
{/if}

<main class="mx-auto max-w-5xl px-4 py-8">
  {@render children()}
</main>
