/**
 * The few Cloudflare API calls the agent makes for custom domains (ADR 0021): find a zone,
 * manage DNS records, manage Cloudflare for SaaS custom hostnames. Plain `fetch`, no SDK.
 */

const API = 'https://api.cloudflare.com/client/v4'

export class CloudflareError extends Error {}

export interface Zone {
  id: string
  name: string
}

export interface DnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied?: boolean
  /** Seconds; 1 means automatic. */
  ttl?: number
  comment?: string | null
}

export interface CustomHostname {
  id: string
  hostname: string
  /** `active`, `pending`, `moved`, `blocked`… */
  status: string
  ssl?: {
    status?: string
    validation_records?: { txt_name?: string; txt_value?: string }[]
    validation_errors?: { message?: string }[]
  }
  ownership_verification?: { type?: string; name?: string; value?: string }
  verification_errors?: string[]
}

/** A self-hosted Cloudflare Access application (one per protected app). */
export interface AccessApp {
  id: string
  name: string
  destinations?: { type?: string; uri?: string }[]
  policies?: { id?: string }[]
}

/** What the agent sends for an Access application. */
export interface AccessAppInput {
  name: string
  hosts: string[]
  policyId: string
}

type Fetch = typeof fetch

export class CloudflareApi {
  readonly #token: string
  readonly #accountId: string
  readonly #fetch: Fetch

  constructor(token: string, accountId: string, fetchImpl: Fetch = fetch) {
    this.#token = token
    this.#accountId = accountId
    this.#fetch = fetchImpl
  }

  async #call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await this.#fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.#token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      })
    } catch (cause) {
      throw new CloudflareError('Cloudflare did not answer', { cause })
    }
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean
      errors?: { code?: number; message?: string }[]
      result?: T
    }
    if (!response.ok || !payload.success) {
      const detail = payload.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`
      throw new CloudflareError(`Cloudflare: ${detail}`)
    }
    return payload.result as T
  }

  /**
   * The account's zone that holds `host`, if any: tries `a.b.example.com`, `b.example.com`,
   * `example.com`, so no public-suffix list is needed.
   */
  async zoneFor(host: string): Promise<Zone | undefined> {
    const labels = host.split('.')
    for (let i = 0; i < labels.length - 1; i++) {
      const name = labels.slice(i).join('.')
      const query = new URLSearchParams({ name, 'account.id': this.#accountId })
      const [zone] = await this.#call<Zone[]>('GET', `/zones?${query}`)
      if (zone) return { id: zone.id, name: zone.name }
    }
    return undefined
  }

  records(zoneId: string, name: string): Promise<DnsRecord[]> {
    const query = new URLSearchParams({ 'name.exact': name, per_page: '100' })
    return this.#call('GET', `/zones/${zoneId}/dns_records?${query}`)
  }

  createRecord(zoneId: string, record: Omit<DnsRecord, 'id'>): Promise<DnsRecord> {
    return this.#call('POST', `/zones/${zoneId}/dns_records`, { ...record, ttl: record.ttl ?? 1 })
  }

  updateRecord(zoneId: string, id: string, record: Omit<DnsRecord, 'id'>): Promise<DnsRecord> {
    return this.#call('PATCH', `/zones/${zoneId}/dns_records/${id}`, {
      ...record,
      ttl: record.ttl ?? 1,
    })
  }

  async deleteRecord(zoneId: string, id: string): Promise<void> {
    await this.#call('DELETE', `/zones/${zoneId}/dns_records/${id}`)
  }

  async customHostname(zoneId: string, hostname: string): Promise<CustomHostname | undefined> {
    const query = new URLSearchParams({ hostname })
    const found = await this.#call<CustomHostname[]>(
      'GET',
      `/zones/${zoneId}/custom_hostnames?${query}`,
    )
    return found.find((entry) => entry.hostname === hostname)
  }

  /** Certificates are validated over HTTP once the hostname's CNAME points at the zone. */
  createCustomHostname(zoneId: string, hostname: string): Promise<CustomHostname> {
    return this.#call('POST', `/zones/${zoneId}/custom_hostnames`, {
      hostname,
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    })
  }

  async deleteCustomHostname(zoneId: string, id: string): Promise<void> {
    await this.#call('DELETE', `/zones/${zoneId}/custom_hostnames/${id}`)
  }

  async accessApp(name: string): Promise<AccessApp | undefined> {
    const query = new URLSearchParams({ name })
    const found = await this.#call<AccessApp[]>(
      'GET',
      `/accounts/${this.#accountId}/access/apps?${query}`,
    )
    return found.find((app) => app.name === name)
  }

  #accessBody({ name, hosts, policyId }: AccessAppInput) {
    return {
      name,
      type: 'self_hosted',
      domain: hosts[0],
      destinations: hosts.map((uri) => ({ type: 'public', uri })),
      policies: [{ id: policyId, precedence: 1 }],
      app_launcher_visible: false,
      auto_redirect_to_identity: true,
    }
  }

  createAccessApp(input: AccessAppInput): Promise<AccessApp> {
    return this.#call('POST', `/accounts/${this.#accountId}/access/apps`, this.#accessBody(input))
  }

  updateAccessApp(id: string, input: AccessAppInput): Promise<AccessApp> {
    return this.#call(
      'PUT',
      `/accounts/${this.#accountId}/access/apps/${id}`,
      this.#accessBody(input),
    )
  }

  async deleteAccessApp(id: string): Promise<void> {
    await this.#call('DELETE', `/accounts/${this.#accountId}/access/apps/${id}`)
  }
}
