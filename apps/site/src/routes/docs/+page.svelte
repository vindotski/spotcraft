<script lang="ts">
  import { VERSION } from '#lib/site.ts'

  const sections = [
    { slug: 'getting-started', title: 'Getting started', text: 'Create the servers, deploy Spotcraft, add your first app, upgrade and roll back.' },
    { slug: 'security', title: 'Security model', text: 'What Spotcraft trusts, where its boundaries are, and the risks it accepts.' },
    { slug: 'decisions', title: 'Decisions', text: 'Why Spotcraft is built the way it is, one record per decision.' },
    { slug: 'changelog', title: 'Changelog', text: 'What changed in each release, and how to upgrade across breaking changes.' },
  ]
</script>

<svelte:head>
  <title>Docs · Spotcraft</title>
  <meta name="description" content="Spotcraft documentation for v{VERSION}." />
</svelte:head>

<h1 class="font-heading text-3xl font-bold">Docs</h1>
<p class="mt-3 text-muted-foreground">For Spotcraft v{VERSION}. Older versions’ docs are the docs folder at their tags on GitHub.</p>
<ul class="mt-10 grid gap-px border bg-border sm:grid-cols-2">
  {#each sections as section (section.slug)}
    <li class="bg-background">
      <a href="/docs/{section.slug}" class="block h-full p-6 hover:bg-muted">
        <span class="font-heading font-semibold">{section.title}</span>
        <span class="mt-2 block text-sm text-muted-foreground">{section.text}</span>
      </a>
    </li>
  {/each}
</ul>
