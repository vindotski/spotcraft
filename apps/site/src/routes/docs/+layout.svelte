<script lang="ts">
  import { NAV } from '#lib/docs.ts'
  import { VERSION } from '#lib/site.ts'
  import { page } from '$app/state'
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()

  const active = (slug: string) => {
    const path = page.url.pathname
    return path === `/docs/${slug}` || path.startsWith(`/docs/${slug}/`)
  }
</script>

<div class="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[13rem_1fr] lg:py-14">
  <aside class="lg:sticky lg:top-24 lg:self-start">
    <p class="font-mono text-xs text-muted-foreground">Docs for v{VERSION}</p>
    <nav aria-label="Docs" class="mt-3">
      <ul class="flex flex-wrap gap-x-5 gap-y-2 text-sm lg:flex-col lg:gap-2">
        {#each NAV as item (item.slug)}
          <li>
            <a href="/docs/{item.slug}" class={active(item.slug) ? 'font-medium' : 'text-muted-foreground hover:text-foreground'} aria-current={active(item.slug) ? 'page' : undefined}>{item.label}</a>
          </li>
        {/each}
      </ul>
    </nav>
  </aside>
  <div class="min-w-0">
    {@render children()}
  </div>
</div>
