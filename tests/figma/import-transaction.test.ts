import { describe, expect, it, vi } from 'vitest'

import type { ScanExport } from '../../src/shared/schema'
import { beginImportTransaction } from '../../src/figma/import-transaction'

const valid: ScanExport = {
  schemaVersion: '1.0.0',
  source: {
    siteLabel: 'example.com',
    origin: 'https://example.com',
    scannedAt: '2026-07-18T12:00:00.000Z',
    locale: 'zh-CN',
    platform: 'MacIntel'
  },
  typography: [],
  traversal: { visitedStates: 1, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

describe('beginImportTransaction', () => {
  it('does not create or roll back an undo boundary for invalid JSON', () => {
    const commitUndo = vi.fn()
    const triggerUndo = vi.fn()

    expect(() => beginImportTransaction('{bad', { commitUndo, triggerUndo })).toThrow('JSON')
    expect(commitUndo).not.toHaveBeenCalled()
    expect(triggerUndo).not.toHaveBeenCalled()
  })

  it('rolls back only the import batch after mutations begin', () => {
    const commitUndo = vi.fn()
    const triggerUndo = vi.fn()
    const transaction = beginImportTransaction(JSON.stringify(valid), { commitUndo, triggerUndo })

    expect(commitUndo).toHaveBeenCalledOnce()
    expect(transaction.data.borderRadii).toEqual([])
    expect(transaction.data.shadows).toEqual([])
    expect(transaction.data.colors).toEqual({ primitives: [], semantic: [], interactive: [] })
    expect(transaction.data.spacing).toEqual([])
    expect(transaction.data.controls).toEqual([])
    transaction.rollback()
    transaction.rollback()
    expect(triggerUndo).toHaveBeenCalledOnce()
  })

  it('commits a successful import without later rolling it back', () => {
    const commitUndo = vi.fn()
    const triggerUndo = vi.fn()
    const transaction = beginImportTransaction(JSON.stringify(valid), { commitUndo, triggerUndo })

    transaction.commit()
    transaction.rollback()
    expect(commitUndo).toHaveBeenCalledTimes(2)
    expect(triggerUndo).not.toHaveBeenCalled()
  })
})
