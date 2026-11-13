<script lang="ts">
  import { Button } from '@spotcraft/ui/components/button'
  import GitHubIcon from '#lib/components/GitHubIcon.svelte'
  import { GITHUB } from '#lib/site.ts'

  const description =
    'Self-hosted deployment for a handful of web apps. Give it a Docker image and a domain; it runs the app behind HTTPS, watches it, and shows everything in one dashboard.'

  const strengths = [
    {
      title: 'Deploy from a form',
      text: 'Image, tag, domain, limits and environment variables. Recent tags come straight from Docker Hub.',
    },
    {
      title: 'An address for every app',
      text: 'Every app is live at its own subdomain the moment it deploys; a custom domain is one CNAME. HTTPS is automatic.',
    },
    {
      title: 'Rollback on failure',
      text: 'A deploy waits until the new container is healthy. If anything fails, the previous version keeps running.',
    },
    {
      title: 'Monitoring built in',
      text: 'Uptime and response time from outside, CPU and memory per app, host load, and every app’s logs.',
    },
    {
      title: 'Hardened by default',
      text: 'Apps run read-only, without Linux capabilities, with limits. Optionally behind Cloudflare, with the servers’ ports closed.',
    },
    {
      title: 'Your servers, your secrets',
      text: 'Two plain VPSes you own. Every secret lives in your GitHub environment, never in a file or an image.',
    },
  ]

  const steps = [
    {
      title: 'Create two servers',
      text: 'An OpenTofu module does it on Hetzner Cloud in one apply; any Debian or Ubuntu VPS works with the first-boot script.',
    },
    {
      title: 'Deploy Spotcraft',
      text: 'Fill in a GitHub environment and run the Deploy workflow. It sets up both servers and checks the dashboard from outside.',
    },
    {
      title: 'Add your apps',
      text: 'Log in and add an image. It’s live at its own subdomain; bring your own domain whenever you like.',
    },
  ]

  const stack = [
    { name: 'Caddy', href: 'https://caddyserver.com', role: 'HTTPS, certificates and the reverse proxy in front of every app.' },
    { name: 'Docker', href: 'https://www.docker.com', role: 'Every app is a container; every deploy is Docker Compose.' },
    { name: 'VictoriaMetrics', href: 'https://victoriametrics.com', role: 'Stores the metrics and uptime the dashboard draws.' },
    { name: 'SvelteKit', href: 'https://svelte.dev', role: 'The dashboard and this site.' },
    { name: 'Fastify', href: 'https://fastify.dev', role: 'The agent that deploys apps on the apps server.' },
    { name: 'OpenTofu', href: 'https://opentofu.org', role: 'Creates the servers on Hetzner and, optionally, the Cloudflare tunnels, DNS and Access.' },
  ]
</script>

<svelte:head>
  <title>Spotcraft: your apps, your servers</title>
  <meta name="description" content={description} />
</svelte:head>

<!-- Hero -->
<section class="border-b">
  <div class="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:pt-24">
    <h1 class="max-w-3xl font-heading text-4xl leading-tight font-bold tracking-tight text-balance sm:text-6xl">Your apps, your servers.</h1>
    <p class="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">{description}</p>
    <div class="mt-8 flex flex-wrap gap-3">
      <Button href="/docs/getting-started" size="lg">Get started</Button>
      <Button href={GITHUB} variant="outline" size="lg" rel="noopener noreferrer"><GitHubIcon /> GitHub</Button>
    </div>
    <picture>
      <source srcset="/screenshots/app-dark.webp" media="(prefers-color-scheme: dark)" />
      <img src="/screenshots/app-light.webp" alt="The Spotcraft dashboard showing an app's status, uptime, CPU, memory and response time, its settings, and its logs." width="1280" height="800" class="mt-14 w-full border shadow-sm" fetchpriority="high" />
    </picture>
  </div>
</section>

<!-- Statement -->
<section class="border-b">
  <div class="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:grid-cols-[1fr_2fr] sm:py-20">
    <h2 class="font-heading text-2xl font-bold sm:text-3xl">Small on purpose</h2>
    <div class="space-y-4 text-lg text-muted-foreground">
      <p>Spotcraft is for one person running about ten server-rendered apps on two servers they own. Not a platform, not a cluster.</p>
      <p>There is no build step (your CI publishes images), no database to look after (the app list is a folder of files), and nothing between your apps and the internet but Caddy.</p>
    </div>
  </div>
</section>

