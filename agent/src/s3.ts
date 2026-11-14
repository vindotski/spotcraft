import { createHash, createHmac } from 'node:crypto'

/**
 * Just enough of the S3 API to put backups into a bucket: Cloudflare R2, or any other
 * S3-compatible store (ADR 0030). Requests are signed with AWS Signature Version 4.
 */
export interface S3Config {
  /** e.g. https://<account>.r2.cloudflarestorage.com; path-style requests go to it. */
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** R2 takes `auto`. */
  region?: string
}

const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding of one path segment, as SigV4 wants it. */
const encodeSegment = (segment: string) =>
  encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/**
 * The SigV4 `Authorization` header for a request. `headers` are lower-case and include `host`,
 * `x-amz-date` and `x-amz-content-sha256`; all of them are signed.
 */
export function signV4(request: {
  method: string
  /** Already encoded, e.g. `/bucket/app/2026.dump`. */
  path: string
  query?: string
  headers: Record<string, string>
  payloadHash: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
}): string {
  const service = request.service ?? 's3'
  const amzDate = request.headers['x-amz-date']
  if (!amzDate) throw new Error('x-amz-date is required')
  const day = amzDate.slice(0, 8)
  const names = Object.keys(request.headers).sort()
  const canonicalHeaders = names.map((n) => `${n}:${request.headers[n]?.trim()}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [
    request.method,
    request.path,
    request.query ?? '',
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n')
  const scope = `${day}/${request.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const key = hmac(
    hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, day), request.region), service),
    'aws4_request',
  )
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

/** `20261114T030000Z`, as x-amz-date wants it. */
export const amzDate = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')

export class S3 {
  readonly #config: S3Config & { region: string }
  readonly #fetch: typeof fetch
  readonly #now: () => Date

  constructor(config: S3Config, fetchImpl: typeof fetch = fetch, now = () => new Date()) {
    this.#config = { region: 'auto', ...config, endpoint: config.endpoint.replace(/\/+$/, '') }
    this.#fetch = fetchImpl
    this.#now = now
  }

  /** Puts one object; throws with S3's answer if it fails. */
  async put(key: string, body: Uint8Array, contentType = 'application/octet-stream') {
    const url = new URL(this.#config.endpoint)
    const path = `/${[this.#config.bucket, ...key.split('/')].map(encodeSegment).join('/')}`
    const payloadHash = sha256Hex(body)
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(this.#now()),
    }
    const authorization = signV4({
      method: 'PUT',
      path,
      headers,
      payloadHash,
      accessKeyId: this.#config.accessKeyId,
      secretAccessKey: this.#config.secretAccessKey,
      region: this.#config.region,
    })
    const { host: _, ...sent } = headers
    const response = await this.#fetch(`${url.origin}${path}`, {
      method: 'PUT',
      headers: { ...sent, authorization, 'content-type': contentType },
      body,
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 500)
      throw new Error(`The bucket answered ${response.status} for ${key}: ${text}`)
    }
  }
}
