import {
  DOMAIN,
  ENV_KEY,
  IMAGE,
  MEMORY,
  NAME,
  RESERVED_NAMES,
  TAG,
} from '@spotcraft/agent/app-spec'
import type { AppInput } from './agent.ts'

/** What the form shows again after a failed submit (strings, as typed). */
export interface AppFormValues {
  name: string
  image: string
  tag: string
  domain: string
  port: string
  memory: string
  cpus: string
  readOnly: boolean
  env: string
}

export type AppFormErrors = Partial<Record<keyof AppFormValues, string>>

const matches = (pattern: string, value: string) => new RegExp(pattern).test(value)

export function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

/** Reads and validates the app form with the agent's own rules, so errors show before deploying. */
export function parseAppForm(
  data: FormData,
  options: { withName: boolean },
): { values: AppFormValues; errors: AppFormErrors; input?: AppInput } {
  const text = (key: string) => String(data.get(key) ?? '').trim()
  const values: AppFormValues = {
    name: text('name'),
    image: text('image').toLowerCase(),
    tag: text('tag'),
    domain: text('domain').toLowerCase(),
    port: text('port') || '3000',
    memory: text('memory') || '512m',
    cpus: text('cpus') || '1',
    readOnly: data.get('readOnly') === 'on',
    env: String(data.get('env') ?? ''),
  }
  const errors: AppFormErrors = {}

  if (options.withName) {
    if (!matches(NAME, values.name)) {
      errors.name =
        'Lower-case letters, digits and dashes; 2–32 characters, starting with a letter.'
    } else if (RESERVED_NAMES.has(values.name)) {
      errors.name = `"${values.name}" is reserved.`
    }
  }
  if (!matches(IMAGE, values.image)) errors.image = 'A repository like vindotski/tagtape.'
  if (!matches(TAG, values.tag)) errors.tag = 'A tag like 2.0.0 or latest.'
  if (!matches(DOMAIN, values.domain))
    errors.domain = 'A domain like example.com, without https://.'
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.port = 'A port between 1 and 65535.'
  if (!matches(MEMORY, values.memory)) errors.memory = 'Like 512m or 1g.'
  const cpus = Number(values.cpus)
  if (!Number.isFinite(cpus) || cpus < 0.1 || cpus > 64) errors.cpus = 'Between 0.1 and 64.'

  const env: Record<string, string> = {}
  for (const [index, raw] of values.env.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    const key = equals === -1 ? line : line.slice(0, equals).trim()
    if (equals === -1 || !matches(ENV_KEY, key)) {
      errors.env = `Line ${index + 1}: use KEY=value.`
      break
    }
    env[key] = line.slice(equals + 1)
  }

  if (Object.keys(errors).length > 0) return { values, errors }
  return {
    values,
    errors,
    input: {
      image: values.image,
      tag: values.tag,
      domain: values.domain,
      port,
      memory: values.memory,
      cpus,
      readOnly: values.readOnly,
      env,
    },
  }
}
