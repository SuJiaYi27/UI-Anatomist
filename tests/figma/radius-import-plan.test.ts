import { describe, expect, it } from 'vitest'

import type { ScanExport } from '../../src/shared/schema'
import { createRadiusImportPlan } from '../../src/figma/radius-import-plan'

const data: ScanExport = {
  schemaVersion: '1.1.0',
  source: {
    siteLabel: 'example.com',
    origin: 'https://example.com',
    scannedAt: '2026-07-21T12:00:00.000Z',
    locale: 'zh-CN',
    platform: 'macOS'
  },
  typography: [],
  borderRadii: [
    { id: `sha256:${'1'.repeat(64)}`, name: 'radius-8', kind: 'px', value: 8, occurrences: 4 },
    { id: `sha256:${'2'.repeat(64)}`, name: 'radius-25-percent', kind: 'percent', value: 25, occurrences: 2 },
    { id: `sha256:${'3'.repeat(64)}`, name: 'radius-full', kind: 'full', value: null, occurrences: 8 }
  ],
  traversal: { visitedStates: 3, skippedUnsafe: 2, skippedUncertain: 1, failures: 0 },
  filtered: { brandAssets: 4, personalTextNodes: 10 }
}

describe('createRadiusImportPlan', () => {
  it('plans dynamic px/full variables and keeps percentage tokens for the board only', () => {
    const plan = createRadiusImportPlan(data, [], [])

    expect(plan.collection).toMatchObject({
      action: 'create',
      targetName: 'UI-Anatomist / example.com / Border Radii',
      ownershipOrigin: 'https://example.com'
    })
    expect(plan.entries.map(entry => [entry.targetName, entry.action])).toEqual([
      ['Radius/8', 'create'],
      ['Radius/25%', 'skip_percent'],
      ['Radius/Full', 'create']
    ])
  })

  it('creates a separate collection instead of taking over a user collection', () => {
    const plan = createRadiusImportPlan(data, [{
      id: 'collection:user',
      name: 'UI-Anatomist / example.com / Border Radii',
      defaultModeId: 'mode:user',
      ownershipOrigin: null
    }], [])

    expect(plan.collection).toMatchObject({
      action: 'create',
      targetName: 'UI-Anatomist / example.com / Border Radii · UI-Anatomist'
    })
  })

  it('updates owned variables idempotently but never overwrites a user variable', () => {
    const collection = {
      id: 'collection:owned',
      name: 'UI-Anatomist / example.com / Border Radii',
      defaultModeId: 'mode:1',
      ownershipOrigin: 'https://example.com'
    }
    const variables = [
      {
        id: 'variable:owned',
        name: 'Radius/8',
        collectionId: collection.id,
        resolvedType: 'FLOAT',
        ownershipId: `https://example.com|sha256:${'1'.repeat(64)}`
      },
      {
        id: 'variable:user',
        name: 'Radius/Full',
        collectionId: collection.id,
        resolvedType: 'FLOAT',
        ownershipId: null
      }
    ]

    const plan = createRadiusImportPlan(data, [collection], variables)
    expect(plan.entries[0]).toMatchObject({ action: 'update', existingVariableId: 'variable:owned' })
    expect(plan.entries[2]).toMatchObject({ action: 'skip_conflict', existingVariableId: 'variable:user' })
  })
})
