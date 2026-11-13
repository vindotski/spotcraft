import { defineEnvVars } from '@sveltejs/kit/env'
import { building } from '$app/env'

const required =
  (name: string, minLength = 1) =>
  (value: string | undefined) => {
    // Values are checked when the server starts, not while building the image.
    if (building) return value ?? ''
    if (!value || value.length < minLength) {
      throw new Error(
        `${name} must be set${minLength > 1 ? ` (at least ${minLength} characters)` : ''}`,
      )
    }
    return value
  }

export const variables = defineEnvVars({
  AGENT_URL: {
    description: 'Agent on the apps server, e.g. http://10.0.0.2:4000',
    schema: required('AGENT_URL'),
  },
  AGENT_TOKEN: {
    description: 'Bearer token shared with the agent',
    schema: required('AGENT_TOKEN', 32),
  },
  DASHBOARD_PASSWORD_HASH: {
    description: 'Admin password hash from `pnpm --filter @spotcraft/dashboard hash-password`',
    schema: (value) => {
      if (building) return value ?? ''
      if (!value?.startsWith('scrypt:')) {
        throw new Error('DASHBOARD_PASSWORD_HASH must be set (run the hash-password script)')
      }
      return value
    },
  },
  SESSION_SECRET: {
    description: 'Signs session cookies; changing it logs everyone out',
    schema: required('SESSION_SECRET', 32),
  },
  VICTORIAMETRICS_URL: {
    description: 'VictoriaMetrics query API',
    schema: (value) => value || 'http://victoriametrics:8428',
  },
  CF_ACCESS_TEAM_DOMAIN: {
    description:
      'Cloudflare Access team domain (<team>.cloudflareaccess.com); with CF_ACCESS_AUD, an Access sign-in skips the password',
    schema: (value) => value ?? '',
  },
  CF_ACCESS_AUD: {
    description:
      "The dashboard's Access application AUD tag; set together with CF_ACCESS_TEAM_DOMAIN",
    schema: (value) => value ?? '',
  },
  PROBES_FILE: {
    description: 'File vmagent reads uptime-probe targets from; empty to skip',
    schema: (value) => value ?? '',
  },
})
