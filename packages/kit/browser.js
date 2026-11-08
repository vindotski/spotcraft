// What a client-side bundle gets instead of the kit (the `browser` export condition): plain
// JavaScript with no exports, so importing anything from it fails the build, and an error if
// it runs anyway.
throw new Error(
  '@spotcraft/kit is server-only: import it in server code (hooks.server.ts, +page.server.ts, $lib/server), never in code that runs in the browser',
)
