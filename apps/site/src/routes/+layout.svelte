<script lang="ts">
  import './layout.css'
  import favicon from '#lib/assets/favicon.svg'
  import SiteFooter from '#lib/components/SiteFooter.svelte'
  import SiteHeader from '#lib/components/SiteHeader.svelte'
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
</svelte:head>

<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:bg-background focus:p-2">Skip to content</a>
<SiteHeader />
<main id="main">
  {@render children()}
</main>
<SiteFooter />
