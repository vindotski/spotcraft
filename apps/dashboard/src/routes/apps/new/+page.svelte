<script lang="ts">
  import AppForm from '#lib/components/AppForm.svelte'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  const empty = { name: '', image: '', tag: '', domain: '', port: '3000', memory: '512m', cpus: '1', readOnly: true, database: false, protected: false, env: '', takeOver: false }
</script>

<svelte:head><title>Add app · Spotcraft</title></svelte:head>

<a href="/" class="text-sm text-muted-foreground hover:text-foreground">← Apps</a>
<h1 class="mt-2 mb-6 font-heading text-2xl font-bold">Add app</h1>

<AppForm
  values={form?.values ?? empty}
  errors={form?.errors}
  deployError={form?.deployError ?? undefined}
  output={form?.output ?? undefined}
  withName
  submitLabel="Deploy"
  appsDomain={data.appsDomain}
  dns={data.dns}
  access={data.access}
/>