<!-- Core strengths -->
<section class="border-b">
  <div class="mx-auto max-w-6xl px-4 py-16 sm:py-20">
    <h2 class="font-heading text-2xl font-bold sm:text-3xl">What you get</h2>
    <ul class="mt-10 grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {#each strengths as item (item.title)}
        <li class="bg-background p-6">
          <h3 class="font-heading font-semibold">{item.title}</h3>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">{item.text}</p>
        </li>
      {/each}
    </ul>
  </div>
</section>

<!-- How it works -->
<section class="border-b">
  <div class="mx-auto max-w-6xl px-4 py-16 sm:py-20">
    <h2 class="font-heading text-2xl font-bold sm:text-3xl">How it works</h2>
    <p class="mt-4 max-w-2xl text-muted-foreground">Two servers on a private network. The ops server watches the apps server from the outside, so it can tell you when something is down.</p>

    <svg viewBox="0 0 640 260" class="mt-10 w-full max-w-3xl text-foreground" role="img" aria-labelledby="diagram-title">
      <title id="diagram-title">The apps server runs Caddy, the app containers, the agent and the exporters. The ops server runs Caddy, the dashboard, VictoriaMetrics and the uptime probes. The ops server calls the agent and scrapes the exporters over the private network; only Caddy on each server faces the internet.</title>
      <g font-family="inherit" font-size="13" fill="currentColor">
        <text x="320" y="16" text-anchor="middle" class="fill-muted-foreground">internet · 80 / 443</text>
        <path d="M150 24 V52 M490 24 V52" stroke="currentColor" stroke-width="1.5" />
        <rect x="20" y="52" width="260" height="168" fill="none" stroke="currentColor" stroke-width="1.5" />
        <text x="36" y="78" font-weight="700" font-size="14">apps server</text>
        <text x="36" y="106">Caddy (HTTPS)</text>
        <text x="36" y="128">your app containers</text>
        <text x="36" y="150">agent</text>
        <text x="36" y="172">node-exporter · cAdvisor</text>
        <rect x="360" y="52" width="260" height="168" fill="none" stroke="currentColor" stroke-width="1.5" />
        <text x="376" y="78" font-weight="700" font-size="14">ops server</text>
        <text x="376" y="106">Caddy → dashboard</text>
        <text x="376" y="128">VictoriaMetrics</text>
        <text x="376" y="150">vmagent · uptime probes</text>
        <path d="M360 146 H280 M288 140 L280 146 L288 152" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M360 168 H280 M288 162 L280 168 L288 174" fill="none" stroke="currentColor" stroke-width="1.5" />
        <text x="320" y="246" text-anchor="middle" class="fill-muted-foreground">private network</text>
        <path d="M150 220 V234 H490 V220" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4" />
      </g>
    </svg>

    <ol class="mt-12 grid gap-8 sm:grid-cols-3">
      {#each steps as step, index (step.title)}
        <li>
          <p class="font-mono text-sm text-muted-foreground">0{index + 1}</p>
          <h3 class="mt-1 font-heading font-semibold">{step.title}</h3>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
        </li>
      {/each}
    </ol>
  </div>
</section>

<!-- Built on -->
<section class="border-b">
  <div class="mx-auto max-w-6xl px-4 py-16 sm:py-20">
    <h2 class="font-heading text-2xl font-bold sm:text-3xl">Built on good tools</h2>
    <p class="mt-4 max-w-2xl text-muted-foreground">Spotcraft is mostly glue. The heavy lifting is done by software that is better at it than anything new would be.</p>
    <ul class="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
      {#each stack as tool (tool.name)}
        <li>
          <a href={tool.href} class="font-heading font-semibold underline-offset-4 hover:underline" rel="noopener noreferrer">{tool.name}</a>
          <p class="mt-1 text-sm text-muted-foreground">{tool.role}</p>
        </li>
      {/each}
    </ul>
  </div>
</section>

<!-- Closing call to action -->
<section>
  <div class="mx-auto max-w-6xl px-4 pt-20 text-center">
    <h2 class="font-heading text-3xl font-bold sm:text-4xl">Ready to run your own?</h2>
    <p class="mx-auto mt-4 max-w-xl text-muted-foreground">Two servers, one workflow run, then apps from a form. The guide takes about half an hour.</p>
    <div class="mt-8 flex flex-wrap justify-center gap-3">
      <Button href="/docs/getting-started" size="lg">Get started</Button>
      <Button href={GITHUB} variant="outline" size="lg" rel="noopener noreferrer"><GitHubIcon /> GitHub</Button>
    </div>
  </div>
</section>
