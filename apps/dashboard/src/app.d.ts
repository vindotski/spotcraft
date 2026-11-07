// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      /** Whether the request carries a valid admin session. */
      authed: boolean
    }
  }
}

export {}
