import { describe, expect, it } from 'vitest'

import { createStaleAssetPlan, removeStaleAssets } from '../../src/figma/stale-assets'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import type { ScanExport } from '../../src/shared/schema'

const origin = 'https://example.com'
const id = (value: string) => `sha256:${value.repeat(64)}`

const data: ScanExport = {
  schemaVersion: '1.4.0',
  source: {
    siteLabel: 'example.com',
    origin,
    scannedAt: '2026-07-22T00:00:00.000Z',
    locale: 'zh-CN',
    platform: 'macOS'
  },
  typography: [
    {
      id: id('a'), name: 'body-regular', fontFamilyStack: ['Inter'], fontStyle: 'normal',
      fontSizePx: 16, fontWeight: 400, lineHeightPx: 24, letterSpacingPx: 0,
      role: 'body', occurrences: 2
    },
    {
      id: id('c'), name: 'missing-font', fontFamilyStack: ['Unavailable Sans'], fontStyle: 'normal',
      fontSizePx: 14, fontWeight: 400, lineHeightPx: 20, letterSpacingPx: 0,
      role: 'body', occurrences: 1
    }
  ],
  borderRadii: [
    { id: id('1'), name: 'radius-8', kind: 'px', value: 8, occurrences: 4 },
    { id: id('2'), name: 'radius-25-percent', kind: 'percent', value: 25, occurrences: 1 }
  ],
  shadows: [{
    id: id('9'), name: 'shadow-outer-x0-y4-b12-s0-a15', occurrences: 2,
    layers: [{
      kind: 'outer', offsetX: 0, offsetY: 4, blur: 12, spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.15 }
    }]
  }],
  colors: {
    primitives: [{
      id: id('5'), name: 'neutral-0', value: { r: 1, g: 1, b: 1, a: 1 },
      family: 'neutral', step: 0, provenance: 'observed', occurrences: 2
    }],
    semantic: [],
    interactive: []
  },
  spacing: [{
    id: id('4'), name: 'spacing-8', value: 8, occurrences: 2,
    evidence: { padding: 1, gap: 1, margin: 0 }, stateOccurrences: 1
  }],
  traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 1 }
}

