import { describe, expect, it } from 'vitest'

import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import type { CompositeToken, ControlToken, ScanExport } from '../../src/shared/schema'

const origin = 'https://example.com'
const id = (character: string) => `sha256:${character.repeat(64)}`

function control(
  character: string,
  logicalCharacter: string,
  label: string
): ControlToken {
  return {
    id: id(character),
    groupId: id('a'),
    templateId: id('a'),
    logicalControlId: id(logicalCharacter),
    instanceId: id(character.toUpperCase()),
    name: 'button-tertiary-sm',
    family: 'button',
    state: 'default',
    intent: 'tertiary',
    size: 'sm',
    geometry: {
      height: 40,
      minWidth: 220,
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 8,
      radius: 8,
      borderWidth: 0
    },
    appearance: {
      background: { r: 1, g: 1, b: 1, a: 0 },
      foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
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
    content: { kind: 'text-only' },
    layout: { widthBehavior: 'fill' },
    sampleText: { value: label, source: 'visible-text' },
    occurrences: 1,
    stateOccurrences: 1
  }
}

function composite(
  character: string,
  logicalCharacter: string,
  children: CompositeToken['children'],
  kind: CompositeToken['kind'] = 'menu'
): CompositeToken {
  return {
    id: id(character),
    templateId: id(character === '8' ? '6' : '5'),
    logicalCompositeId: id(logicalCharacter),
    name: `${kind}-vertical`,
    kind,
    state: 'default',
    geometry: {
      width: 244,
      height: 104,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 4,
      radius: 12,
      borderWidth: 1
    },
    appearance: {
      background: { r: 1, g: 1, b: 1, a: 1 },
      foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
      border: { r: 0.86, g: 0.86, b: 0.86, a: 1 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    layout: {
      direction: 'vertical',
      align: 'stretch',
      justify: 'start',
      wrap: false,
      widthBehavior: 'hug'
    },
    children,
    occurrences: 1,
    stateOccurrences: 1
  }
}

function scan(): ScanExport {
  const first = control('1', 'b', 'Create an image')
  const second = control('2', 'c', 'Search the web')
  const inner = composite('7', 'd', [
    { kind: 'control', controlId: first.id, instanceId: first.instanceId!, state: 'default' },
    { kind: 'control', controlId: second.id, instanceId: second.instanceId!, state: 'default' }
  ])
  const parent = composite('8', 'e', [
    { kind: 'composite', compositeId: inner.id },
    { kind: 'control', controlId: first.id, instanceId: first.instanceId!, state: 'default' }
  ], 'popover')
  return {
    schemaVersion: '1.9.0',
    source: {
      siteLabel: 'example.com',
      origin,
      scannedAt: '2026-08-01T00:00:00.000Z',
      locale: 'en',
      platform: 'macOS'
    },
    typography: [],
    borderRadii: [],
    shadows: [],
    colors: { primitives: [], semantic: [], interactive: [] },
    spacing: [],
    controls: [first, second],
    icons: [],
    composites: [parent, inner],
    traversal: {
      visitedStates: 1,
      skippedUnsafe: 0,
      skippedUncertain: 0,
      failures: 0
    },
    filtered: { brandAssets: 0, personalTextNodes: 0 }
  }
}

describe('createCompositeImportPlan', () => {
  it('keeps a measured static UI region ahead of its list and search children', () => {
    const data = scan()
    const list = data.controls[0]!
    const search = data.controls[1]!
    const header = {
      kind: 'static-text-region' as const,
      templateId: id('f'),
      instanceId: id('F'),
      placement: { x: 0, y: 0, width: 309, height: 59 },
      geometry: {
        width: 309,
        height: 59,
        padding: { top: 20, right: 24, bottom: 20, left: 24 },
        gap: 0,
        radius: 0,
        borderWidth: 0,
        borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
      },
      appearance: {
        background: { r: 1, g: 1, b: 1, a: 0 },
        foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0.1 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: []
      },
      text: {
        source: 'visible-static-ui' as const,
        value: 'Menu label',
        placement: { x: 24, y: 20, width: 261, height: 18 },
        typographyId: id('e'),
        foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 }
      }
    }
    const parent: CompositeToken = {
      ...data.composites[0]!,
      geometry: {
        ...data.composites[0]!.geometry,
        width: 309,
        height: 577.5,
        padding: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      children: [
        header,
        {
          kind: 'control', controlId: list.id, instanceId: list.instanceId!, state: 'default',
          placement: { x: 0, y: 59, width: 309, height: 437.5 }
        },
        {
          kind: 'control', controlId: search.id, instanceId: search.instanceId!, state: 'default',
          placement: { x: 0, y: 496.5, width: 309, height: 81 }
        }
      ]
    }
    const current: ScanExport = {
      ...data,
      schemaVersion: '1.12.0',
      typography: [{
        id: id('e'), name: 'Synthetic menu title', fontFamilyStack: ['Arial'],
        fontStyle: 'normal', fontSizePx: 18, fontWeight: 500,
        lineHeightPx: 18, letterSpacingPx: -0.18, role: 'control', occurrences: 1
      }],
      composites: [parent],
      diagnostics: { controls: [], composites: [] }
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )

    const entry = createCompositeImportPlan(current, controls, [], [
      { family: 'Arial', style: 'Regular' }
    ]).groups[0]!.entries[0]!

    expect(entry.children).toEqual([
      expect.objectContaining({
        kind: 'static-text-region',
        source: header,
        fontName: { family: 'Arial', style: 'Regular' }
      }),
      expect.objectContaining({ kind: 'control', placement: { x: 0, y: 59, width: 309, height: 437.5 } }),
      expect.objectContaining({ kind: 'control', placement: { x: 0, y: 496.5, width: 309, height: 81 } })
    ])
  })

  it('keeps excluded atomic evidence as anonymous structure inside a meaningful composite', () => {
    const data = scan()
    const original = data.controls[0]!
    const anonymous: ControlToken = {
      ...original,
      sampleText: undefined,
      supportingText: undefined,
      slots: { leading: null, trailing: null },
      appearance: {
        ...original.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      geometry: { ...original.geometry, borderWidth: 0 }
    }
    const current: ScanExport = {
      ...data,
      controls: [anonymous, data.controls[1]!],
      composites: data.composites.map(source => source.kind === 'popover'
        ? {
            ...source,
            children: [source.children[0]!, {
              kind: 'control',
              controlId: data.controls[1]!.id,
              instanceId: data.controls[1]!.instanceId!,
              state: 'default'
            }]
          }
        : source)
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(current, controls, [])
    const parent = plan.groups.find(group => group.entries[0]?.source.kind === 'popover')

    expect(controls.groups).toHaveLength(1)
    expect(parent?.entries[0]?.children).toEqual([
      expect.objectContaining({
        kind: 'structure',
        compositeId: data.composites.find(source => source.kind === 'menu')?.id,
        children: expect.arrayContaining([
          expect.objectContaining({
            kind: 'structure',
            controlId: anonymous.id,
            source: anonymous
          }),
          expect.objectContaining({
            kind: 'control',
            controlId: data.controls[1]!.id,
            controlOwnershipId: expect.stringContaining(`${origin}|`)
          })
        ])
      }),
      expect.objectContaining({ kind: 'control' })
    ])
  })

  it('keeps a filtered singleton safety shell as parent structure with its input binding', () => {
    const data = scan()
    const first = data.controls[0]!
    const second = data.controls[1]!
    const safetyShell: CompositeToken = {
      ...composite('9', 'f', [{
        kind: 'control',
        controlId: second.id,
        instanceId: second.instanceId!,
        state: 'default',
        placement: { x: 16, y: 17, width: 212, height: 40 }
      }], 'control-group'),
      geometry: {
        width: 244,
        height: 74,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        gap: 0,
        radius: 0,
        borderWidth: 0,
        borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
      },
      appearance: {
        ...data.composites[0]!.appearance,
        background: { r: 1, g: 1, b: 1, a: 0 }
      }
    }
    const parent: CompositeToken = {
      ...data.composites[0]!,
      geometry: {
        ...data.composites[0]!.geometry,
        height: 178
      },
      children: [
        {
          kind: 'control',
          controlId: first.id,
          instanceId: first.instanceId!,
          state: 'default',
          placement: { x: 8, y: 8, width: 220, height: 40 }
        },
        {
          kind: 'control',
          controlId: second.id,
          instanceId: second.instanceId!,
          state: 'default',
          placement: { x: 8, y: 56, width: 220, height: 40 }
        },
        {
          kind: 'composite',
          compositeId: safetyShell.id,
          placement: { x: 0, y: 104, width: 244, height: 74 }
        }
      ]
    }
    const parentLogicalId = id('e')
    const parentStates = ['default', 'hover', 'focus', 'pressed'] as const
    const parents = ['a', 'b', 'c', 'd'].map((character, index) => ({
      ...parent,
      id: id(character),
      templateId: id(character),
      logicalCompositeId: parentLogicalId,
      state: parentStates[index]!,
      appearance: {
        ...parent.appearance,
        background: { r: 1, g: 1, b: 1, a: 1 - index * 0.01 }
      }
    }))
    const current: ScanExport = {
      ...data,
      composites: [...parents, safetyShell]
    }
    const controls = createControlImportPlan(current, [], [])
    const plan = createCompositeImportPlan(current, controls, [])
    const entries = parents.map(parent => plan.groups.find(group =>
      group.entries.some(candidate => candidate.source.id === parent.id)
    )?.entries.find(candidate => candidate.source.id === parent.id))

    expect(plan.groups.some(group => group.entries.some(candidate =>
      candidate.source.id === safetyShell.id
    ))).toBe(false)
    expect(entries.map(entry => entry?.source.id)).toEqual(parents.map(parent => parent.id))
    for (const entry of entries) {
      expect(entry?.children).toContainEqual(expect.objectContaining({
        kind: 'structure',
        compositeId: safetyShell.id,
        placement: { x: 0, y: 104, width: 244, height: 74 },
        source: safetyShell,
        children: [expect.objectContaining({
          kind: 'control',
          controlId: second.id,
          instanceId: second.instanceId,
          placement: { x: 16, y: 17, width: 212, height: 40 }
        })]
      }))
    }
  })

  it('drops only unplaced anonymous fragments from an otherwise measured shell', () => {
    const data = scan()
    const first = data.controls[0]!
    const second = data.controls[1]!
    const anonymous: ControlToken = {
      ...control('3', 'f', ''),
      sampleText: undefined,
      supportingText: undefined,
      slots: { leading: null, trailing: null },
      appearance: {
        ...first.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      geometry: { ...first.geometry, borderWidth: 0 }
    }
    const shell = composite('9', '9', [
      {
        kind: 'control',
        controlId: first.id,
        instanceId: first.instanceId!,
        state: 'default',
        placement: { x: 8, y: 8, width: 220, height: 40 }
      },
      {
        kind: 'control',
        controlId: second.id,
        instanceId: second.instanceId!,
        state: 'default',
        placement: { x: 8, y: 56, width: 220, height: 40 }
      },
      {
        kind: 'control',
        controlId: anonymous.id,
        instanceId: anonymous.instanceId!,
        state: 'default'
      }
    ])
    const current: ScanExport = {
      ...data,
      controls: [first, second, anonymous],
      composites: [shell]
    }
    const controls = createControlImportPlan(current, [], [])
    const entry = createCompositeImportPlan(current, controls, [])
      .groups[0]?.entries[0]

    expect(entry?.source.children).toHaveLength(3)
    expect(entry?.children).toHaveLength(2)
    expect(entry?.children.every(child => child.placement)).toBe(true)
    expect(entry?.layoutSource?.children).toEqual(shell.children.slice(0, 2))
  })

  it('does not create a composite that contains only anonymous structure', () => {
    const data = scan()
    const anonymous = data.controls.map(source => ({
      ...source,
      sampleText: undefined,
      supportingText: undefined,
      slots: { leading: null, trailing: null },
      appearance: {
        ...source.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      geometry: { ...source.geometry, borderWidth: 0 }
    })) satisfies ControlToken[]
    const current: ScanExport = { ...data, controls: anonymous }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )

    expect(controls.groups).toEqual([])
    expect(createCompositeImportPlan(current, controls, []).groups).toEqual([])
  })

  it('plans nested composites after their atomic dependencies and preserves instance content', () => {
    const data = scan()
    const controls = createControlImportPlan(
      data,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(data, controls, [])

    expect(plan.groups).toHaveLength(2)
    expect(plan.groups.map(group => group.entries[0]?.source.kind)).toEqual([
      'menu', 'popover'
    ])
    expect(plan.groups[0]?.entries[0]?.children).toEqual([
      expect.objectContaining({
        kind: 'control',
        sampleText: 'Create an image'
      }),
      expect.objectContaining({
        kind: 'control',
        sampleText: 'Search the web'
      })
    ])
    expect(plan.groups[1]?.entries[0]?.children[0]).toMatchObject({
      kind: 'composite',
      compositeOwnershipId: plan.groups[0]?.entries[0]?.ownershipId
    })
  })

  it('creates a state set only from matching logical composite evidence', () => {
    const data = scan()
    const source = data.composites[1]!
    const hover: CompositeToken = {
      ...source,
      id: id('9'),
      state: 'hover',
      appearance: {
        ...source.appearance,
        background: { r: 0.94, g: 0.94, b: 0.94, a: 1 }
      }
    }
    const withState: ScanExport = {
      ...data,
      composites: [source, hover]
    }
    const controls = createControlImportPlan(
      withState,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(withState, controls, [])

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({
      kind: 'component_set',
      stateEvidenceId: source.logicalCompositeId
    })
    expect(plan.groups[0]?.entries.map(entry => entry.targetName)).toEqual([
      'State=Default', 'State=Hover'
    ])
  })

  it('filters an incompatible legacy portal whose extra height is not explained by its children', () => {
    const data = scan()
    const source = data.composites[1]!
    const hover: CompositeToken = {
      ...source,
      id: id('9'),
      state: 'hover',
      appearance: {
        ...source.appearance,
        background: { r: 0.94, g: 0.94, b: 0.94, a: 1 }
      }
    }
    const incompatible: CompositeToken = {
      ...source,
      id: id('3'),
      geometry: { ...source.geometry, width: 320, height: 304 },
      children: [
        ...source.children,
        source.children[0]!
      ]
    }
    const current: ScanExport = {
      ...data,
      composites: [source, hover, incompatible]
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(current, controls, [])

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups.filter(group => group.kind === 'component_set'))
      .toHaveLength(1)
    expect(plan.groups.find(group => group.kind === 'component_set')?.entries
      .map(entry => entry.source.state)).toEqual(['default', 'hover'])
    expect(plan.groups.some(group => group.entries.some(entry =>
      entry.source.geometry.width === 320 &&
      entry.source.geometry.height === 304
    ))).toBe(false)
  })

  it('deduplicates identical reusable state families across logical locations', () => {
    const data = scan()
    const source = data.composites[1]!
    const hover: CompositeToken = {
      ...source,
      id: id('9'),
      state: 'hover',
      appearance: {
        ...source.appearance,
        background: { r: 0.94, g: 0.94, b: 0.94, a: 1 }
      }
    }
    const secondDefault: CompositeToken = {
      ...source,
      id: id('b'),
      logicalCompositeId: id('c')
    }
    const secondHover: CompositeToken = {
      ...hover,
      id: id('d'),
      logicalCompositeId: id('c')
    }
    const current: ScanExport = {
      ...data,
      composites: [source, hover, secondDefault, secondHover]
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(current, controls, [])

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({ kind: 'component_set' })
    expect(plan.groups[0]?.entries.map(entry => entry.source.state))
      .toEqual(['default', 'hover'])
  })

  it('keeps visually different reusable state families separate', () => {
    const data = scan()
    const source = data.composites[1]!
    const second: CompositeToken = {
      ...source,
      id: id('b'),
      logicalCompositeId: id('c'),
      appearance: {
        ...source.appearance,
        background: { r: 0.2, g: 0.2, b: 0.2, a: 1 }
      }
    }
    const current: ScanExport = { ...data, composites: [source, second] }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )

    expect(createCompositeImportPlan(current, controls, []).groups).toHaveLength(2)
  })

  it('creates a standalone replacement before an owned state set becomes stale', () => {
    const data = scan()
    const source = data.composites[1]!
    const current: ScanExport = { ...data, composites: [source] }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const targetName = 'Composite/Menu/Vertical/Hug'
    const previousSet = {
      id: 'set:previous',
      type: 'COMPONENT_SET' as const,
      name: targetName,
      ownershipId: null,
      groupOwnershipId:
        `${origin}|composite-presentation:${source.logicalCompositeId}`
    }
    const previousChild = {
      id: 'component:previous-default',
      type: 'COMPONENT' as const,
      name: 'State=Default',
      ownershipId: `${origin}|composite:${source.id}`,
      groupOwnershipId: null
    }

    expect(
      createCompositeImportPlan(
        current,
        controls,
        [previousSet, previousChild]
      ).groups[0]
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

  it('binds a collapsed Focus child to its visually equivalent Hover variant', () => {
    const data = scan()
    const base = data.controls[0]!
    const hover: ControlToken = {
      ...base,
      id: id('3'),
      state: 'hover',
      appearance: {
        ...base.appearance,
        background: { r: 0.9, g: 0.9, b: 0.9, a: 1 }
      }
    }
    const focus: ControlToken = {
      ...hover,
      id: id('4'),
      state: 'focus'
    }
    const source = {
      ...data.composites[1]!,
      geometry: {
        ...data.composites[1]!.geometry,
        height: 100
      },
      children: [
        {
          kind: 'control' as const,
          controlId: focus.id,
          instanceId: focus.instanceId!,
          state: 'focus' as const
        },
        {
          kind: 'control' as const,
          controlId: base.id,
          instanceId: base.instanceId!,
          state: 'default' as const
        }
      ]
    }
    const current: ScanExport = {
      ...data,
      controls: [base, hover, focus, data.controls[1]!],
      composites: [source]
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const group = controls.groups.find(candidate =>
      candidate.instances.some(instance => instance.id === focus.id)
    )!
    const hoverEntry = group.entries.find(entry => entry.source.state === 'hover')!
    const plan = createCompositeImportPlan(current, controls, [])
    const focusedChild = plan.groups[0]?.entries[0]?.children[0]

    expect(group.entries.map(entry => entry.source.state)).toEqual(['default', 'hover'])
    expect(focusedChild).toMatchObject({
      kind: 'control',
      state: 'focus',
      controlOwnershipId: hoverEntry.ownershipId
    })
  })

  it('binds a collapsed nested Composite state to its equivalent Hover variant', () => {
    const data = scan()
    const innerDefault = data.composites[1]!
    const innerHover: CompositeToken = {
      ...innerDefault,
      id: id('3'),
      state: 'hover',
      appearance: {
        ...innerDefault.appearance,
        background: { r: 0.9, g: 0.9, b: 0.9, a: 1 }
      }
    }
    const innerFocus: CompositeToken = {
      ...innerHover,
      id: id('4'),
      state: 'focus'
    }
    const parent: CompositeToken = {
      ...data.composites[0]!,
      children: [
        { kind: 'composite', compositeId: innerFocus.id },
        data.composites[0]!.children[1]!
      ]
    }
    const current: ScanExport = {
      ...data,
      composites: [parent, innerDefault, innerHover, innerFocus]
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(current, controls, [])
    const innerGroup = plan.groups.find(group =>
      group.entries.some(entry => entry.source.id === innerHover.id)
    )!
    const parentGroup = plan.groups.find(group =>
      group.entries.some(entry => entry.source.id === parent.id)
    )!
    const hoverEntry = innerGroup.entries.find(entry => entry.source.state === 'hover')!

    expect(innerGroup.entries.map(entry => entry.source.state)).toEqual(['default', 'hover'])
    expect(parentGroup.entries[0]?.children[0]).toMatchObject({
      kind: 'composite',
      compositeOwnershipId: hoverEntry.ownershipId
    })
  })

  it('propagates a user-owned Control name conflict to dependent Composites', () => {
    const data = scan()
    const initialControls = createControlImportPlan(
      data,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const first = data.controls[0]!
    const conflicted = initialControls.groups.find(group =>
      group.instances.some(instance => instance.id === first.id)
    )!
    const controls = createControlImportPlan(
      data,
      [{
        id: 'component:user-control',
        type: 'COMPONENT',
        name: conflicted.targetName,
        ownershipId: null,
        groupOwnershipId: null
      }],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(data, controls, [])

    expect(controls.groups.find(group => group.groupId === conflicted.groupId)?.action)
      .toBe('skip_conflict')
    expect(plan.groups.filter(group => group.entries.some(entry =>
      entry.source.children.some(child =>
        child.kind === 'control' && child.controlId === first.id
      )
    )).every(group => group.action === 'skip_conflict')).toBe(true)
  })

  it('propagates a nested Composite name conflict to its parent', () => {
    const data = scan()
    const controls = createControlImportPlan(
      data,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const initial = createCompositeImportPlan(data, controls, [])
    const inner = data.composites[1]!
    const innerGroup = initial.groups.find(group =>
      group.entries.some(entry => entry.source.id === inner.id)
    )!
    const plan = createCompositeImportPlan(data, controls, [{
      id: 'component:user-composite',
      type: 'COMPONENT',
      name: innerGroup.targetName,
      ownershipId: null,
      groupOwnershipId: null
    }])
    const conflictedInner = plan.groups.find(group =>
      group.entries.some(entry => entry.source.id === inner.id)
    )!
    const parent = plan.groups.find(group => group.entries.some(entry =>
      entry.source.children.some(child =>
        child.kind === 'composite' && child.compositeId === inner.id
      )
    ))!

    expect(conflictedInner.action).toBe('skip_conflict')
    expect(parent.action).toBe('skip_conflict')
  })

  it('does not merge Composite families whose child instance evidence differs', () => {
    const data = scan()
    const first = data.controls[0]!
    const secondInstance: ControlToken = {
      ...first,
      logicalControlId: id('f'),
      instanceId: id('6'),
      sampleText: { value: 'Different action', source: 'visible-text' }
    }
    const firstMenu = data.composites[1]!
    const secondMenu: CompositeToken = {
      ...firstMenu,
      id: id('3'),
      logicalCompositeId: id('f'),
      children: firstMenu.children.map((child, index) => index === 0 && child.kind === 'control'
        ? { ...child, instanceId: secondInstance.instanceId! }
        : child)
    }
    const current: ScanExport = {
      ...data,
      controls: [...data.controls, secondInstance],
      composites: [firstMenu, secondMenu]
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(current, controls, [])

    expect(plan.groups.filter(group =>
      group.entries[0]?.source.kind === 'menu'
    )).toHaveLength(2)
  })

  it('chooses one most complete snapshot for one logical shell', () => {
    const data = scan()
    const third = control('3', 'f', 'Third action')
    const first = data.controls[0]!
    const second = data.controls[1]!
    const compact = composite('4', 'd', [
      { kind: 'control', controlId: first.id, instanceId: first.instanceId!, state: 'default' },
      { kind: 'control', controlId: second.id, instanceId: second.instanceId!, state: 'default' }
    ], 'popover')
    const complete: CompositeToken = {
      ...composite('6', 'd', [
        { kind: 'control', controlId: first.id, instanceId: first.instanceId!, state: 'default' },
        { kind: 'control', controlId: second.id, instanceId: second.instanceId!, state: 'default' },
        { kind: 'control', controlId: third.id, instanceId: third.instanceId!, state: 'default' }
      ], 'popover'),
      templateId: id('6')
    }
    const current: ScanExport = {
      ...data,
      controls: [first, second, third],
      composites: [compact, complete]
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(current, controls, [])
    const popovers = plan.groups.filter(group =>
      group.entries[0]?.source.kind === 'popover'
    )

    expect(popovers).toHaveLength(1)
    expect(popovers[0]?.entries[0]?.source.id).toBe(complete.id)
    expect(popovers[0]?.entries[0]?.source.children).toHaveLength(3)
  })

  it('keeps a complete edge-anchored popover after correcting its measured direction', () => {
    const data = scan()
    const controls = [
      control('1', 'b', 'First section'),
      control('2', 'c', 'Second section'),
      control('3', 'd', 'Third section'),
      control('4', 'e', 'Fourth section')
    ]
    const source: CompositeToken = {
      ...composite('6', 'f', controls.map((item, index) => ({
        kind: 'control' as const,
        controlId: item.id,
        instanceId: item.instanceId!,
        state: item.state,
        placement: [
          { x: 0, y: 0, width: 400, height: 48 },
          { x: 16, y: 137, width: 332, height: 32 },
          { x: 352, y: 137, width: 32, height: 32 },
          { x: 0, y: 214, width: 400, height: 113 }
        ][index]
      })), 'popover'),
      geometry: {
        width: 400,
        height: 327,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        radius: 12,
        borderWidth: 0
      },
      appearance: {
        ...data.composites[0]!.appearance,
        background: { r: 1, g: 1, b: 1, a: 1 },
        shadows: [{
          kind: 'outer',
          offsetX: 0,
          offsetY: 6,
          blur: 18,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.12 }
        }]
      },
      layout: {
        direction: 'horizontal',
        align: 'start',
        justify: 'start',
        wrap: false,
        widthBehavior: 'hug',
        clipsContent: true
      }
    }
    const current: ScanExport = {
      ...data,
      controls,
      composites: [source]
    }
    const atomic = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(current, atomic, [])
    const entry = plan.groups.flatMap(group => group.entries).find(item =>
      item.source.logicalCompositeId === source.logicalCompositeId
    )

    expect(entry?.source.layout.direction).toBe('vertical')
    expect(entry?.source.geometry).toMatchObject({ width: 400, height: 327 })
  })

  it('normalizes legacy axis-unbounded composite evidence from its child geometry', () => {
    const data = scan()
    const source = data.composites[1]!
    const unbounded: CompositeToken = {
      ...source,
      name: 'menu-horizontal',
      geometry: {
        ...source.geometry,
        width: 289,
        height: 148864,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0
      },
      layout: {
        ...source.layout,
        direction: 'horizontal',
        align: 'start',
        widthBehavior: 'fill'
      }
    }
    const legacy: ScanExport = { ...data, composites: [unbounded] }
    const controls = createControlImportPlan(
      legacy,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(legacy, controls, [])

    expect(plan.groups[0]?.targetName).toBe('Composite/Menu/Vertical/Fill')
    expect(plan.groups[0]?.entries[0]?.source).toMatchObject({
      geometry: { width: 289, height: 80 },
      layout: { direction: 'vertical' }
    })
  })
})
