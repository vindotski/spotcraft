import { createHash, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyServerOptions } from 'fastify'
import type { AppBody } from './app-spec.ts'
import { appBodySchema, nameParamsSchema, RESERVED_NAMES } from './app-spec.ts'
import { AgentError, type Apps } from './apps.ts'

export interface BuildOptions {
  token: string
  apps: Apps
  /** Client addresses allowed to call the agent; empty allows any (tests, local runs). */
  allowedIps?: string[]
  logger?: FastifyServerOptions['logger']
}

/** `::ffff:10.0.0.3` (an IPv4 client on a dual-stack socket) is `10.0.0.3`. */
const normalizeIp = (ip: string) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip)

type NameParams = { name: string }

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

const digest = (value: string) => createHash('sha256').update(value).digest()

export function buildApp({ token, apps, allowedIps = [], logger = false }: BuildOptions) {
  const app = Fastify({
    logger,
    bodyLimit: 256 * 1024,
    // Reject unknown fields instead of silently dropping them (Fastify's default).
    ajv: { customOptions: { removeAdditional: false } },
  })
  const expected = digest(`Bearer ${token}`)
  // Loopback is the container itself (its health check); nothing outside can reach it.
  const allowed = new Set([...allowedIps.map(normalizeIp), '127.0.0.1', '::1'])

  // Only the dashboard's server may talk to the agent at all: a hosted app's container can
  // reach this port through the host, and must be turned away before the token is checked.
  app.addHook('onRequest', async (request, reply) => {
    if (allowedIps.length > 0 && !allowed.has(normalizeIp(request.ip))) {
      request.log.warn({ ip: request.ip }, 'refused: address not allowed')
      return reply.code(403).send({ error: 'Forbidden' })
    }
  })

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
      // Left out, `database` keeps its current value, so a client that doesn't know the field
      // (an older dashboard) never takes an app's database away by updating it.
      const current = await apps.get(name)
      const database = request.body.database ?? current?.database ?? false
      if (database && 'DATABASE_URL' in request.body.env) {
        return reply
          .code(400)
          .send({ error: 'DATABASE_URL is set by Spotcraft when the app has a database' })
      }
      const taken = (await apps.list()).find(
        (other) => other.name !== name && other.domain === request.body.domain,
      )
      if (taken) {
        return reply.code(409).send({ error: `${request.body.domain} is used by ${taken.name}` })
      }
      return apps.deploy({ name, ...request.body, database })
    },
  )

  app.delete<{ Params: NameParams; Querystring: { purge: boolean } }>(
    '/apps/:name',
    {
      schema: {
        params: nameParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { purge: { type: 'boolean', default: false } },
        },
      },
    },
    async (request, reply) => {
      const removed = await apps.remove(request.params.name, { purge: request.query.purge })
      return removed ? reply.code(204).send() : reply.code(404).send({ error: 'No such app' })
    },
  )

  // An app's users (ADR 0018), read and deleted in its own database's `auth` tables.
  app.get<{ Params: NameParams; Querystring: { limit: number; cursor?: string } }>(
    '/apps/:name/users',
    {
      schema: {
        params: nameParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            cursor: { type: 'string', maxLength: 200, pattern: '^[A-Za-z0-9_-]+$' },
          },
        },
      },
    },
    async (request) => apps.listUsers(request.params.name, request.query),
  )

  app.delete<{ Params: NameParams & { id: string } }>(
    '/apps/:name/users/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['name', 'id'],
          properties: {
            ...nameParamsSchema.properties,
            id: { type: 'string', pattern: UUID },
          },
        },
      },
    },
    async (request, reply) => {
      const deleted = await apps.deleteUser(request.params.name, request.params.id)
      return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'No such user' })
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
