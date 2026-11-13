import type { DnsInstruction, HostStatus } from './app-spec.ts'
import { type CloudflareApi, CloudflareError, type DnsRecord } from './cloudflare.ts'

/** Thrown when a host already has records Spotcraft didn't make; nothing was changed. */
export class DomainConflict extends Error {}

export interface DomainsOptions {
  api: CloudflareApi
  /** Zone of the apps domain: custom hostnames (Cloudflare for SaaS) live there. */
  appsZoneId: string
  /** The server's tunnel; same-account domains get a proxied CNAME to it. */
  tunnelId: string
}

/** Records at a host that decide where it goes; MX, TXT and the rest are left alone. */
const ROUTING_TYPES = new Set(['A', 'AAAA', 'CNAME'])

/** Cloudflare's statuses as words: `pending_validation` → `pending validation`. */
const readable = (status: string) => status.replaceAll('_', ' ')

/** Puts back what `attach` changed. */
export type Undo = () => Promise<void>

/** A record's own fields, to create or update it back as it was. */
const original = (record: DnsRecord): Omit<DnsRecord, 'id'> => ({
  type: record.type,
  name: record.name,
  content: record.content,
  proxied: record.proxied,
  ttl: record.ttl,
  comment: record.comment ?? null,
})

/** Spotcraft marks the records it makes, so it never touches anyone else's. */
export const recordComment = (name: string) => `spotcraft:${name}`

type Plan =
  | { host: string; mode: 'zone'; zoneId: string; records: DnsRecord[] }
  | { host: string; mode: 'saas' }

/**
 * Sets up and removes the DNS for apps' custom domains through the Cloudflare API (ADR 0021).
 * A host whose zone is in the account gets a proxied CNAME to the apps tunnel; any other host
 * becomes a custom hostname on the apps zone, and its owner adds a CNAME to the app's default host.
 */
export class Domains {
  readonly #api: CloudflareApi
  readonly #appsZoneId: string
  readonly #target: string

  constructor({ api, appsZoneId, tunnelId }: DomainsOptions) {
    this.#api = api
    this.#appsZoneId = appsZoneId
    this.#target = `${tunnelId}.cfargotunnel.com`
  }

