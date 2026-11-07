import { createHash, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyServerOptions } from 'fastify'
import type { AppSpec } from './app-spec.ts'
import { appBodySchema, nameParamsSchema, RESERVED_NAMES } from './app-spec.ts'
import { AgentError, type Apps } from './apps.ts'

export interface BuildOptions {
  token: string
  apps: Apps
  logger?: FastifyServerOptions['logger']
}

type AppBody = Omit<AppSpec, 'name'>
type NameParams = { name: string }

const digest = (value: string) => createHash('sha256').update(value).digest()

export function buildApp({ token, apps, logger = false }: BuildOptions) {
  const app = Fastify({
    logger,
    bodyLimit: 256 * 1024,
    // Reject unknown fields instead of silently dropping them (Fastify's default).
    ajv: { customOptions: { removeAdditional: false } },
  })
  const expected = digest(`Bearer ${token}`)

  // Every route but /health needs the dashboard's token. Comparing fixed-length digests in
  // constant time leaks neither the token nor its length.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return
    const given = digest(request.headers.authorization ?? '')
    if (!timingSafeEqual(given, expected)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AgentError) {
      request.log.warn({ output: error.output }, error.message)
      return reply.code(error.statusCode).send({ error: error.message, output: error.output })
    }
    const fastifyError = error as { validation?: unknown; message?: string; statusCode?: number }
    if (fastifyError.validation) {
      return reply.code(400).send({ error: fastifyError.message })
    }
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({ error: fastifyError.message })
    }
    request.log.error(error)
    return reply.code(500).send({ error: 'Internal error' })
  })

  app.get('/health', async () => ({ ok: true }))

  app.get('/apps', async () => ({ apps: await apps.list() }))

  app.get<{ Params: NameParams }>(
    '/apps/:name',
    { schema: { params: nameParamsSchema } },
    async (request, reply) => {
      const found = await apps.get(request.params.name)
      return found ?? reply.code(404).send({ error: 'No such app' })
    },
  )

  app.put<{ Params: NameParams; Body: AppBody }>(
    '/apps/:name',
    { schema: { params: nameParamsSchema, body: appBodySchema } },
    async (request, reply) => {
      const { name } = request.params
      if (RESERVED_NAMES.has(name)) {
        return reply.code(400).send({ error: `"${name}" is reserved` })
      }
      const taken = (await apps.list()).find(
        (other) => other.name !== name && other.domain === request.body.domain,
      )
      if (taken) {
        return reply.code(409).send({ error: `${request.body.domain} is used by ${taken.name}` })
      }
      return apps.deploy({ name, ...request.body })
    },
  )

  app.delete<{ Params: NameParams }>(
    '/apps/:name',
    { schema: { params: nameParamsSchema } },
    async (request, reply) => {
      const removed = await apps.remove(request.params.name)
      return removed ? reply.code(204).send() : reply.code(404).send({ error: 'No such app' })
    },
  )

  app.get<{ Params: NameParams; Querystring: { tail: number } }>(
    '/apps/:name/logs',
    {
      schema: {
        params: nameParamsSchema,
        querystring: {
          type: 'object',
          properties: { tail: { type: 'integer', minimum: 1, maximum: 5000, default: 200 } },
        },
      },
    },
    async (request, reply) => {
      const logs = await apps.logs(request.params.name, request.query.tail)
      if (logs === undefined) return reply.code(404).send({ error: 'No such app' })
      return reply.type('text/plain; charset=utf-8').send(logs)
    },
  )

  return app
}
