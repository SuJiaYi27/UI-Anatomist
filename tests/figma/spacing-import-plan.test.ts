import { describe, expect, it } from 'vitest'
import type { ScanExport } from '../../src/shared/schema'
import { createSpacingImportPlan } from '../../src/figma/spacing-import-plan'

const data: ScanExport = {
  schemaVersion: '1.4.0',
  source: {
    siteLabel: 'example.com', origin: 'https://example.com',
    scannedAt: '2026-07-23T12:00:00.000Z', locale: 'zh-CN', platform: 'macOS'
  },
  typography: [],
  borderRadii: [],
  shadows: [],
  colors: { primitives: [], semantic: [], interactive: [] },
  spacing: [{
    id: `sha256:${'1'.repeat(64)}`,
    name: 'spacing-8',
    value: 8,
    occurrences: 3,
    evidence: { padding: 2, gap: 1, margin: 0 },
    stateOccurrences: 2
  }],
  traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

describe('createSpacingImportPlan', () => {
  it('creates a site-owned spacing collection and numeric variables', () => {
    const plan = createSpacingImportPlan(data, [], [])
    expect(plan.collection).toMatchObject({
      action: 'create',
      targetName: 'UI-Anatomist / example.com / Spacing',
      ownershipOrigin: 'https://example.com'
    })
    expect(plan.entries).toEqual([
      expect.objectContaining({ action: 'create', targetName: 'Spacing/8' })
    ])
  })

  it('uses Figma-safe names for fractional spacing values', () => {
    const fractional: ScanExport = {
      ...data,
      spacing: [{
        ...data.spacing[0]!,
        name: 'spacing-2.4',
        value: 2.4
      }]
    }
    const plan = createSpacingImportPlan(fractional, [], [])
    expect(plan.entries[0]?.targetName).toBe('Spacing/2-4')
  })

  it('creates a separate collection instead of taking over a user collection', () => {
    const plan = createSpacingImportPlan(data, [{
      id: 'collection:user',
      name: 'UI-Anatomist / example.com / Spacing',
      defaultModeId: 'mode:user',
      ownershipOrigin: null
    }], [])
    expect(plan.collection.targetName)
      .toBe('UI-Anatomist / example.com / Spacing · UI-Anatomist')
  })

  it('updates an exact owned variable and skips a user name collision', () => {
    const ownedCollection = {
      id: 'collection:owned',
      name: 'UI-Anatomist / example.com / Spacing',
      defaultModeId: 'mode:1',
      ownershipOrigin: 'https://example.com'
    }
    const ownedPlan = createSpacingImportPlan(data, [ownedCollection], [{
      id: 'variable:owned',
      name: 'Spacing/8',
      collectionId: ownedCollection.id,
      resolvedType: 'FLOAT',
      ownershipId: `https://example.com|${data.spacing[0]!.id}`
    }])
    expect(ownedPlan.entries[0]).toMatchObject({
      action: 'update',
      existingVariableId: 'variable:owned'
    })

    const conflictPlan = createSpacingImportPlan(data, [ownedCollection], [{
      id: 'variable:user',
      name: 'Spacing/8',
      collectionId: ownedCollection.id,
      resolvedType: 'FLOAT',
      ownershipId: null
    }])
    expect(conflictPlan.entries[0]).toMatchObject({
      action: 'skip_conflict',
      existingVariableId: 'variable:user'
    })
  })
})
