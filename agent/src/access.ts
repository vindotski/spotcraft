import type { CloudflareApi } from './cloudflare.ts'

/** The Access application of a protected app is named after it. */
export const accessAppName = (name: string) => `spotcraft:${name}`

/**
 * Puts protected apps behind Cloudflare Access (ADR 0021): one self-hosted Access application
 * per app, covering every host it answers on, with the owners' policy from infra/cloudflare.
 */
export class AccessApps {
  readonly #api: CloudflareApi
  readonly #policyId: string

  constructor(api: CloudflareApi, policyId: string) {
    this.#api = api
    this.#policyId = policyId
  }

  /**
   * Adds hosts to the app's protection and keeps the ones it has, for a switch of hosts: until
   * the new ones are live, both must stay behind Access. `sync` narrows it afterwards.
   */
  async extend(name: string, hosts: string[]): Promise<void> {
    const existing = await this.#api.accessApp(accessAppName(name))
    const current = (existing?.destinations ?? []).map((d) => d.uri).filter(Boolean) as string[]
    await this.sync(name, [...current, ...hosts.filter((h) => !current.includes(h))], true)
  }

  /** Protects the app's hosts, updates them, or takes the protection away. */
  async sync(name: string, hosts: string[], protect: boolean): Promise<void> {
    const appName = accessAppName(name)
    const existing = await this.#api.accessApp(appName)
    if (!protect || hosts.length === 0) {
      if (existing) await this.#api.deleteAccessApp(existing.id)
      return
    }
    const input = { name: appName, hosts, policyId: this.#policyId }
    if (!existing) {
      await this.#api.createAccessApp(input)
      return
    }
    const current = (existing.destinations ?? []).map((d) => d.uri)
    const samePolicy =
      existing.policies?.length === 1 && existing.policies[0]?.id === this.#policyId
    const sameHosts = current.length === hosts.length && hosts.every((h) => current.includes(h))
    if (!samePolicy || !sameHosts) await this.#api.updateAccessApp(existing.id, input)
  }
}
