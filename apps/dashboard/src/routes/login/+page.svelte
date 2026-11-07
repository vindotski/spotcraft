<script lang="ts">
  import { Button } from '@spotcraft/ui/components/button'
  import * as Card from '@spotcraft/ui/components/card'
  import { Input } from '@spotcraft/ui/components/input'
  import { Label } from '@spotcraft/ui/components/label'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'

  let { form }: PageProps = $props()
</script>

<svelte:head><title>Log in · Spotcraft</title></svelte:head>

<div class="mx-auto mt-16 max-w-sm">
  <Card.Root>
    <Card.Header>
      <Card.Title class="font-heading text-xl">Spotcraft</Card.Title>
      <Card.Description>Log in to manage your apps.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input id="password" name="password" type="password" autocomplete="current-password" required aria-invalid={form?.error ? true : undefined} aria-describedby={form?.error ? 'login-error' : undefined} />
          {#if form?.error}<p id="login-error" class="text-sm text-destructive" role="alert">{form.error}</p>{/if}
        </div>
        <Button type="submit" class="w-full">Log in</Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
