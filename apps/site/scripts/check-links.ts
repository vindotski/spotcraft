// Runs after `astro build`: every page the site has always had still exists, every internal link
// points at a page or file in dist/, and every #anchor exists on its page. Fails the build
// otherwise.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const repo = new URL('../../../', import.meta.url).pathname

/** Built HTML file for a site path (`/docs/x` → `docs/x.html`), or a static file, or null. */
function fileFor(path: string): string | null {
  const clean = decodeURIComponent(path).replace(/\/$/, '') || '/index'
  for (const candidate of [`${clean}.html`, `${clean}/index.html`, clean]) {
    const file = join(dist, candidate)
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  return null
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return htmlFiles(path)
    return entry.name.endsWith('.html') ? [path] : []
  })
}

const ids = new Map<string, Set<string>>()
function idsOf(file: string): Set<string> {
  let found = ids.get(file)
  if (!found) {
    found = new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    ids.set(file, found)
  }
  return found
}

const problems: string[] = []

// The pages the site has always had: home, docs, every docs page and every ADR.
const expected = [
  '/',
  '/docs',
  '/docs/getting-started',
  '/docs/security',
  '/docs/guides/backend-kit',
  '/docs/decisions',
  '/docs/changelog',
  '/404',
  ...readdirSync(join(repo, 'docs/decisions'))
    .filter((name) => /^\d{4}-[a-z0-9-]+\.md$/.test(name))
    .map((name) => `/docs/decisions/${name.replace(/\.md$/, '')}`),
]
for (const path of expected) {
  if (!fileFor(path)) problems.push(`missing page ${path}`)
}
for (const file of ['CNAME', 'robots.txt', 'favicon.svg']) {
  if (!existsSync(join(dist, file))) problems.push(`missing ${file}`)
}

let links = 0
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, 'utf8')
  const page = relative(dist, file)
  if (/<script[\s>]/i.test(html)) problems.push(`${page}: has a <script>; the site ships none`)
  for (const [, href] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    if (/^[a-z]+:|^\/\//i.test(href)) continue
    links++
    const [path, hash] = href.split('#')
    const target = path ? fileFor(path) : file
    if (!target) {
      problems.push(`${page}: broken link ${href}`)
    } else if (hash && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(hash))) {
      problems.push(`${page}: missing anchor ${href}`)
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`check-links: ${expected.length} pages present, ${links} internal links resolve`)
