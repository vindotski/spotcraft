# @spotcraft/agent

Small Fastify service on the **apps server**. It will receive deploy commands from the
dashboard over the private network (token-authenticated), write each app's compose file
and Caddy site config, and run docker.

Current state: `GET /health` only.

| Env         | Default     | Meaning                                             |
| ----------- | ----------- | --------------------------------------------------- |
| `HOST`      | `127.0.0.1` | Bind address (the private-network IP in production) |
| `PORT`      | `4000`      | Listen port                                         |
| `LOG_LEVEL` | `info`      | Fastify/pino log level                              |

TypeScript runs directly on Node (type stripping), so there is no build step.
Image: `docker build -f agent/Dockerfile .` from the repository root.

```sh
pnpm --filter @spotcraft/agent start
pnpm --filter @spotcraft/agent typecheck
```
