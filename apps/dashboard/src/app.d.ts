// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      /** Whether the request carries a valid admin session or Access sign-in. */
      authed: boolean
      /** The owner's email when Cloudflare Access signed this request in (ADR 0023). */
      accessEmail?: string
    }
  }
}

export {}
