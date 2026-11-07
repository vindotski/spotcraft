import { execFile } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a program without a shell; arguments are never interpolated. */
export type Runner = (file: string, args: string[], timeoutMs?: number) => Promise<RunResult>

export const execRunner: Runner = (file, args, timeoutMs = 300_000) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
  })
