import { describe, expect, it } from 'vitest'
import type { ControlToken, ScanExport } from '../../src/shared/schema'
import {
  createControlImportPlan,
  type ExistingControlNode
} from '../../src/figma/control-import-plan'

const origin = 'https://example.com'

function token(state: ControlToken['state'], idCharacter: string): ControlToken {
  return {
    id: `sha256:${idCharacter.repeat(64)}`,
    groupId: `sha256:${'9'.repeat(64)}`,
    name: `button-primary-md-${state}`,
    family: 'button',
    state,
    intent: 'primary',
    size: 'md',
    geometry: {
      height: 40,
      minWidth: null,
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 8,
      radius: 8,
      borderWidth: 0
    },
    appearance: {
      background: state === 'hover'
        ? { r: 0.1, g: 0.1, b: 0.1, a: 1 }
        : { r: 0, g: 0, b: 0, a: 1 },
      foreground: { r: 1, g: 1, b: 1, a: 1 },
      border: { r: 0, g: 0, b: 0, a: 0 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    typography: {
      fontFamilyStack: ['Arial'],
      fontStyle: 'normal',
      fontSizePx: 14,
      fontWeight: 400,
      lineHeightPx: 20,
      letterSpacingPx: 0
    },
    slots: { leading: null, trailing: null },
    occurrences: 1,
    stateOccurrences: 1
  }
}

function modernFamily(
  logicalCharacter: string,
  instanceCharacter: string
): ControlToken[] {
  const templateId = `sha256:${'a'.repeat(64)}`
  const logicalControlId = `sha256:${logicalCharacter.repeat(64)}`
  const defaultToken = {
    ...token('default', '1'),
    groupId: templateId,
    templateId,
    logicalControlId,
    instanceId: `sha256:${instanceCharacter.repeat(64)}`
  }
  return [
    defaultToken,
    {
      ...defaultToken,
      id: `sha256:${'2'.repeat(64)}`,
      state: 'hover' as const,
      name: 'button-primary-md-hover',
      appearance: {
        ...defaultToken.appearance,
        background: { r: 0.2, g: 0.2, b: 0.2, a: 1 }
      }
    }
  ]
}

function data(controls: ControlToken[]): ScanExport {
  return {
    schemaVersion: '1.5.0',
    source: {
      siteLabel: 'example.com',
      origin,
      scannedAt: '2026-07-23T12:00:00.000Z',
      locale: 'en',
      platform: 'macOS'
    },
    typography: [],
    borderRadii: [],
    shadows: [],
    colors: { primitives: [], semantic: [], interactive: [] },
    spacing: [],
    controls,
    traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
    filtered: { brandAssets: 0, personalTextNodes: 0 }
  }
}

const fonts = [{ family: 'Arial', style: 'Regular' }]

describe('createControlImportPlan', () => {
  it('creates components from consolidated presentation groups instead of raw groups', () => {
    const first = {
      ...token('default', '1'),
      groupId: `sha256:${'1'.repeat(64)}`,
      size: 'custom' as const,
      geometry: { ...token('default', '1').geometry, height: 34 }
    }
    const second = {
      ...token('default', '2'),
      groupId: `sha256:${'2'.repeat(64)}`,
      size: 'custom' as const,
      geometry: { ...token('default', '2').geometry, height: 36 },
      stateOccurrences: 4
    }

    const plan = createControlImportPlan(data([first, second]), [], fonts)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.entries[0]?.source.id).toBe(second.id)
  })

  it('plans one observed state as one real Component', () => {
    const plan = createControlImportPlan(data([token('default', '1')]), [], fonts)
    expect(plan.groups).toEqual([
      expect.objectContaining({
        action: 'create',
        kind: 'component',
        targetName: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
        existingGroupNodeId: null
      })
    ])
    expect(plan.groups[0]?.entries).toEqual([
      expect.objectContaining({
        action: 'create',
        targetName: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
        fontName: fonts[0]
      })
    ])
  })

  it('plans multiple observed states as one Component Set with deterministic variants', () => {
    const plan = createControlImportPlan(
      data([token('hover', '2'), token('default', '1')]),
      [],
      fonts
    )
    expect(plan.groups[0]).toMatchObject({
      action: 'create',
      kind: 'component_set',
      targetName: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
      groupOwnershipId: `${origin}|presentation:button|primary|md|solid-dark|light|text-only`
    })
    expect(plan.groups[0]?.entries.map(entry => entry.targetName)).toEqual([
      'State=Default',
      'State=Hover'
    ])
  })

  it('plans an observed Expanded disclosure variant after Default', () => {
    const expanded = {
      ...token('expanded', '3'),
      appearance: {
        ...token('expanded', '3').appearance,
        background: { r: 0.3, g: 0.3, b: 0.3, a: 1 }
      }
    }
    const plan = createControlImportPlan(
      data([expanded, token('default', '1')]),
      [],
      fonts
    )

    expect(plan.groups[0]).toMatchObject({ kind: 'component_set' })
    expect(plan.groups[0]?.entries.map(entry => entry.targetName)).toEqual([
      'State=Default', 'State=Expanded'
    ])
  })

  it('merges reusable families after visually identical Expanded evidence is collapsed', () => {
    const first = modernFamily('b', 'c')
    const second = modernFamily('d', 'e')
    const expanded = {
      ...first[0]!,
      id: `sha256:${'3'.repeat(64)}`,
      state: 'expanded' as const,
      name: 'button-primary-md-expanded'
    }

    const plan = createControlImportPlan(
      data([...first, expanded, ...second]),
      [],
      fonts
    )

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({
      kind: 'component_set',
      entries: [
        expect.objectContaining({ targetName: 'State=Default' }),
        expect.objectContaining({ targetName: 'State=Hover' })
      ]
    })
    expect(plan.groups[0]?.instances).toHaveLength(5)
  })

  it('merges reusable families that each collapse to one rendered Component', () => {
    const noOpFamily = (logical: string, instance: string) => {
      const family = modernFamily(logical, instance)
      return family.map(source => source.state === 'hover'
        ? { ...source, appearance: family[0]!.appearance }
        : source)
    }

    const plan = createControlImportPlan(
      data([...noOpFamily('b', 'c'), ...noOpFamily('d', 'e')]),
      [],
      fonts
    )

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({
      kind: 'component',
      entries: [expect.objectContaining({ targetName: expect.stringContaining('Control/') })]
    })
    expect(plan.groups[0]?.instances).toHaveLength(4)
  })

  it('uses modern logical evidence for variants and collapses identical visual states', () => {
    const templateId = `sha256:${'a'.repeat(64)}`
    const logicalControlId = `sha256:${'b'.repeat(64)}`
    const instanceId = `sha256:${'c'.repeat(64)}`
    const base = {
      ...token('default', '1'),
      groupId: templateId,
      templateId,
      logicalControlId,
      instanceId
    }
    const identicalHover = {
      ...base,
      id: `sha256:${'2'.repeat(64)}`,
      state: 'hover' as const,
      name: 'button-primary-md-hover'
    }

    const collapsed = createControlImportPlan(
      data([base, identicalHover]),
      [],
      fonts
    )
    expect(collapsed.groups).toHaveLength(1)
    expect(collapsed.groups[0]).toMatchObject({ kind: 'component' })

    const paintedHover = {
      ...identicalHover,
      appearance: {
        ...identicalHover.appearance,
        background: { r: 0.2, g: 0.2, b: 0.2, a: 1 }
      }
    }
    const evidenced = createControlImportPlan(data([base, paintedHover]), [], fonts)
    expect(evidenced.groups[0]).toMatchObject({ kind: 'component_set' })
  })

  it('uses one stable import group for a reusable modern state family', () => {
    const first = modernFamily('b', 'c')
    const second = modernFamily('d', 'e')
    const combined = createControlImportPlan(
      data([...first, ...second]),
      [],
      fonts
    )
    const reduced = createControlImportPlan(data(second), [], fonts)

    expect(combined.groups).toHaveLength(1)
    expect(combined.groups[0]).toMatchObject({
      kind: 'component_set',
      instances: expect.arrayContaining([...first, ...second])
    })
    expect(combined.groups[0]?.entries.map(entry => entry.targetName)).toEqual([
      'State=Default', 'State=Hover'
    ])
    expect(reduced.groups[0]?.groupOwnershipId)
      .toBe(combined.groups[0]?.groupOwnershipId)

    const existing: ExistingControlNode[] = [{
      id: 'set:shared-family',
      type: 'COMPONENT_SET',
      name: combined.groups[0]!.targetName,
      ownershipId: null,
      groupOwnershipId: combined.groups[0]!.groupOwnershipId
    }, ...combined.groups[0]!.entries.map((entry, index) => ({
      id: `component:shared-${index}`,
      type: 'COMPONENT' as const,
      name: entry.targetName,
      ownershipId: entry.ownershipId,
      groupOwnershipId: null
    }))]
    const replay = createControlImportPlan(data(second), existing, fonts)

    expect(replay.groups[0]).toMatchObject({
      action: 'update',
      existingGroupNodeId: 'set:shared-family'
    })
    expect(replay.groups[0]?.entries.every(entry => entry.action === 'update'))
      .toBe(true)
  })

  it('keeps reusable ownership stable when accepted external IDs disagree', () => {
    const first = modernFamily('b', 'c')
    const second = modernFamily('d', 'e').map(source => ({
      ...source,
      id: source.state === 'default'
        ? `sha256:${'3'.repeat(64)}`
        : `sha256:${'4'.repeat(64)}`
    }))

    const combined = createControlImportPlan(data([...first, ...second]), [], fonts)
    const reduced = createControlImportPlan(data(second), [], fonts)

    expect(combined.groups).toHaveLength(1)
    expect(reduced.groups[0]?.groupOwnershipId)
      .toBe(combined.groups[0]?.groupOwnershipId)
  })

  it('does not reuse one owned Component across visually distinct modern presentation groups', () => {
    const legacyDefault: ExistingControlNode = {
      id: 'component:legacy-default',
      type: 'COMPONENT',
      name: 'State=Default',
      ownershipId: `${origin}|sha256:${'1'.repeat(64)}`,
      groupOwnershipId: null
    }
    const legacyHover: ExistingControlNode = {
      id: 'component:legacy-hover',
      type: 'COMPONENT',
      name: 'State=Hover',
      ownershipId: `${origin}|sha256:${'2'.repeat(64)}`,
      groupOwnershipId: null
    }
    const secondFamily = modernFamily('d', 'e').map(source =>
      source.state === 'hover'
        ? {
            ...source,
            id: `sha256:${'4'.repeat(64)}`,
            appearance: {
              ...source.appearance,
              background: { r: 0.6, g: 0.6, b: 0.6, a: 1 }
            }
          }
        : source
    )
    const plan = createControlImportPlan(
      data([...modernFamily('b', 'c'), ...secondFamily]),
      [legacyDefault, legacyHover],
      fonts
    )

    expect(plan.groups).toHaveLength(2)
    const ownershipIds = plan.groups.map(group =>
      group.entries.map(entry => entry.ownershipId)
    )
    expect(new Set(ownershipIds.flat()).size).toBe(4)
    expect(ownershipIds[0]).not.toEqual(ownershipIds[1])
    const defaultEntries = plan.groups.flatMap(group => group.entries)
      .filter(entry => entry.source.state === 'default')
    expect(defaultEntries
      .every(entry => entry.action === 'create' && entry.existingComponentId === null))
      .toBe(true)
    expect(new Set(defaultEntries.map(entry => entry.ownershipId)).size).toBe(2)
    expect(defaultEntries.every(entry =>
      entry.ownershipId.startsWith(`${origin}|sha256:`) &&
      entry.ownershipId.includes('|presentation:reusable:')
    )).toBe(true)
  })

  it('keeps legacy component ownership for a visual ID used by one presentation group', () => {
    const source = {
      ...token('default', '3'),
      templateId: `sha256:${'a'.repeat(64)}`,
      logicalControlId: `sha256:${'f'.repeat(64)}`,
      instanceId: `sha256:${'6'.repeat(64)}`
    }
    const existing: ExistingControlNode = {
      id: 'component:unique',
      type: 'COMPONENT',
      name: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
      ownershipId: `${origin}|${source.id}`,
      groupOwnershipId: null
    }

    expect(createControlImportPlan(data([source]), [existing], fonts)
      .groups[0]?.entries[0]).toMatchObject({
        action: 'update',
        ownershipId: `${origin}|${source.id}`,
        existingComponentId: existing.id
      })
  })

  it('updates exact owned nodes and never overwrites a user same-name node', () => {
    const source = token('default', '1')
    const owned: ExistingControlNode = {
      id: 'component:owned',
      type: 'COMPONENT',
      name: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
      ownershipId: `${origin}|${source.id}`,
      groupOwnershipId: null
    }
    expect(createControlImportPlan(data([source]), [owned], fonts).groups[0]).toMatchObject({
      action: 'update',
      existingGroupNodeId: owned.id,
      entries: [expect.objectContaining({ action: 'update', existingComponentId: owned.id })]
    })

    const userNode: ExistingControlNode = { ...owned, id: 'component:user', ownershipId: null }
    expect(createControlImportPlan(data([source]), [userNode], fonts).groups[0]).toMatchObject({
      action: 'skip_conflict',
      existingGroupNodeId: 'component:user'
    })
  })

  it('allows a same-source UI-Anatomist asset to vacate a reused presentation name', () => {
    const source = token('default', '1')
    const previousSmartScanNode: ExistingControlNode = {
      id: 'component:previous-presentation',
      type: 'COMPONENT',
      name: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
      ownershipId: `${origin}|sha256:${'2'.repeat(64)}`,
      groupOwnershipId: null
    }

    expect(
      createControlImportPlan(data([source]), [previousSmartScanNode], fonts)
        .groups[0]
    ).toMatchObject({
      action: 'create',
      existingGroupNodeId: null,
      conflictName: null
    })
  })

  it('replaces an obsolete Component Set when a presentation group shrinks to one state', () => {
    const source = token('default', '1')
    const targetName = 'Control/Button/Primary/SolidDark/Md/Light/TextOnly'
    const groupOwnershipId =
      `${origin}|presentation:button|primary|md|solid-dark|light|text-only`
    const oldSet: ExistingControlNode = {
      id: 'set:old',
      type: 'COMPONENT_SET',
      name: targetName,
      ownershipId: null,
      groupOwnershipId
    }
    const oldChild: ExistingControlNode = {
      id: 'component:old-child',
      type: 'COMPONENT',
      name: 'State=Default',
      ownershipId: `${origin}|${source.id}`,
      groupOwnershipId: null
    }

    expect(
      createControlImportPlan(data([source]), [oldSet, oldChild], fonts).groups[0]
    ).toMatchObject({
      action: 'create',
      kind: 'component',
      existingGroupNodeId: null,
      entries: [
        expect.objectContaining({
          action: 'create',
          existingComponentId: null
        })
      ]
    })
  })

  it('keeps different content structures as different readable component names', () => {
    const first = token('default', '1')
    const second = {
      ...token('default', '2'),
      groupId: `sha256:${'8'.repeat(64)}`,
      slots: { leading: { width: 20, height: 20 }, trailing: null },
      content: { kind: 'icon-only' as const }
    }
    const names = createControlImportPlan(data([first, second]), [], fonts)
      .groups.map(group => group.targetName)
    expect(new Set(names).size).toBe(2)
    expect(names.every(name =>
      name.startsWith('Control/Button/Primary/SolidDark/Md/Light')
    )).toBe(true)
  })
})
