# @spotcraft/dashboard

SvelteKit app (adapter-node) that runs on the **ops server**. It will list projects
(Docker Hub images), tell the agent on the apps server to deploy them, and show metrics
and logs from VictoriaMetrics and VictoriaLogs.

Current state: a placeholder page.

```sh
pnpm --filter @spotcraft/dashboard build      # output in build/
pnpm --filter @spotcraft/dashboard typecheck
```
