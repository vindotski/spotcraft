<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import { Input } from '@spotcraft/ui/components/input'
  import { Label } from '@spotcraft/ui/components/label'
  import { Textarea } from '@spotcraft/ui/components/textarea'
  import { enhance } from '$app/forms'

  interface Values {
    name: string
    image: string
    tag: string
    domain: string
    port: string
    memory: string
    cpus: string
    readOnly: boolean
    database: boolean
    env: string
  }

  interface Props {
    values: Values
    errors?: Partial<Record<keyof Values, string>>
    deployError?: string
    output?: string
    /** New apps choose a name; existing ones keep theirs. */
    withName: boolean
    tags?: string[]
    submitLabel: string
  }

  let { values, errors = {}, deployError, output, withName, tags = [], submitLabel }: Props = $props()

  let submitting = $state(false)
  let suggestions = $state<string[]>([])
  const shownTags = $derived(suggestions.length ? suggestions : tags)

  async function loadTags(event: Event) {
    const image = (event.currentTarget as HTMLInputElement).value.trim()
    if (!image) return
    const response = await fetch(`/api/tags?image=${encodeURIComponent(image)}`)
    suggestions = response.ok ? ((await response.json()) as string[]) : []
  }
</script>

<form
  method="POST"
  class="space-y-6"
  use:enhance={() => {
    submitting = true
    return async ({ update }) => {
      await update({ reset: false })
      submitting = false
    }
  }}
>
  {#if deployError}
    <Alert variant="destructive">
      <AlertTitle>Deploy failed</AlertTitle>
      <AlertDescription>
        <p>{deployError}. The previous version, if any, is still running.</p>
        {#if output}
          <pre class="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">{output}</pre>
        {/if}
      </AlertDescription>
    </Alert>
  {/if}

  <div class="grid gap-4 sm:grid-cols-2">
    {#if withName}
      <div class="space-y-2 sm:col-span-2">
        <Label for="name">Name</Label>
        <Input id="name" name="name" value={values.name} required autocomplete="off" aria-invalid={errors.name ? true : undefined} aria-describedby="name-help" />
        <p id="name-help" class={['text-xs', errors.name ? 'text-destructive' : 'text-muted-foreground']}>
          {errors.name ?? 'Used for the container and in URLs here. Cannot be changed later.'}
        </p>
      </div>
    {/if}

    <div class="space-y-2">
      <Label for="image">Image</Label>
      <Input id="image" name="image" value={values.image} required placeholder="vindotski/tagtape" autocomplete="off" onchange={loadTags} aria-invalid={errors.image ? true : undefined} />
      {#if errors.image}<p class="text-xs text-destructive">{errors.image}</p>{/if}
    </div>

    <div class="space-y-2">
      <Label for="tag">Tag</Label>
      <Input id="tag" name="tag" value={values.tag} required placeholder="2.0.0" autocomplete="off" list="tag-options" aria-invalid={errors.tag ? true : undefined} />
      <datalist id="tag-options">
        {#each shownTags as tag (tag)}<option value={tag}></option>{/each}
      </datalist>
      <p class={['text-xs', errors.tag ? 'text-destructive' : 'text-muted-foreground']}>
        {errors.tag ?? (shownTags.length ? 'Recent tags from Docker Hub are suggested.' : 'Pick the image first to see recent tags.')}
      </p>
    </div>

    <div class="space-y-2">
      <Label for="domain">Domain</Label>
      <Input id="domain" name="domain" value={values.domain} required placeholder="example.com" autocomplete="off" aria-invalid={errors.domain ? true : undefined} />
      <p class={['text-xs', errors.domain ? 'text-destructive' : 'text-muted-foreground']}>
        {errors.domain ?? 'Point its DNS at the apps server. www. redirects here.'}
      </p>
    </div>

    <div class="space-y-2">
      <Label for="port">Container port</Label>
      <Input id="port" name="port" type="number" min="1" max="65535" value={values.port} required aria-invalid={errors.port ? true : undefined} />
      {#if errors.port}<p class="text-xs text-destructive">{errors.port}</p>{/if}
    </div>

    <div class="space-y-2">
      <Label for="memory">Memory limit</Label>
      <Input id="memory" name="memory" value={values.memory} required placeholder="512m" aria-invalid={errors.memory ? true : undefined} />
      {#if errors.memory}<p class="text-xs text-destructive">{errors.memory}</p>{/if}
    </div>

    <div class="space-y-2">
      <Label for="cpus">CPU limit</Label>
      <Input id="cpus" name="cpus" type="number" step="0.1" min="0.1" max="64" value={values.cpus} required aria-invalid={errors.cpus ? true : undefined} />
      {#if errors.cpus}<p class="text-xs text-destructive">{errors.cpus}</p>{/if}
    </div>

    <div class="space-y-2 sm:col-span-2">
      <Label for="env">Environment variables</Label>
      <Textarea id="env" name="env" value={values.env} rows={6} class="font-mono text-sm" placeholder={'LOG_LEVEL=info\nTRUST_PROXY=1'} spellcheck={false} aria-invalid={errors.env ? true : undefined} />
      <p class={['text-xs', errors.env ? 'text-destructive' : 'text-muted-foreground']}>
        {errors.env ?? 'One KEY=value per line. Lines starting with # are ignored.'}
      </p>
    </div>

    <label class="flex items-start gap-3 sm:col-span-2">
      <input type="checkbox" name="readOnly" checked={values.readOnly} class="mt-1 size-4 accent-foreground" />
      <span class="text-sm">
        Read-only filesystem
        <span class="block text-xs text-muted-foreground">Recommended. The app can still write to a small /tmp.</span>
      </span>
    </label>

    <label class="flex items-start gap-3 sm:col-span-2">
      <input type="checkbox" name="database" checked={values.database} class="mt-1 size-4 accent-foreground" />
      <span class="text-sm">
        Database
        <span class="block text-xs text-muted-foreground">
          Its own Postgres database on the apps server, given to the app as DATABASE_URL. Turning this off later keeps the data.
        </span>
      </span>
    </label>
  </div>

  <Button type="submit" disabled={submitting}>
    {submitting ? 'Deploying… (pulling and waiting for health)' : submitLabel}
  </Button>
</form>