const controlsData: ScanExport = {
  ...data,
  schemaVersion: '1.5.0',
  controls: [{
    id: id('7'),
    groupId: id('8'),
    name: 'button-primary-md',
    family: 'button',
    state: 'default',
    intent: 'primary',
    size: 'md',
    geometry: {
      height: 40, minWidth: null,
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 8, radius: 8, borderWidth: 0
    },
    appearance: {
      background: { r: 0, g: 0, b: 0, a: 1 },
      foreground: { r: 1, g: 1, b: 1, a: 1 },
      border: { r: 0, g: 0, b: 0, a: 0 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    typography: {
      fontFamilyStack: ['Inter'], fontStyle: 'normal', fontSizePx: 14,
      fontWeight: 400, lineHeightPx: 20, letterSpacingPx: 0
    },
    slots: { leading: null, trailing: null },
    content: { kind: 'text-only' },
    occurrences: 1,
    stateOccurrences: 1
  }]
}

const labeledControlsData: ScanExport = {
  ...controlsData,
  schemaVersion: '1.6.0',
  controls: controlsData.controls.map(token => ({
    ...token,
    sampleText: { value: 'Share', source: 'visible-text' as const }
  }))
}

const iconsData: ScanExport = {
  ...labeledControlsData,
  schemaVersion: '1.8.0',
  icons: [
    {
      id: id('p'),
      name: 'search',
      category: 'navigation',
      vectorSvg: '<svg viewBox="0 0 20 20"><path d="M0 0h2v2z"/></svg>',
      viewBox: { minX: 0, minY: 0, width: 20, height: 20 },
      observedSizes: [{ width: 20, height: 20, occurrences: 10 }],
      themes: [{
        theme: 'light',
        color: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        occurrences: 10
      }],
      occurrences: 10,
      stateOccurrences: 2
    },
    {
      id: id('i'),
      name: 'upgrade',
      category: 'navigation',
      vectorSvg: '<svg viewBox="0 0 20 20"><path d="M0 0h1v1z"/></svg>',
      viewBox: { minX: 0, minY: 0, width: 20, height: 20 },
      observedSizes: [{ width: 20, height: 20, occurrences: 1 }],
      themes: [{
        theme: 'light',
        color: { r: 0.17, g: 0.4, b: 0.77, a: 1 },
        occurrences: 1
      }],
      occurrences: 1,
      stateOccurrences: 1
    }
  ]
}

describe('createStaleAssetPlan', () => {
  it('removes only absent assets owned by the same origin', () => {
    const plan = createStaleAssetPlan(data, [
      { id: 'style:current', ownershipId: `${origin}|${id('a')}` },
      { id: 'style:missing-font-current', ownershipId: `${origin}|${id('c')}` },
      { id: 'style:stale', ownershipId: `${origin}|${id('b')}` },
      { id: 'style:other-origin', ownershipId: `https://other.example|${id('d')}` },
      { id: 'style:user', ownershipId: null }
    ], [
      { id: 'variable:current', ownershipId: `${origin}|${id('1')}` },
      { id: 'variable:percent', ownershipId: `${origin}|${id('2')}` },
      { id: 'variable:stale', ownershipId: `${origin}|${id('3')}` },
      { id: 'variable:other-origin', ownershipId: `https://other.example|${id('4')}` },
      { id: 'variable:user', ownershipId: null }
    ], [
      { id: 'effect:current', ownershipId: `${origin}|${id('9')}` },
      { id: 'effect:stale', ownershipId: `${origin}|${id('8')}` },
      { id: 'effect:other-origin', ownershipId: `https://other.example|${id('7')}` },
      { id: 'effect:user', ownershipId: null }
    ], [
      { id: 'color:current', ownershipId: `${origin}|${id('5')}` },
      { id: 'color:stale', ownershipId: `${origin}|${id('6')}` },
      { id: 'color:other-origin', ownershipId: `https://other.example|${id('7')}` },
      { id: 'color:user', ownershipId: null }
    ], [
      { id: 'spacing:current', ownershipId: `${origin}|${id('4')}` },
      { id: 'spacing:stale', ownershipId: `${origin}|${id('3')}` },
      { id: 'spacing:user', ownershipId: null }
    ])

    expect(plan.typography).toEqual([
      { id: 'style:stale', ownershipId: `${origin}|${id('b')}` }
    ])
    expect(plan.radiusVariables).toEqual([
      { id: 'variable:percent', ownershipId: `${origin}|${id('2')}` },
      { id: 'variable:stale', ownershipId: `${origin}|${id('3')}` }
    ])
    expect(plan.shadows).toEqual([
      { id: 'effect:stale', ownershipId: `${origin}|${id('8')}` }
    ])
    expect(plan.colors).toEqual([
      { id: 'color:stale', ownershipId: `${origin}|${id('6')}` }
    ])
    expect(plan.spacing).toEqual([
      { id: 'spacing:stale', ownershipId: `${origin}|${id('3')}` }
    ])
  })

  it('re-resolves candidates and skips an asset whose ownership changed during import', async () => {
    const removed: string[] = []
    const result = await removeStaleAssets({
      typography: [{ id: 'style:stale', ownershipId: `${origin}|${id('b')}` }],
      radiusVariables: [{ id: 'variable:stale', ownershipId: `${origin}|${id('3')}` }],
      shadows: [{ id: 'effect:stale', ownershipId: `${origin}|${id('8')}` }],
      colors: [{ id: 'color:stale', ownershipId: `${origin}|${id('6')}` }],
      spacing: [{ id: 'spacing:stale', ownershipId: `${origin}|${id('3')}` }]
    }, origin, {
      getTextStyleById: async () => ({
        getPluginData: () => `${origin}|${id('a')}`,
        remove: () => removed.push('style')
      }),
      getRadiusVariableById: async () => ({
        getPluginData: () => `${origin}|${id('3')}`,
        remove: () => removed.push('radius')
      }),
      getEffectStyleById: async () => ({
        getPluginData: () => `${origin}|${id('8')}`,
        remove: () => removed.push('shadow')
      }),
      getColorVariableById: async () => ({
        getPluginData: () => `${origin}|${id('6')}`,
        remove: () => removed.push('color')
      }),
      getSpacingVariableById: async () => ({
        getPluginData: () => `${origin}|${id('3')}`,
        remove: () => removed.push('spacing')
      })
    })

    expect(result).toEqual({
      typographyRemoved: 0, radiusRemoved: 1, shadowRemoved: 1,
      colorRemoved: 1, spacingRemoved: 1, controlRemoved: 0
    })
    expect(removed).toEqual(['radius', 'shadow', 'color', 'spacing'])
  })

  it('removes a stale color that is owned only through shared web plugin data', async () => {
    let removed = false
    const ownershipId = `${origin}|${id('6')}`
    const result = await removeStaleAssets({
      typography: [], radiusVariables: [], shadows: [],
      colors: [{ id: 'color:web-stale', ownershipId }],
      spacing: []
    }, origin, {
      getTextStyleById: async () => null,
      getRadiusVariableById: async () => null,
      getEffectStyleById: async () => null,
      getColorVariableById: async () => ({
        getPluginData: () => '',
        getSharedPluginData: (_namespace, key) =>
          key === 'smartScanColorVariableOwnership' ? ownershipId : '',
        remove: () => { removed = true }
      }),
      getSpacingVariableById: async () => null
    })

    expect(result.colorRemoved).toBe(1)
    expect(removed).toBe(true)
  })

  it('does not remove radius variables when importing legacy typography-only JSON', () => {
    const legacy = {
      ...data, schemaVersion: '1.0.0' as const, borderRadii: [], shadows: [],
      colors: { primitives: [], semantic: [], interactive: [] }, spacing: []
    }
    const plan = createStaleAssetPlan(legacy, [
      { id: 'style:stale', ownershipId: `${origin}|${id('b')}` }
    ], [
      { id: 'variable:existing', ownershipId: `${origin}|${id('3')}` }
    ], [
      { id: 'effect:existing', ownershipId: `${origin}|${id('8')}` }
    ], [
      { id: 'color:existing', ownershipId: `${origin}|${id('6')}` }
    ], [
      { id: 'spacing:existing', ownershipId: `${origin}|${id('3')}` }
    ])

    expect(plan.typography).toHaveLength(1)
    expect(plan.radiusVariables).toEqual([])
    expect(plan.shadows).toEqual([])
    expect(plan.colors).toEqual([])
    expect(plan.spacing).toEqual([])
  })

  it('does not remove shadow styles when importing 1.1 JSON', () => {
    const previous = {
      ...data, schemaVersion: '1.1.0' as const, shadows: [],
      colors: { primitives: [], semantic: [], interactive: [] }, spacing: []
    }
    const plan = createStaleAssetPlan(previous, [], [], [
      { id: 'effect:existing', ownershipId: `${origin}|${id('8')}` }
    ])

    expect(plan.shadows).toEqual([])
    expect(plan.colors).toEqual([])
    expect(plan.spacing).toEqual([])
  })

  it('does not remove color variables when importing 1.2 JSON', () => {
    const previous = {
      ...data, schemaVersion: '1.2.0' as const,
      colors: { primitives: [], semantic: [], interactive: [] }, spacing: []
    }
    const plan = createStaleAssetPlan(previous, [], [], [], [
      { id: 'color:existing', ownershipId: `${origin}|${id('6')}` }
    ])
    expect(plan.colors).toEqual([])
    expect(plan.spacing).toEqual([])
  })

  it('does not remove spacing variables when importing 1.3 JSON', () => {
    const previous = {
      ...data,
      schemaVersion: '1.3.0' as const,
      spacing: []
    }
    const plan = createStaleAssetPlan(previous, [], [], [], [], [
      { id: 'spacing:existing', ownershipId: `${origin}|${id('3')}` }
    ])
    expect(plan.spacing).toEqual([])
  })

  it('does not remove any prior asset when the scan has page failures', () => {
    const incomplete = {
      ...data,
      traversal: { ...data.traversal, failures: 1 }
    }
    const plan = createStaleAssetPlan(incomplete, [
      { id: 'style:stale', ownershipId: `${origin}|${id('b')}` }
    ], [
      { id: 'variable:stale', ownershipId: `${origin}|${id('3')}` }
    ], [
      { id: 'effect:stale', ownershipId: `${origin}|${id('8')}` }
    ], [
      { id: 'color:stale', ownershipId: `${origin}|${id('6')}` }
    ], [
      { id: 'spacing:stale', ownershipId: `${origin}|${id('3')}` }
    ])

    expect(plan).toEqual({
      typography: [], radiusVariables: [], shadows: [], colors: [], spacing: [], controls: []
    })
  })

  it('cleans only stale same-origin controls for complete 1.5 imports', async () => {
    const plan = createStaleAssetPlan(
      controlsData,
      [], [], [], [], [],
      [
        { id: 'component:current', ownershipId: `${origin}|${id('7')}` },
        {
          id: 'set:current',
          ownershipId: `${origin}|presentation:button|primary|md|solid-dark|light|text-only`
        },
        { id: 'component:stale', ownershipId: `${origin}|${id('6')}` },
        { id: 'component:user', ownershipId: null },
        { id: 'component:other', ownershipId: `https://other.example|${id('6')}` }
      ]
    )
    expect(plan.controls).toEqual([
      {
        id: 'set:current',
        ownershipId:
          `${origin}|presentation:button|primary|md|solid-dark|light|text-only`
      },
      { id: 'component:stale', ownershipId: `${origin}|${id('6')}` }
    ])

    let removed = false
    const result = await removeStaleAssets(plan, origin, {
      getTextStyleById: async () => null,
      getRadiusVariableById: async () => null,
      getEffectStyleById: async () => null,
      getColorVariableById: async () => null,
      getSpacingVariableById: async () => null,
      getControlNodeById: async () => ({
        getPluginData: key =>
          key === 'smartScanControlOwnership' ? `${origin}|${id('6')}` : '',
        remove: () => { removed = true }
      })
    })
    expect(result.controlRemoved).toBe(1)
    expect(removed).toBe(true)
  })

  it('removes earlier duplicate control ownership while keeping the current asset selected by import planning', () => {
    const ownershipId = `${origin}|${id('7')}`
    const plan = createStaleAssetPlan(
      controlsData,
      [], [], [], [], [],
      [
        { id: 'component:duplicate', ownershipId },
        { id: 'component:keeper', ownershipId }
      ]
    )

    expect(plan.controls).toEqual([
      { id: 'component:duplicate', ownershipId }
    ])
  })

  it('migrates duplicated qualified controls to one shared reusable family', () => {
    const templateId = id('a')
    const sharedDefaultId = id('7')
    const family = (logicalId: string, instanceId: string) => {
      const base = {
        ...controlsData.controls[0]!,
        id: sharedDefaultId,
        groupId: templateId,
        templateId,
        logicalControlId: logicalId,
        instanceId,
        state: 'default' as const
      }
      return [
        base,
        {
          ...base,
          id: id('8'),
          state: 'hover' as const,
          appearance: {
            ...base.appearance,
            background: { r: 0.2, g: 0.2, b: 0.2, a: 1 }
          }
        }
      ]
    }
    const firstLogicalId = id('b')
    const secondLogicalId = id('c')
    const currentData: ScanExport = {
      ...controlsData,
      schemaVersion: '1.9.0',
      controls: [
        ...family(firstLogicalId, id('d')),
        ...family(secondLogicalId, id('e'))
      ],
      icons: [],
      composites: []
    }
    const firstQualified =
      `${origin}|${sharedDefaultId}|presentation:${firstLogicalId}`
    const secondQualified =
      `${origin}|${sharedDefaultId}|presentation:${secondLogicalId}`
    const sharedHoverId = id('8')
    const firstQualifiedHover =
      `${origin}|${sharedHoverId}|presentation:${firstLogicalId}`
    const secondQualifiedHover =
      `${origin}|${sharedHoverId}|presentation:${secondLogicalId}`
    const firstSet = `${origin}|presentation:${firstLogicalId}`
    const secondSet = `${origin}|presentation:${secondLogicalId}`
    const currentPlan = createControlImportPlan(currentData, [], [])
    const sharedGroup = currentPlan.groups[0]!

    const plan = createStaleAssetPlan(
      currentData,
      [], [], [], [], [],
      [
        { id: 'component:first', ownershipId: firstQualified },
        { id: 'component:second', ownershipId: secondQualified },
        { id: 'component:first-hover', ownershipId: firstQualifiedHover },
        { id: 'component:second-hover', ownershipId: secondQualifiedHover },
        { id: 'set:first', ownershipId: firstSet },
        { id: 'set:second', ownershipId: secondSet },
        {
          id: 'set:shared',
          ownershipId: sharedGroup.groupOwnershipId
        },
        ...sharedGroup.entries.map((entry, index) => ({
          id: `component:shared-${index}`,
          ownershipId: entry.ownershipId
        }))
      ]
    )

    expect(plan.controls).toEqual([
      { id: 'component:first', ownershipId: firstQualified },
      { id: 'component:second', ownershipId: secondQualified },
      { id: 'component:first-hover', ownershipId: firstQualifiedHover },
      { id: 'component:second-hover', ownershipId: secondQualifiedHover },
      { id: 'set:first', ownershipId: firstSet },
      { id: 'set:second', ownershipId: secondSet }
    ])
  })

  it('cleans every covered stale asset for a complete 1.6 import', () => {
    const plan = createStaleAssetPlan(
      labeledControlsData,
      [{ id: 'style:stale', ownershipId: `${origin}|${id('b')}` }],
      [{ id: 'radius:stale', ownershipId: `${origin}|${id('3')}` }],
      [{ id: 'shadow:stale', ownershipId: `${origin}|${id('8')}` }],
      [{ id: 'color:stale', ownershipId: `${origin}|${id('6')}` }],
      [{ id: 'spacing:stale', ownershipId: `${origin}|${id('3')}` }],
      [{ id: 'control:stale', ownershipId: `${origin}|${id('6')}` }]
    )

    expect(plan.typography).toHaveLength(1)
    expect(plan.radiusVariables).toHaveLength(1)
    expect(plan.shadows).toHaveLength(1)
    expect(plan.colors).toHaveLength(1)
    expect(plan.spacing).toHaveLength(1)
    expect(plan.controls).toHaveLength(1)
  })

  it('does not clean controls for 1.0–1.4 or incomplete 1.5 imports', () => {
    const existing = [{ id: 'component:stale', ownershipId: `${origin}|${id('6')}` }]
    expect(createStaleAssetPlan(data, [], [], [], [], [], existing).controls).toEqual([])
    expect(createStaleAssetPlan(
      { ...controlsData, traversal: { ...controlsData.traversal, failures: 1 } },
      [], [], [], [], [], existing
    ).controls).toEqual([])
  })

  it('preserves current per-icon accent variables and removes only absent icon roles', () => {
    const accentOwnership =
      `${origin}|icon-color:accent:${iconsData.icons[1]!.id}`
    const staleAccentOwnership =
      `${origin}|icon-color:accent:${id('z')}`
    const plan = createStaleAssetPlan(
      iconsData,
      [], [], [], [], [], [],
      [
        { id: 'variable:primary', ownershipId: `${origin}|icon-color:primary` },
        { id: 'variable:hover', ownershipId: `${origin}|icon-color:hover-background` },
        { id: 'variable:accent-current', ownershipId: accentOwnership },
        { id: 'variable:accent-stale', ownershipId: staleAccentOwnership }
      ],
      []
    )

    expect(plan.iconVariables).toEqual([
      {
        id: 'variable:hover',
        ownershipId: `${origin}|icon-color:hover-background`
      },
      { id: 'variable:accent-stale', ownershipId: staleAccentOwnership }
    ])
  })

  it('cleans only stale same-origin composite assets for complete 1.9 imports', () => {
    const sourceControl = {
      ...labeledControlsData.controls[0]!,
      templateId: id('t'),
      logicalControlId: id('l'),
      instanceId: id('n')
    }
    const data19: ScanExport = {
      ...iconsData,
      schemaVersion: '1.9.0',
      controls: [sourceControl],
      composites: [{
        id: id('q'),
        templateId: id('r'),
        logicalCompositeId: id('s'),
        name: 'menu-vertical',
        kind: 'menu',
        state: 'default',
        geometry: {
          width: 200, height: 96,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          gap: 4, radius: 12, borderWidth: 1
        },
        appearance: {
          background: { r: 1, g: 1, b: 1, a: 1 },
          foreground: { r: 0, g: 0, b: 0, a: 1 },
          border: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
          outline: { r: 0, g: 0, b: 0, a: 0 },
          outlineWidth: 0, outlineOffset: 0, shadows: []
        },
        layout: {
          direction: 'vertical', align: 'stretch', justify: 'start',
          wrap: false, widthBehavior: 'hug'
        },
        children: [0, 1].map(() => ({
          kind: 'control' as const,
          controlId: sourceControl.id,
          instanceId: sourceControl.instanceId,
          state: sourceControl.state
        })),
        occurrences: 1,
        stateOccurrences: 1
      }]
    }
    const plan = createStaleAssetPlan(
      data19,
      [], [], [], [], [], [], [], [],
      [
        {
          id: 'composite:current',
          ownershipId: `${origin}|composite:${id('q')}`
        },
        {
          id: 'composite:stale',
          ownershipId: `${origin}|composite:${id('z')}`
        },
        { id: 'composite:user', ownershipId: null }
      ]
    )

    expect(plan.composites).toEqual([{
      id: 'composite:stale',
      ownershipId: `${origin}|composite:${id('z')}`
    }])
  })
})
