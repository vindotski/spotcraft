import type { BackupStatus } from '@spotcraft/agent/apps'

/** A backup older than this is overdue: the nightly one is two hours late (ADR 0030). */
export const OVERDUE_HOURS = 26

/**
 * How an app's backups stand, for a badge:
 * - `ok`: the last one worked, less than OVERDUE_HOURS ago;
 * - `failed`: the last attempt failed;
 * - `overdue`: none has worked for OVERDUE_HOURS;
 * - `none`: there was never one.
 */
export function backupHealth(
  status: BackupStatus | null | undefined,
  now = new Date(),
): 'ok' | 'failed' | 'overdue' | 'none' {
  if (!status) return 'none'
  if (!status.ok) return 'failed'
  const last = status.lastOkAt ?? status.at
  return now.getTime() - new Date(last).getTime() > OVERDUE_HOURS * 3_600_000 ? 'overdue' : 'ok'
}
