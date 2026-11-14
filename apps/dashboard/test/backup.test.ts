import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { backupHealth } from '../src/lib/backup.ts'

describe('backup health', () => {
  const now = new Date('2026-11-15T04:00:00Z')
  it('is ok within 26 hours of the last backup that worked', () => {
    const at = '2026-11-15T03:00:00.000Z'
    assert.equal(backupHealth({ at, ok: true, lastOkAt: at }, now), 'ok')
    const old = '2026-11-14T01:59:00.000Z'
    assert.equal(backupHealth({ at: old, ok: true, lastOkAt: old }, now), 'overdue')
  })
  it('says failed for a failed last attempt, and none without any', () => {
    const failed = {
      at: '2026-11-15T03:00:00.000Z',
      ok: false,
      error: '403',
      lastOkAt: '2026-11-14T03:00:00.000Z',
    }
    assert.equal(backupHealth(failed, now), 'failed')
    assert.equal(backupHealth(null, now), 'none')
    assert.equal(backupHealth(undefined, now), 'none')
  })
})
