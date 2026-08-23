import { describe, expect, it } from 'vitest'
import type { ScanExport } from '../../src/shared/schema'
import { createColorImportPlan } from '../../src/figma/color-import-plan'

const primitiveId = `sha256:${'1'.repeat(64)}`
const semanticId = `sha256:${'2'.repeat(64)}`
const interactiveId = `sha256:${'3'.repeat(64)}`

const data: ScanExport = {
  schemaVersion: '1.3.0',
  source: {
    siteLabel: 'example.com', origin: 'https://example.com',
    scannedAt: '2026-07-22T12:00:00.000Z', locale: 'zh-CN', platform: 'macOS'
  },
  typography: [],
  borderRadii: [],
  shadows: [],
  colors: {
    primitives: [{
      id: primitiveId, name: 'neutral-0', value: { r: 1, g: 1, b: 1, a: 1 },
      family: 'neutral', step: 0, provenance: 'observed', occurrences: 8
    }],
    semantic: [{
      id: semanticId, name: 'background-primary', group: 'background',
      value: { r: 1, g: 1, b: 1, a: 1 }, primitiveId,
      provenance: 'observed', occurrences: 4
    }],
    interactive: [{
      id: interactiveId, name: 'primary-hover-background', intent: 'primary',
      state: 'hover', usage: 'background', value: { r: 1, g: 1, b: 1, a: 1 },
      primitiveId, provenance: 'declared', occurrences: 1
    }]
  },
  traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

describe('createColorImportPlan', () => {
  it('plans one owned collection and all three variable namespaces', () => {
    const plan = createColorImportPlan(data, [], [])
    expect(plan.collection).toMatchObject({
      action: 'create',
      targetName: 'UI-Anatomist / example.com / Colors',
      ownershipOrigin: 'https://example.com'
    })
    expect(plan.entries.map(entry => [entry.layer, entry.targetName, entry.action])).toEqual([
      ['primitive', 'Primitive/neutral/neutral-0', 'create'],
      ['semantic', 'Semantic/background/background-primary', 'create'],
      ['interactive', 'Interactive/primary/hover/background', 'create']
    ])
  })

  it('creates a separate collection instead of taking over a user collection', () => {
    const plan = createColorImportPlan(data, [{
      id: 'collection:user', name: 'UI-Anatomist / example.com / Colors',
      defaultModeId: 'mode:user', ownershipOrigin: null
    }], [])
    expect(plan.collection).toMatchObject({
      action: 'create',
      targetName: 'UI-Anatomist / example.com / Colors · UI-Anatomist'
    })
  })

  it('updates owned variables and protects a user collision and its aliases', () => {
    const collection = {
      id: 'collection:owned', name: 'UI-Anatomist / example.com / Colors',
      defaultModeId: 'mode:1', ownershipOrigin: 'https://example.com'
    }
    const variables = [{
      id: 'variable:primitive', name: 'Primitive/neutral/neutral-0',
      collectionId: collection.id, resolvedType: 'COLOR',
      ownershipId: `https://example.com|${primitiveId}`
    }, {
      id: 'variable:user', name: 'Semantic/background/background-primary',
      collectionId: collection.id, resolvedType: 'COLOR', ownershipId: null
    }]

    const plan = createColorImportPlan(data, [collection], variables)
    expect(plan.entries[0]).toMatchObject({ action: 'update', existingVariableId: 'variable:primitive' })
    expect(plan.entries[1]).toMatchObject({ action: 'skip_conflict', existingVariableId: 'variable:user' })
    expect(plan.entries[2]).toMatchObject({ action: 'create' })
  })

  it('uses stable suffixes when two interactive values share one role/state name', () => {
    const duplicate = structuredClone(data)
    duplicate.colors.interactive.push({
      ...duplicate.colors.interactive[0]!,
      id: `sha256:${'4'.repeat(64)}`,
      value: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      primitiveId
    })
    const plan = createColorImportPlan(duplicate, [], [])
    expect(plan.entries.filter(entry => entry.layer === 'interactive').map(entry => entry.targetName))
      .toEqual([
        'Interactive/primary/hover/background',
        `Interactive/primary/hover/background · ${'4'.repeat(6)}`
      ])
  })

  it('keeps duplicate-role targets stable across reordered repeat imports', () => {
    const first = structuredClone(data)
    first.colors.interactive.push({
      ...first.colors.interactive[0]!,
      id: `sha256:${'4'.repeat(64)}`,
      value: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      primitiveId
    })
    const initial = createColorImportPlan(first, [], [])
    const initialInteractive = initial.entries.filter(entry => entry.layer === 'interactive')
    const collection = {
      id: 'collection:owned', name: 'UI-Anatomist / example.com / Colors',
      defaultModeId: 'mode:1', ownershipOrigin: 'https://example.com'
    }
    const existing = initialInteractive.map((entry, index) => ({
      id: `variable:${index}`,
      name: entry.targetName,
      collectionId: collection.id,
      resolvedType: 'COLOR',
      ownershipId: entry.ownershipId
    }))
    const reordered = structuredClone(first)
    reordered.colors.interactive.reverse()

    const freshReordered = createColorImportPlan(reordered, [], [])
    const repeated = createColorImportPlan(reordered, [collection], existing)
    const targetsByOwnership = (entries: typeof initialInteractive) => Object.fromEntries(
      entries.map(entry => [entry.ownershipId, entry.targetName])
    )

    expect(targetsByOwnership(freshReordered.entries.filter(entry => entry.layer === 'interactive')))
      .toEqual(targetsByOwnership(initialInteractive))
    expect(repeated.entries.filter(entry => entry.layer === 'interactive')).toEqual(
      expect.arrayContaining(initialInteractive.map((entry, index) => expect.objectContaining({
        action: 'update',
        ownershipId: entry.ownershipId,
        targetName: entry.targetName,
        existingVariableId: `variable:${index}`
      })))
    )
  })

  it('returns a surviving owned suffix to the canonical base while the stale base awaits cleanup', () => {
    const current = structuredClone(data)
    current.colors.interactive = [{
      ...current.colors.interactive[0]!,
      id: `sha256:${'4'.repeat(64)}`
    }]
    const collection = {
      id: 'collection:owned', name: 'UI-Anatomist / example.com / Colors',
      defaultModeId: 'mode:1', ownershipOrigin: 'https://example.com'
    }
    const baseName = 'Interactive/primary/hover/background'
    const plan = createColorImportPlan(current, [collection], [{
      id: 'variable:primitive', name: 'Primitive/neutral/neutral-0',
      collectionId: collection.id, resolvedType: 'COLOR',
      ownershipId: `https://example.com|${primitiveId}`
    }, {
      id: 'variable:stale-base', name: baseName,
      collectionId: collection.id, resolvedType: 'COLOR',
      ownershipId: `https://example.com|${interactiveId}`
    }, {
      id: 'variable:survivor', name: `${baseName} · ${'4'.repeat(6)}`,
      collectionId: collection.id, resolvedType: 'COLOR',
      ownershipId: `https://example.com|${'sha256:'}${'4'.repeat(64)}`
    }])

    expect(plan.entries.find(entry => entry.layer === 'interactive')).toMatchObject({
      action: 'update',
      existingVariableId: 'variable:survivor',
      targetName: baseName
    })
  })
})
