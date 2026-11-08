// The docs pages are the repository's own Markdown, rendered at build time, so the site's docs
// always match the release they were built from.
import { Marked, type Tokens } from 'marked'
import { GITHUB_AT_VERSION } from './site.ts'

const raw = import.meta.glob(['../../../../docs/**/*.md', '../../../../CHANGELOG.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Repository path (e.g. `docs/security.md`) → Markdown source. */
const sources = new Map(
  Object.entries(raw).map(([key, text]) => [key.replace(/^(\.\.\/)+/, ''), text]),
)

/** Site page slug → repository file. */
const pageFiles = new Map<string, string>([
  ['getting-started', 'docs/getting-started.md'],
  ['security', 'docs/security.md'],
  ['guides/backend-kit', 'docs/guides/backend-kit.md'],
  ['changelog', 'CHANGELOG.md'],
  ['decisions', 'docs/decisions/README.md'],
])
for (const path of sources.keys()) {
  const adr = /^docs\/decisions\/(\d{4}-[a-z0-9-]+)\.md$/.exec(path)
  if (adr) pageFiles.set(`decisions/${adr[1]}`, path)
}
const slugByFile = new Map([...pageFiles].map(([slug, file]) => [file, slug]))

export interface DocPage {
  slug: string
  title: string
  /** ADR front matter (status, date…), when the file has it. */
  meta: Record<string, string>
  html: string
  /** The file on GitHub, at this version. */
  source: string
}

/** Pages in the sidebar, in reading order. */
export const NAV = [
  { slug: 'getting-started', label: 'Getting started' },
  { slug: 'guides/backend-kit', label: 'Guest accounts (kit)' },
  { slug: 'security', label: 'Security model' },
  { slug: 'decisions', label: 'Decisions' },
  { slug: 'changelog', label: 'Changelog' },
]

export const allSlugs = () => [...pageFiles.keys()]

function splitFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (pair) meta[pair[1]] = pair[2].replace(/^"(.*)"$/, '$1')
  }
  return { meta, body: text.slice(match[0].length) }
}

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

/** Resolves `href` relative to the repository file `from`; null for external links. */
function resolveRepoPath(from: string, href: string): { path: string; hash: string } | null {
  if (/^[a-z]+:|^\/\/|^#/i.test(href)) return null
  const [target, hash = ''] = href.split('#')
  const parts = from.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return { path: parts.join('/'), hash: hash ? `#${hash}` : '' }
}

export function renderDoc(slug: string): DocPage | undefined {
  const file = pageFiles.get(slug)
  const text = file ? sources.get(file) : undefined
  if (!file || text === undefined) return undefined
  const { meta, body } = splitFrontMatter(text)
  let title = meta.title ?? ''
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens)
        if (depth === 1) {
          // The page header shows the title; the document's own H1 is dropped.
          title ||= inner.replace(/<[^>]+>/g, '')
          return ''
        }
        const id = slugify(inner)
        return `<h${depth} id="${id}"><a href="#${id}">${inner}</a></h${depth}>\n`
      },
      link({ href, title: linkTitle, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens)
        const resolved = resolveRepoPath(file, href)
        let url = href
        let external = false
        if (resolved) {
          const page = slugByFile.get(resolved.path)
          url = page
            ? `/docs/${page}${resolved.hash}`
            : `${GITHUB_AT_VERSION}/${resolved.path}${resolved.hash}`
          external = !page
        } else {
          external = /^https?:/.test(href)
        }
        const attrs = external ? ' rel="noopener noreferrer"' : ''
        const titleAttr = linkTitle ? ` title="${linkTitle}"` : ''
        return `<a href="${url}"${titleAttr}${attrs}>${inner}</a>`
      },
    },
  })
  const html = marked.parse(body, { async: false }) as string
  return { slug, title: title || slug, meta, html, source: `${GITHUB_AT_VERSION}/${file}` }
}