  async #plan(host: string): Promise<Plan> {
    const zone = await this.#api.zoneFor(host)
    if (!zone) return { host, mode: 'saas' }
    const records = (await this.#api.records(zone.id, host)).filter((r) =>
      ROUTING_TYPES.has(r.type),
    )
    return { host, mode: 'zone', zoneId: zone.id, records }
  }

  /**
   * Points every host at the app. Checks all of them before changing any: a host with records
   * Spotcraft didn't make is refused unless `takeOver`, which replaces them.
   *
   * Returns an undo that puts back exactly what this call changed, records it replaced
   * included, for when the deploy fails afterwards. If attaching itself fails partway, it
   * undoes its own changes before throwing.
   */
  async attach(name: string, hosts: string[], { takeOver = false } = {}): Promise<Undo> {
    const plans = await Promise.all(hosts.map((host) => this.#plan(host)))
    if (!takeOver) {
      for (const plan of plans) {
        if (plan.mode !== 'zone') continue
        const foreign = plan.records.find((r) => r.comment !== recordComment(name))
        if (foreign) {
          throw new DomainConflict(
            `${plan.host} already has a record Spotcraft didn't make (${foreign.type} ${foreign.content}); take it over to replace it`,
          )
        }
      }
    }
    // Every change pushes the step that reverses it; undo runs them newest first.
    const journal: Array<() => Promise<unknown>> = []
    const undo: Undo = async () => {
      for (const step of journal.splice(0).reverse()) await step().catch(() => {})
    }
    try {
      for (const plan of plans) {
        if (plan.mode === 'zone') {
          await this.#attachZone(name, plan, journal)
        } else if (!(await this.#api.customHostname(this.#appsZoneId, plan.host))) {
          const created = await this.#api.createCustomHostname(this.#appsZoneId, plan.host)
          journal.push(() => this.#api.deleteCustomHostname(this.#appsZoneId, created.id))
        }
      }
    } catch (error) {
      await undo()
      throw error
    }
    return undo
  }

  async #attachZone(
    name: string,
    plan: Extract<Plan, { mode: 'zone' }>,
    journal: Array<() => Promise<unknown>>,
  ) {
    const { zoneId } = plan
    const wanted = {
      type: 'CNAME',
      name: plan.host,
      content: this.#target,
      proxied: true,
      comment: recordComment(name),
    }
    const remove = async (record: DnsRecord) => {
      await this.#api.deleteRecord(zoneId, record.id)
      journal.push(() => this.#api.createRecord(zoneId, original(record)))
    }
    const create = async () => {
      const created = await this.#api.createRecord(zoneId, wanted)
      journal.push(() => this.#api.deleteRecord(zoneId, created.id))
    }
    // A CNAME can't share its name with other records: keep at most one, replace the rest.
    const [keep, ...rest] = [...plan.records].sort(
      (a, b) => Number(b.type === 'CNAME') - Number(a.type === 'CNAME'),
    )
    for (const record of rest) await remove(record)
    if (!keep) {
      await create()
    } else if (keep.type !== 'CNAME') {
      await remove(keep)
      await create()
    } else if (
      keep.content !== wanted.content ||
      !keep.proxied ||
      keep.comment !== wanted.comment
    ) {
      await this.#api.updateRecord(zoneId, keep.id, wanted)
      journal.push(() => this.#api.updateRecord(zoneId, keep.id, original(keep)))
    }
  }

  /** Removes what Spotcraft made for these hosts: its own records, and custom hostnames. */
  async detach(name: string, hosts: string[]): Promise<void> {
    for (const host of hosts) {
      const zone = await this.#api.zoneFor(host)
      if (zone) {
        for (const record of await this.#api.records(zone.id, host)) {
          if (record.comment === recordComment(name)) {
            await this.#api.deleteRecord(zone.id, record.id)
          }
        }
      } else {
        const custom = await this.#api.customHostname(this.#appsZoneId, host)
        if (custom) await this.#api.deleteCustomHostname(this.#appsZoneId, custom.id)
      }
    }
  }

  /** Where each host stands, and which records its owner still has to create. */
  async status(name: string, hosts: string[], target: string): Promise<HostStatus[]> {
    return Promise.all(
      hosts.map(async (host): Promise<HostStatus> => {
        try {
          return await this.#hostStatus(name, host, target)
        } catch (error) {
          const detail = error instanceof CloudflareError ? error.message : String(error)
          return { host, mode: 'manual', state: 'unknown', detail, records: [] }
        }
      }),
    )
  }

  async #hostStatus(name: string, host: string, target: string): Promise<HostStatus> {
    const plan = await this.#plan(host)
    if (plan.mode === 'zone') {
      const ours = plan.records.find(
        (r) =>
          r.type === 'CNAME' && r.content === this.#target && r.comment === recordComment(name),
      )
      return ours
        ? { host, mode: 'zone', state: 'active', records: [] }
        : {
            host,
            mode: 'zone',
            state: 'missing',
            detail: 'Its record is missing or was changed; redeploy the app to put it back.',
            records: [],
          }
    }
    const custom = await this.#api.customHostname(this.#appsZoneId, host)
    const cname: DnsInstruction = { type: 'CNAME', name: host, value: target }
    if (!custom) {
      return {
        host,
        mode: 'saas',
        state: 'missing',
        detail: 'Not set up yet; redeploy the app.',
        records: [cname],
      }
    }
    const records: DnsInstruction[] = [cname]
    const verification = custom.ownership_verification
    if (custom.status !== 'active' && verification?.name && verification.value) {
      records.push({ type: 'TXT', name: verification.name, value: verification.value })
    }
    for (const validation of custom.ssl?.validation_records ?? []) {
      if (validation.txt_name && validation.txt_value) {
        records.push({ type: 'TXT', name: validation.txt_name, value: validation.txt_value })
      }
    }
    const active = custom.status === 'active' && custom.ssl?.status === 'active'
    const errors = [
      ...(custom.verification_errors ?? []),
      ...(custom.ssl?.validation_errors ?? []).map((e) => e.message ?? ''),
    ].filter(Boolean)
    return {
      host,
      mode: 'saas',
      state: active ? 'active' : 'pending',
      detail: active
        ? undefined
        : errors.join('; ') ||
          `Waiting for the CNAME (hostname ${readable(custom.status)}, certificate ${readable(custom.ssl?.status ?? 'pending')}).`,
      records: active ? [cname] : records,
    }
  }
}
