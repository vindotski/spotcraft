// Before `npm publish` (which doesn't know pnpm's `workspace:` protocol): replaces every
// `workspace:` dependency of the given packages with the project's exact version (ADR 0019).
// Usage: node scripts/pin-workspace-deps.ts packages/cli [packages/…]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.error('Usage: node scripts/pin-workspace-deps.ts <package dir>…')
  process.exit(1)
}

for (const dir of dirs) {
  const file = join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (range.startsWith('workspace:')) {
        pkg[field][name] = version
        console.log(`${file}: ${name} ${range} → ${version}`)
      }
    }
  }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
}
