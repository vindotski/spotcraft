<script lang="ts">
  import AppForm from '#lib/components/AppForm.svelte'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()
</script>

<svelte:head><title>Edit {data.values.name} · Spotcraft</title></svelte:head>

<a href="/apps/{data.values.name}" class="text-sm text-muted-foreground hover:text-foreground">← {data.values.name}</a>
<h1 class="mt-2 mb-6 font-heading text-2xl font-bold">Edit {data.values.name}</h1>

<AppForm
  values={form?.values ?? data.values}
  errors={form?.errors}
  deployError={form?.deployError ?? undefined}
  output={form?.output ?? undefined}
  withName={false}
  tags={data.tags}
  submitLabel="Save and deploy"
  appsDomain={data.appsDomain}
  dns={data.dns}
  access={data.access}
/>
