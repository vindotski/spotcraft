// Recent tags of a public Docker Hub image, for the tag picker. Other registries get no
// suggestions (the tag field stays free text).
const cache = new Map<string, { at: number; tags: string[] }>()
const TTL_MS = 60_000

export async function dockerHubTags(image: string): Promise<string[]> {
  const parts = image.split('/')
  if (parts.length > 2 || (parts.length === 2 && /[.:]/.test(parts[0]))) return []
  const [namespace, repository] = parts.length === 2 ? parts : ['library', parts[0]]
  const key = `${namespace}/${repository}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tags
  try {
    const response = await fetch(
      `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=25&ordering=last_updated`,
      { signal: AbortSignal.timeout(5_000) },
    )
    if (!response.ok) return []
    const body = (await response.json()) as { results?: Array<{ name: string }> }
    const tags = (body.results ?? []).map((tag) => tag.name)
    cache.set(key, { at: Date.now(), tags })
    return tags
  } catch {
    return []
  }
}
