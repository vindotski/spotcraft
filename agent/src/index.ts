import Fastify from 'fastify'

// Listens on the private network only; the dashboard on the ops server is its sole client.
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4000)

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

app.get('/health', async () => ({ ok: true }))

await app.listen({ host, port })
