import { describe, expect, it } from 'vitest'

import type { ScanExport } from '../../src/shared/schema'
import { createShadowImportPlan } from '../../src/figma/shadow-import-plan'

const data: ScanExport = {
  schemaVersion: '1.2.0',
  source: {
    siteLabel: 'example.com',
    origin: 'https://example.com',
    scannedAt: '2026-07-22T00:00:00.000Z',
    locale: 'zh-CN',
    platform: 'macOS'
  },
  typography: [],
  borderRadii: [],
  shadows: [{
    id: `sha256:${'a'.repeat(64)}`,
    name: 'shadow-outer-x0-y4-b12-s0-a15',
    layers: [{
      kind: 'outer', offsetX: 0, offsetY: 4, blur: 12, spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.15 }
    }],
    occurrences: 4
  }],
  traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 1, personalTextNodes: 2 }
}

describe('createShadowImportPlan', () => {
  it('creates a namespaced effect style with stable ownership', () => {
    expect(createShadowImportPlan(data, []).entries[0]).toMatchObject({
      action: 'create',
      targetName: 'UI-Anatomist/example.com/shadow-outer-x0-y4-b12-s0-a15',
      ownershipId: `https://example.com|sha256:${'a'.repeat(64)}`,
      existingStyleId: null,
      conflictName: null
    })
  })

  it('updates the exact style previously owned by UI-Anatomist', () => {
    const ownershipId = `https://example.com|sha256:${'a'.repeat(64)}`
    expect(createShadowImportPlan(data, [{
      id: 'effect:owned',
      name: 'UI-Anatomist/example.com/shadow-outer-x0-y4-b12-s0-a15',
      ownershipId
    }]).entries[0]).toMatchObject({ action: 'update', existingStyleId: 'effect:owned' })
  })

  it('protects a user style by allocating a stable suffix and reporting the collision', () => {
    const baseName = 'UI-Anatomist/example.com/shadow-outer-x0-y4-b12-s0-a15'
    expect(createShadowImportPlan(data, [{
      id: 'effect:user', name: baseName, ownershipId: null
    }]).entries[0]).toMatchObject({
      action: 'create',
      targetName: `${baseName} · aaaaaa`,
      conflictName: baseName
    })
  })

  it('extends the suffix deterministically when the short suffix is already reserved', () => {
    const baseName = 'UI-Anatomist/example.com/shadow-outer-x0-y4-b12-s0-a15'
    const entry = createShadowImportPlan(data, [
      { id: 'effect:user', name: baseName, ownershipId: null },
      { id: 'effect:user-2', name: `${baseName} · aaaaaa`, ownershipId: null }
    ]).entries[0]

    expect(entry?.targetName).toBe(`${baseName} · aaaaaaaa`)
  })

  it('migrates a same-origin owned style when the webpage changes the signature id', () => {
    const changed = structuredClone(data)
    changed.shadows[0] = {
      ...changed.shadows[0]!,
      id: `sha256:${'b'.repeat(64)}`,
      layers: [{ ...changed.shadows[0]!.layers[0]!, blur: 13 }]
    }
    const entry = createShadowImportPlan(changed, [{
      id: 'effect:old',
      name: 'UI-Anatomist/example.com/shadow-outer-x0-y4-b12-s0-a15',
      ownershipId: `https://example.com|sha256:${'a'.repeat(64)}`
    }]).entries[0]

    expect(entry).toMatchObject({
      action: 'update',
      existingStyleId: 'effect:old',
      ownershipId: `https://example.com|sha256:${'b'.repeat(64)}`
    })
  })
})
