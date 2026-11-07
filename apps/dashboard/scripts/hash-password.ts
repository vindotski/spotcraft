// Prints a DASHBOARD_PASSWORD_HASH for the given password.
//   pnpm --filter @spotcraft/dashboard hash-password            (asks, without echoing)
//   printf '%s' "$PASSWORD" | pnpm --filter @spotcraft/dashboard hash-password
import { hashPassword } from '../src/lib/server/password.ts'

async function readPassword(): Promise<string> {
  const { stdin, stderr } = process
  if (!stdin.isTTY) {
    let input = ''
    for await (const chunk of stdin) input += chunk
    return input.replace(/\r?\n$/, '')
  }
  stderr.write('Password: ')
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  let password = ''
  for await (const key of stdin) {
    for (const char of key as string) {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false)
        stderr.write('\n')
        return password
      }
      if (char === '\u0003') process.exit(130) // Ctrl+C
      if (char === '\u007f') password = password.slice(0, -1)
      else password += char
    }
  }
  return password
}

const password = await readPassword()
if (password.length < 12) {
  console.error('Use at least 12 characters.')
  process.exit(1)
}
console.log(await hashPassword(password))
process.exit(0)
