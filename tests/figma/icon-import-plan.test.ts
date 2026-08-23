import { describe, expect, it } from 'vitest'
import type { ScanExport } from '../../src/shared/schema'
import { createIconImportPlan } from '../../src/figma/icon-import-plan'

const data: ScanExport = {
  schemaVersion: '1.8.0',
  source: {
    siteLabel: 'example.com',
    origin: 'https://example.com',
    scannedAt: '2026-07-25T00:00:00.000Z',
    locale: 'zh-CN',
    platform: 'macOS'
  },
  typography: [],
  borderRadii: [],
  shadows: [],
  colors: { primitives: [], semantic: [], interactive: [] },
  spacing: [],
  controls: [],
  icons: [{
    id: `sha256:${'1'.repeat(64)}`,
    name: 'search chats',
    nameSource: 'svg-title',
    category: 'navigation',
    vectorSvg: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
    observedSizes: [{ width: 20, height: 20, occurrences: 2 }],
    themes: [{
      theme: 'light',
      color: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
      occurrences: 2
    }],
    occurrences: 2,
    stateOccurrences: 2
  }],
  traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

describe('createIconImportPlan', () => {
  it('plans one component when the scan has no interaction-state evidence', () => {
    const plan = createIconImportPlan(data, [])

    expect(plan.entries[0]).toMatchObject({
      assetKind: 'component',
      states: ['Default']
    })
  })

  it('creates one owned asset per stable SVG geometry', () => {
    const plan = createIconImportPlan(data, [])
    expect(plan.entries).toEqual([expect.objectContaining({
      action: 'create',
      targetName: 'Icon/Navigation/Search Chats',
      ownershipId: `https://example.com|icon:${data.icons[0]!.id}`,
      existingComponentSetId: null
    })])
  })

  it('sanitizes legacy accessible-name icon labels before they reach Figma', () => {
    const legacyAccessibleName: ScanExport = {
      ...data,
      icons: data.icons.map(icon => ({
        ...icon,
        name: 'star acme-labs widget-kit',
        nameSource: 'accessible-name' as const
      }))
    }

    const entry = createIconImportPlan(legacyAccessibleName, []).entries[0]

    expect(entry).toMatchObject({
      targetName: 'Icon/Navigation/Icon 111111',
      source: {
        name: 'icon-111111',
        nameSource: 'geometry'
      }
    })
    expect(JSON.stringify(entry)).not.toMatch(/acme|widget/i)
  })

  it('uses a geometry name when legacy icon provenance is missing', () => {
    const icon = { ...data.icons[0]! }
    delete icon.nameSource
    const legacyUnknown: ScanExport = { ...data, icons: [icon] }

    expect(createIconImportPlan(legacyUnknown, []).entries[0]).toMatchObject({
      targetName: 'Icon/Navigation/Icon 111111',
      source: {
        name: 'icon-111111',
        nameSource: 'geometry'
      }
    })
  })

  it('sanitizes unsafe names even when legacy provenance claims a trusted source', () => {
    const unsafeTitle: ScanExport = {
      ...data,
      icons: data.icons.map(icon => ({
        ...icon,
        name: 'private.example.com',
        nameSource: 'svg-title' as const
      }))
    }

    const entry = createIconImportPlan(unsafeTitle, []).entries[0]

    expect(entry).toMatchObject({
      targetName: 'Icon/Navigation/Icon 111111',
      source: {
        name: 'icon-111111',
        nameSource: 'geometry'
      }
    })
    expect(JSON.stringify(entry)).not.toContain('private.example.com')
  })

  it('creates exactly the distinct interaction states proven by rendered surfaces', () => {
    const withStates: ScanExport = {
      ...data,
      icons: data.icons.map(icon => ({
        ...icon,
        interactionSurfaces: [
          {
            state: 'default' as const,
            theme: 'light' as const,
            background: { r: 1, g: 1, b: 1, a: 1 },
            width: 36,
            height: 36,
            radii: {
              topLeft: 18,
              topRight: 18,
              bottomRight: 18,
              bottomLeft: 18
            },
            occurrences: 1
          },
          {
            state: 'hover' as const,
            theme: 'light' as const,
            background: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
            width: 36,
            height: 36,
            radii: {
              topLeft: 18,
              topRight: 18,
              bottomRight: 18,
              bottomLeft: 18
            },
            occurrences: 1
          }
        ]
      }))
    }

    expect(createIconImportPlan(withStates, []).entries[0]).toMatchObject({
      assetKind: 'component-set',
      states: ['Glyph', 'Default', 'Hover']
    })
  })

  it('collapses visually identical observed states instead of inventing variants', () => {
    const sharedSurface = {
      theme: 'light' as const,
      background: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      width: 36,
      height: 36,
      radii: {
        topLeft: 18,
        topRight: 18,
        bottomRight: 18,
        bottomLeft: 18
      },
      occurrences: 1
    }
    const identicalStates: ScanExport = {
      ...data,
      icons: data.icons.map(icon => ({
        ...icon,
        interactionSurfaces: [
          { ...sharedSurface, state: 'default' as const },
          { ...sharedSurface, state: 'hover' as const }
        ]
      }))
    }

    expect(createIconImportPlan(identicalStates, []).entries[0]).toMatchObject({
      assetKind: 'component-set',
      states: ['Glyph', 'Default']
    })
  })

  it('adds a glyph-only structural master before any interaction surface states', () => {
    const hoverOnly: ScanExport = {
      ...data,
      icons: data.icons.map(icon => ({
        ...icon,
        interactionSurfaces: [{
          state: 'hover' as const,
          theme: 'light' as const,
          background: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
          width: 32,
          height: 32,
          radii: {
            topLeft: 4,
            topRight: 4,
            bottomRight: 4,
            bottomLeft: 4
          },
          occurrences: 1
        }]
      }))
    }

    expect(createIconImportPlan(hoverOnly, []).entries[0]).toMatchObject({
      assetKind: 'component-set',
      states: ['Glyph', 'Hover']
    })
  })

  it('updates its own set and never overwrites a same-name user set', () => {
    const ownershipId = `https://example.com|icon:${data.icons[0]!.id}`
    expect(createIconImportPlan(data, [{
      id: 'set:owned',
      type: 'COMPONENT_SET',
      name: 'Icon/Navigation/Search Chats',
      ownershipId
    }]).entries[0]).toMatchObject({
      action: 'update',
      assetKind: 'component',
      existingNodeId: 'set:owned',
      existingComponentSetId: 'set:owned'
    })

    expect(createIconImportPlan(data, [{
      id: 'set:user',
      type: 'COMPONENT_SET',
      name: 'Icon/Navigation/Search Chats',
      ownershipId: null
    }]).entries[0]).toMatchObject({
      action: 'skip_conflict',
      existingComponentSetId: null
    })
  })

  it('allocates stable unique names when different geometries share a label', () => {
    const duplicateNames: ScanExport = {
      ...data,
      icons: [
        data.icons[0]!,
        {
          ...data.icons[0]!,
          id: `sha256:${'2'.repeat(64)}`
        }
      ]
    }
    const forward = createIconImportPlan(duplicateNames, [])
    const reverse = createIconImportPlan({
      ...duplicateNames,
      icons: [...duplicateNames.icons].reverse()
    }, [])
    const byId = (plan: ReturnType<typeof createIconImportPlan>) =>
      new Map(plan.entries.map(entry => [entry.source.id, entry.targetName]))

    expect(byId(forward)).toEqual(byId(reverse))
    expect([...byId(forward).values()]).toEqual([
      'Icon/Navigation/Search Chats · 111111',
      'Icon/Navigation/Search Chats · 222222'
    ])
  })
})
