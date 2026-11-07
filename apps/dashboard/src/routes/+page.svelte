<script lang="ts">
  import { Button } from '@spotcraft/ui/components/button'
  import * as Card from '@spotcraft/ui/components/card'
</script>

<svelte:head>
  <title>Spotcraft dashboard</title>
</svelte:head>

<main class="mx-auto max-w-2xl p-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>Spotcraft dashboard</Card.Title>
      <Card.Description>Projects and monitoring will live here.</Card.Description>
    </Card.Header>
    <Card.Footer>
      <Button disabled>Add project</Button>
    </Card.Footer>
  </Card.Root>
</main>
