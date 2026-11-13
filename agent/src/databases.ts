import { appDatabaseName, provision, purge } from '@spotcraft/kit/provision'
import pg from 'pg'
import { AgentError, type AppUser, type Databases } from './apps.ts'

/** Keyset cursor for user pages: the last row's creation time and id. */
const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url')

function decodeCursor(cursor: string): [string, string] {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|')
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new AgentError('Invalid cursor', 400)
  }
  return [createdAt, id]
}

/**
 * App databases on the server's Postgres, managed as the agent's role (`adminUrl`, e.g.
 * `postgres://spotcraft_agent:…@postgres:5432/postgres`). Apps reach the same server by the
 * same host name, on the network they share with it.
 */
export function postgresDatabases(adminUrl: string): Databases {
  const appUrl = (name: string, user?: { name: string; password: string }) => {
    const url = new URL(adminUrl)
    if (user) {
      url.username = user.name
      url.password = user.password
    }
    url.pathname = `/${appDatabaseName(name)}`
    url.search = ''
    return url.toString()
  }

  /** Runs `fn` connected to the app's database as the agent, which owns `auth`. */
  async function inAppDatabase<T>(name: string, fn: (client: pg.Client) => Promise<T>) {
    const client = new pg.Client({ connectionString: appUrl(name) })
    await client.connect()
    try {
      return await fn(client)
    } finally {
      await client.end()
    }
  }

  return {
    async provision(name, password) {
      await provision(adminUrl, { name, password })
      return appUrl(name, { name: appDatabaseName(name), password })
    },

    purge: (name) => purge(adminUrl, name),

    listUsers: (name, { limit, cursor }) =>
      inAppDatabase(name, async (db) => {
        const found = await db.query<{ ok: boolean }>(
          `SELECT to_regclass('auth.users') IS NOT NULL AS ok`,
        )
        if (!found.rows[0]?.ok) return { available: false, total: 0, users: [] }
        const after = cursor ? decodeCursor(cursor) : null
        const { rows } = await db.query<{
          id: string
          is_anonymous: boolean
          created_at: Date
          last_seen: Date | null
        }>(
          `SELECT u.id, u.is_anonymous, u.created_at, max(s.updated_at) AS last_seen
           FROM auth.users u LEFT JOIN auth.sessions s ON s.user_id = u.id
           WHERE $1::timestamptz IS NULL OR (u.created_at, u.id) < ($1::timestamptz, $2::uuid)
           GROUP BY u.id
           ORDER BY u.created_at DESC, u.id DESC
           LIMIT $3`,
          [after?.[0] ?? null, after?.[1] ?? null, limit + 1],
        )
        const total = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth.users')
        const page = rows.slice(0, limit)
        const users: AppUser[] = page.map((row) => ({
          id: row.id,
          guest: row.is_anonymous,
          createdAt: row.created_at.toISOString(),
          lastSeen: row.last_seen?.toISOString() ?? null,
        }))
        const last = page.at(-1)
        return {
          available: true,
          total: total.rows[0]?.n ?? 0,
          users,
          ...(rows.length > limit && last ? { next: encodeCursor(last.created_at, last.id) } : {}),
        }
      }),

    deleteUser: (name, id) =>
      inAppDatabase(name, async (db) => {
        // Sessions, accounts and the app's own rows go through their foreign-key cascades.
        const deleted = await db.query('DELETE FROM auth.users WHERE id = $1', [id])
        return (deleted.rowCount ?? 0) > 0
      }),
  }
}
