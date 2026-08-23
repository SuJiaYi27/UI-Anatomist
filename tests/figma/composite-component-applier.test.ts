import { describe, expect, it, vi } from 'vitest'

import {
  applyCompositeImportPlan,
  COMPOSITE_GROUP_OWNERSHIP_KEY,
  COMPOSITE_NODE_OWNERSHIP_KEY,
  reflowCompositeComponentSet,
  type CompositeComponentPort,
  type CompositeComponentSetPort,
  type CompositeInstancePort,
  type CompositeRepository
} from '../../src/figma/composite-component-applier'
import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import type {
  AppliedControl,
  ControlComponentPort,
  ControlFramePort
} from '../../src/figma/control-component-applier'
import type { CompositeToken, ControlToken, ScanExport } from '../../src/shared/schema'

const origin = 'https://example.com'
const id = (character: string) => `sha256:${character.repeat(64)}`

function control(character: string, label: string): ControlToken {
  return {
    id: id(character),
    groupId: id('a'),
    templateId: id('a'),
    logicalControlId: id(character === '1' ? 'b' : 'c'),
    instanceId: id(character === '1' ? 'd' : 'e'),
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
      background: { r: 0, g: 0, b: 0, a: 0 },
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

function scan(): ScanExport {
  const first = control('1', 'Create an image')
  const second = control('2', 'Search the web')
  const composite: CompositeToken = {
    id: id('7'),
    templateId: id('5'),
    logicalCompositeId: id('6'),
    name: 'menu-vertical',
    kind: 'menu',
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
      widthBehavior: 'hug',
      clipsContent: true
    },
    children: [first, second].map(source => ({
      kind: 'control' as const,
      controlId: source.id,
      instanceId: source.instanceId!,
      state: source.state
    })),
    occurrences: 1,
    stateOccurrences: 1
  }
  return {
    schemaVersion: '1.9.0',
    source: {
      siteLabel: 'example.com', origin,
      scannedAt: '2026-08-01T00:00:00.000Z', locale: 'en', platform: 'macOS'
    },
    typography: [], borderRadii: [], shadows: [],
    colors: { primitives: [], semantic: [], interactive: [] },
    spacing: [], controls: [first, second], icons: [], composites: [composite],
    traversal: {
      visitedStates: 1, skippedUnsafe: 0, skippedUncertain: 0, failures: 0
    },
    filtered: { brandAssets: 0, personalTextNodes: 0 }
  }
}

function fakeComponent(idValue: string, type: 'atomic' | 'composite'): CompositeComponentPort {
  const data = new Map<string, string>()
  const shared = new Map<string, string>()
  return {
    id: idValue,
    type: 'COMPONENT',
    x: 0,
    y: 0,
    name: type,
    description: '',
    layoutMode: 'NONE',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    itemSpacing: 0,
    cornerRadius: 0,
    fills: [], strokes: [], strokeWeight: 0, effects: [], clipsContent: false,
    width: 1, height: 1, children: [],
    appendChild(child) { this.children.push(child) },
    resize(width, height) { this.width = width; this.height = height },
    setPluginData(key, value) { data.set(key, value) },
    getPluginData(key) { return data.get(key) ?? '' },
    setSharedPluginData(namespace, key, value) {
      shared.set(`${namespace}|${key}`, value)
    },
    getSharedPluginData(namespace, key) {
      return shared.get(`${namespace}|${key}`) ?? ''
    },
    remove: vi.fn()
  }
}

function setup() {
  const data = scan()
  const controlPlan = createControlImportPlan(
    data,
    [],
    [{ family: 'Arial', style: 'Regular' }]
  )
  const compositePlan = createCompositeImportPlan(data, controlPlan, [])
  const atomic = fakeComponent('component:atomic', 'atomic') as ControlComponentPort
  const controlGroup = controlPlan.groups[0]!
  const appliedControls: AppliedControl[] = [{
    group: controlGroup,
    entry: controlGroup.entries[0]!,
    component: atomic,
    componentSet: null
  }]
  return { data, compositePlan, atomic, appliedControls }
}

function repository(created: CompositeComponentPort[]): CompositeRepository {
  let nextComponent = 0
  let nextInstance = 0
  return {
    createComponent() {
      const component = fakeComponent(`component:composite-${nextComponent++}`, 'composite')
      created.push(component)
      return component
    },
    createInstance(component) {
      const overrides = new Map<string, string>()
      return {
        id: `instance:${nextInstance++}`,
        type: 'INSTANCE',
        name: `Instance of ${component.name}`,
        sourceComponentId: component.id,
        width: component.width,
        height: component.height,
        layoutGrow: 0,
        overrides,
        resize(width, height) { this.width = width; this.height = height },
        remove: vi.fn()
      }
    },
    createFrame() {
      return {
        type: 'FRAME',
        name: '',
        layoutMode: 'NONE',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        itemSpacing: 0,
        fills: [],
        strokes: [],
        width: 1,
        height: 1,
        children: [],
        appendChild(child) { this.children.push(child) },
        resize(width, height) { this.width = width; this.height = height }
      } as ControlFramePort
    },
    overrideText(instance, nodeName, value) {
      instance.overrides.set(nodeName, value)
    },
    overrideIcon: vi.fn(),
    combineAsVariants: vi.fn(),
    getNodeById: async () => null
  }
}

describe('applyCompositeImportPlan', () => {
  it('renders a measured static header region before its existing list and search instances', async () => {
    const data = scan()
    const list = data.controls[0]!
    const search = data.controls[1]!
    const header = {
      kind: 'static-text-region' as const,
      templateId: id('f'),
      instanceId: id('F'),
      placement: { x: 0, y: 0, width: 309, height: 59 },
      geometry: {
        width: 309, height: 59,
        padding: { top: 20, right: 24, bottom: 20, left: 24 },
        gap: 0, radius: 0, borderWidth: 0,
        borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
      },
      appearance: {
        background: { r: 1, g: 1, b: 1, a: 0 },
        foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0.1 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0, outlineOffset: 0, shadows: []
      },
      text: {
        source: 'visible-static-ui' as const,
        value: 'Menu label',
        placement: { x: 24, y: 20, width: 261, height: 18 },
        typographyId: id('e'),
        foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 }
      }
    }
    const current: ScanExport = {
      ...data,
      schemaVersion: '1.12.0',
      typography: [{
        id: id('e'), name: 'Synthetic menu title', fontFamilyStack: ['Arial'],
        fontStyle: 'normal', fontSizePx: 18, fontWeight: 500,
        lineHeightPx: 18, letterSpacingPx: -0.18, role: 'control', occurrences: 1
      }],
      composites: [{
        ...data.composites[0]!,
        geometry: {
          ...data.composites[0]!.geometry,
          width: 309, height: 577.5,
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
      }],
      diagnostics: { controls: [], composites: [] }
    }
    const controls = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(
      current,
      controls,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const atomic = fakeComponent('component:atomic', 'atomic') as ControlComponentPort
    const created: CompositeComponentPort[] = []
    const repo = repository(created)
    const createdText: Array<{
      type: 'TEXT'
      name: string
      characters: string
      x: number
      y: number
      width: number
      height: number
      fontSize: number
      lineHeight: { value: number; unit: 'PIXELS' } | null
      letterSpacing: number | { value: number; unit: 'PIXELS' }
      fills: unknown[]
      textAutoResize: 'NONE'
      fontName: { family: string; style: string } | null
      resize(width: number, height: number): void
    }> = []
    repo.createText = () => {
      const text = {
        type: 'TEXT' as const,
        name: '', characters: '', x: 0, y: 0, width: 1, height: 1,
        fontSize: 0, lineHeight: null,
        letterSpacing: 0,
        fills: [], textAutoResize: 'NONE' as const,
        fontName: null,
        resize(width: number, height: number) { this.width = width; this.height = height }
      }
      createdText.push(text)
      return text
    }
    repo.loadFont = vi.fn().mockResolvedValue(undefined)
    const controlGroup = controls.groups[0]!

    await applyCompositeImportPlan(plan, [{
      group: controlGroup,
      entry: controlGroup.entries[0]!,
      component: atomic,
      componentSet: null
    }], repo)

    expect(created[0]).toMatchObject({ width: 309, height: 577.5, paddingTop: 0 })
    expect(created[0]?.children).toEqual([
      expect.objectContaining({ type: 'FRAME', name: 'Static UI region', x: 0, y: 0, width: 309, height: 59 }),
      expect.objectContaining({ type: 'INSTANCE', width: 309, height: 437.5 }),
      expect.objectContaining({ type: 'INSTANCE', width: 309, height: 81 })
    ])
    expect((created[0]?.children[0] as ControlFramePort).children).toEqual([
      expect.objectContaining({ type: 'TEXT', name: 'Static UI copy', characters: 'Menu label', x: 24, y: 20, width: 261, height: 18 })
    ])
    expect(repo.loadFont).toHaveBeenCalledWith({ family: 'Arial', style: 'Regular' })
    expect(createdText).toHaveLength(1)
  })

  it('uses measured child sizes for a regular composite layout', async () => {
    const data = scan()
    data.composites![0]!.geometry.height = 100
    data.composites![0]!.children = data.composites![0]!.children.map(
      (child, index) => ({
        ...child,
        placement: { x: 8, y: 8 + index * 44, width: 228, height: 40 }
      })
    )
    const controlPlan = createControlImportPlan(
      data,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const compositePlan = createCompositeImportPlan(data, controlPlan, [])
    const atomic = fakeComponent('component:public-atomic', 'atomic') as ControlComponentPort
    const controlGroup = controlPlan.groups[0]!
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(compositePlan, [{
      group: controlGroup,
      entry: controlGroup.entries[0]!,
      component: atomic,
      componentSet: null
    }], repository(created))

    expect(created[0]).toMatchObject({ layoutMode: 'VERTICAL', itemSpacing: 4 })
    expect(created[0]?.children).toEqual([
      expect.objectContaining({ width: 228, height: 40 }),
      expect.objectContaining({ width: 228, height: 40 })
    ])
  })

  it('uses absolute measured boxes for an irregular composite layout', async () => {
    const data = scan()
    data.composites![0]!.geometry.height = 140
    data.composites![0]!.children = data.composites![0]!.children.map(
      (child, index) => ({
        ...child,
        placement: {
          x: 8,
          y: index === 0 ? 8 : 80,
          width: 228,
          height: 40
        }
      })
    )
    const controlPlan = createControlImportPlan(
      data,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const compositePlan = createCompositeImportPlan(data, controlPlan, [])
    const atomic = fakeComponent('component:public-atomic', 'atomic') as ControlComponentPort
    const controlGroup = controlPlan.groups[0]!
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(compositePlan, [{
      group: controlGroup,
      entry: controlGroup.entries[0]!,
      component: atomic,
      componentSet: null
    }], repository(created))

    expect(created[0]?.layoutMode).toBe('NONE')
    expect(created[0]?.children).toEqual([
      expect.objectContaining({
        x: 8,
        y: 8,
        width: 228,
        height: 40
      }),
      expect.objectContaining({
        x: 8,
        y: 80,
        width: 228,
        height: 40
      })
    ])
    expect(created[0]?.children.every(child =>
      child.layoutPositioning === undefined
    )).toBe(true)
  })

  it('renders excluded atomic evidence as a structural Frame instead of an Instance', async () => {
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
      controls: [anonymous, data.controls[1]!]
    }
    current.composites![0]!.children.push({
      ...current.composites![0]!.children[1]!
    })
    const controlPlan = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const compositePlan = createCompositeImportPlan(current, controlPlan, [])
    const atomic = fakeComponent('component:public-atomic', 'atomic') as ControlComponentPort
    const controlGroup = controlPlan.groups[0]!
    const appliedControls: AppliedControl[] = [{
      group: controlGroup,
      entry: controlGroup.entries[0]!,
      component: atomic,
      componentSet: null
    }]
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      repository(created)
    )

    expect(created[0]?.children.map(child => child.type)).toEqual([
      'FRAME', 'INSTANCE', 'INSTANCE'
    ])
    expect(created[0]?.children[0]).toMatchObject({
      type: 'FRAME',
      name: 'Anonymous structure',
      width: 228,
      height: 40
    })
  })

  it('stretches anonymous structure inside a fill-width vertical composite without stretching a hug atomic child', async () => {
    const data = scan()
    data.composites![0]!.layout.align = 'start'
    data.composites![0]!.layout.widthBehavior = 'fill'
    data.controls[1]!.layout.widthBehavior = 'hug'
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
      geometry: { ...original.geometry, borderWidth: 0 },
      layout: { widthBehavior: 'hug' }
    }
    const current: ScanExport = {
      ...data,
      controls: [anonymous, data.controls[1]!]
    }
    current.composites![0]!.children.push({
      ...current.composites![0]!.children[1]!
    })
    const controlPlan = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const compositePlan = createCompositeImportPlan(current, controlPlan, [])
    const atomic = fakeComponent('component:public-atomic', 'atomic') as ControlComponentPort
    const controlGroup = controlPlan.groups[0]!
    const appliedControls: AppliedControl[] = [{
      group: controlGroup,
      entry: controlGroup.entries[0]!,
      component: atomic,
      componentSet: null
    }]
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      repository(created)
    )

    expect(created[0]?.children[0]).toMatchObject({
      type: 'FRAME',
      width: 228,
      height: 40
    })
    expect(created[0]?.children[1]).toMatchObject({
      type: 'INSTANCE',
      width: 1
    })
    expect(created[0]?.children[2]).toMatchObject({
      type: 'INSTANCE',
      width: 1
    })
  })

  it('preserves the measured row structure inside an anonymous nested composite', async () => {
    const data = scan()
    const publicControl = data.controls[1]!
    const anonymousRow = (character: string, instance: string): ControlToken => ({
      ...data.controls[0]!,
      id: id(character),
      logicalControlId: id(character),
      instanceId: id(instance),
      sampleText: undefined,
      supportingText: undefined,
      slots: { leading: null, trailing: null },
      appearance: {
        ...data.controls[0]!.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      geometry: {
        ...data.controls[0]!.geometry,
        height: 32,
        minWidth: null,
        borderWidth: 0
      },
      layout: { widthBehavior: 'hug' }
    })
    const firstRow = anonymousRow('3', '4')
    const secondRow = anonymousRow('5', '6')
    const nested: CompositeToken = {
      ...data.composites![0]!,
      id: id('8'),
      templateId: id('8'),
      logicalCompositeId: id('8'),
      kind: 'list',
      geometry: {
        ...data.composites![0]!.geometry,
        width: 220,
        height: 120,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0,
        borderWidth: 0
      },
      appearance: {
        ...data.composites![0]!.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      layout: {
        direction: 'vertical',
        align: 'start',
        justify: 'start',
        wrap: false,
        widthBehavior: 'fill',
        clipsContent: false
      },
      children: [firstRow, secondRow].map((source, index) => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state,
        placement: {
          x: 8,
          y: index === 0 ? 8 : 72,
          width: 204,
          height: 32
        }
      }))
    }
    const outer: CompositeToken = {
      ...data.composites![0]!,
      id: id('9'),
      templateId: id('9'),
      logicalCompositeId: id('9'),
      kind: 'panel',
      geometry: {
        ...data.composites![0]!.geometry,
        width: 244,
        height: 128,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0
      },
      layout: {
        direction: 'vertical',
        align: 'start',
        justify: 'start',
        wrap: false,
        widthBehavior: 'fill',
        clipsContent: false
      },
      children: [{
        kind: 'control',
        controlId: publicControl.id,
        instanceId: publicControl.instanceId!,
        state: publicControl.state
      }, {
        kind: 'control',
        controlId: publicControl.id,
        instanceId: publicControl.instanceId!,
        state: publicControl.state
      }, {
        kind: 'composite',
        compositeId: nested.id
      }]
    }
    const current: ScanExport = {
      ...data,
      controls: [publicControl, firstRow, secondRow],
      composites: [nested, outer]
    }
    const controlPlan = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const compositePlan = createCompositeImportPlan(current, controlPlan, [])
    const atomic = fakeComponent('component:public-atomic', 'atomic') as ControlComponentPort
    const controlGroup = controlPlan.groups[0]!
    const appliedControls: AppliedControl[] = [{
      group: controlGroup,
      entry: controlGroup.entries[0]!,
      component: atomic,
      componentSet: null
    }]
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      repository(created)
    )

    expect(created).toHaveLength(1)
    expect(created[0]?.children.map(child => child.type)).toEqual([
      'INSTANCE', 'INSTANCE', 'FRAME'
    ])
    const structure = created[0]?.children[2] as ControlFramePort
    expect(structure).toMatchObject({
      name: 'Anonymous structure',
      layoutMode: 'NONE',
      width: 228,
      height: 120
    })
    expect(structure.children).toHaveLength(2)
    expect(structure.children).toEqual([
      expect.objectContaining({
        type: 'FRAME', x: 8, y: 8, width: 204, height: 32
      }),
      expect.objectContaining({
        type: 'FRAME', x: 8, y: 72, width: 204, height: 32
      })
    ])
  })

  it('renders a safe control inside structural composite fallback as an Instance', async () => {
    const data = scan()
    const anonymous: ControlToken = {
      ...data.controls[0]!,
      id: id('3'),
      logicalControlId: id('3'),
      instanceId: id('4'),
      sampleText: undefined,
      supportingText: undefined,
      slots: { leading: null, trailing: null },
      appearance: {
        ...data.controls[0]!.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      geometry: {
        ...data.controls[0]!.geometry,
        height: 32,
        minWidth: null,
        borderWidth: 0
      },
      layout: { widthBehavior: 'hug' }
    }
    const publicFirst = data.controls[0]!
    const publicNested = data.controls[1]!
    const nested: CompositeToken = {
      ...data.composites![0]!,
      id: id('8'),
      templateId: id('8'),
      logicalCompositeId: id('8'),
      kind: 'list',
      geometry: {
        ...data.composites![0]!.geometry,
        width: 220,
        height: 80,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0,
        borderWidth: 0
      },
      appearance: {
        ...data.composites![0]!.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      layout: {
        direction: 'vertical', align: 'start', justify: 'start',
        wrap: false, widthBehavior: 'fill', clipsContent: false
      },
      children: [anonymous, publicNested].map(source => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state
      }))
    }
    const outer: CompositeToken = {
      ...data.composites![0]!,
      id: id('9'),
      templateId: id('9'),
      logicalCompositeId: id('9'),
      kind: 'panel',
      geometry: {
        ...data.composites![0]!.geometry,
        width: 244,
        height: 184,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 4
      },
      children: [{
        kind: 'control',
        controlId: publicFirst.id,
        instanceId: publicFirst.instanceId!,
        state: publicFirst.state
      }, {
        kind: 'control',
        controlId: publicFirst.id,
        instanceId: publicFirst.instanceId!,
        state: publicFirst.state
      }, {
        kind: 'composite',
        compositeId: nested.id
      }]
    }
    const current: ScanExport = {
      ...data,
      controls: [anonymous, publicFirst, publicNested],
      composites: [nested, outer]
    }
    const controlPlan = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const compositePlan = createCompositeImportPlan(current, controlPlan, [])
    const appliedControls: AppliedControl[] = controlPlan.groups.flatMap(
      (group, groupIndex) => group.entries.map((entry, entryIndex) => ({
        group,
        entry,
        component: fakeComponent(
          `component:public-${groupIndex}-${entryIndex}`,
          'atomic'
        ) as ControlComponentPort,
        componentSet: null
      }))
    )
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      repository(created)
    )

    expect(created).toHaveLength(1)
    const structure = created[0]?.children[2] as ControlFramePort
    expect(structure.children.map(child => child.type)).toEqual([
      'FRAME', 'INSTANCE'
    ])
    expect((structure.children[1] as CompositeInstancePort).overrides.get('Label'))
      .toBe('Search the web')
  })

  it('stretches fill children in a legacy vertical composite whose parent align is start', async () => {
    const data = scan()
    data.composites![0]!.layout.align = 'start'
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
      geometry: { ...original.geometry, borderWidth: 0 },
      layout: { widthBehavior: 'fill' }
    }
    const current: ScanExport = {
      ...data,
      controls: [anonymous, data.controls[1]!]
    }
    current.composites![0]!.children.push({
      ...current.composites![0]!.children[1]!
    })
    const controlPlan = createControlImportPlan(
      current,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const compositePlan = createCompositeImportPlan(current, controlPlan, [])
    const atomic = fakeComponent('component:public-atomic', 'atomic') as ControlComponentPort
    const controlGroup = controlPlan.groups[0]!
    const appliedControls: AppliedControl[] = [{
      group: controlGroup,
      entry: controlGroup.entries[0]!,
      component: atomic,
      componentSet: null
    }]
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      repository(created)
    )

    expect(created[0]?.counterAxisAlignItems).toBe('MIN')
    expect(created[0]?.children[0]).toMatchObject({
      type: 'FRAME',
      width: 228,
      height: 40
    })
    expect(created[0]?.children[1]).toMatchObject({
      type: 'INSTANCE',
      width: 228
    })
    expect(created[0]?.children[2]).toMatchObject({
      type: 'INSTANCE',
      width: 228
    })
  })

  it('reflows composite variants after their outer geometry changes', () => {
    const first = fakeComponent('component:first', 'composite')
    const second = fakeComponent('component:second', 'composite')
    first.resize(289, 224)
    second.resize(289, 256)
    const set = {
      id: 'set:menu',
      type: 'COMPONENT_SET',
      name: 'Composite/Menu/Vertical/Fill',
      description: '',
      width: 289,
      height: 148864,
      children: [first, second],
      setPluginData() {},
      getPluginData() { return '' },
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      },
      remove: vi.fn()
    } as CompositeComponentSetPort

    reflowCompositeComponentSet(set)

    expect(first).toMatchObject({ x: 0, y: 0 })
    expect(second).toMatchObject({ x: 305, y: 0 })
    expect(set).toMatchObject({ width: 594, height: 256 })
  })

  it('builds the observed outer surface from ordered atomic Instances with safe overrides', async () => {
    const { compositePlan, atomic, appliedControls } = setup()
    const created: CompositeComponentPort[] = []
    const result = await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      repository(created)
    )

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      layoutMode: 'VERTICAL',
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
      itemSpacing: 4,
      cornerRadius: 12,
      strokeWeight: 1,
      clipsContent: true,
      width: 244,
      height: 104
    })
    expect(created[0]?.children.map(child => child.type)).toEqual([
      'INSTANCE', 'INSTANCE'
    ])
    expect(created[0]?.children.map(child =>
      (child as CompositeInstancePort).sourceComponentId)).toEqual([
      atomic.id, atomic.id
    ])
    expect((created[0]?.children[0] as CompositeInstancePort).overrides.get('Label'))
      .toBe('Create an image')
    expect((created[0]?.children[1] as CompositeInstancePort).overrides.get('Label'))
      .toBe('Search the web')
    expect(created[0]?.getPluginData(COMPOSITE_NODE_OWNERSHIP_KEY))
      .toBe(compositePlan.groups[0]?.entries[0]?.ownershipId)
    expect(result.created).toEqual(created)
  })

  it('builds a padded single-control wrapper with the observed side-specific border', async () => {
    const { compositePlan, atomic, appliedControls } = setup()
    const entry = compositePlan.groups[0]!.entries[0]!
    entry.source.geometry = {
      ...entry.source.geometry,
      width: 252,
      height: 72,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
    }
    entry.source.children = [entry.source.children[0]!]
    entry.children = [entry.children[0]!]
    const created: CompositeComponentPort[] = []

    await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      repository(created)
    )

    expect(created).toHaveLength(1)
    expect(created[0]?.children).toHaveLength(1)
    expect(created[0]?.children[0]).toMatchObject({
      type: 'INSTANCE',
      sourceComponentId: atomic.id
    })
    expect(created[0]).toMatchObject({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      strokeTopWeight: 1,
      strokeRightWeight: 0,
      strokeBottomWeight: 0,
      strokeLeftWeight: 0
    })
  })

  it('removes only newly created composite nodes when child instance creation fails', async () => {
    const { compositePlan, atomic, appliedControls } = setup()
    const created: CompositeComponentPort[] = []
    const port = repository(created)
    const originalCreateInstance = port.createInstance
    let calls = 0
    port.createInstance = component => {
      calls += 1
      if (calls === 2) throw new Error('instance failed')
      return originalCreateInstance(component)
    }

    await expect(applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      port
    )).rejects.toThrow('instance failed')

    expect(created[0]?.remove).toHaveBeenCalledOnce()
    expect(atomic.remove).not.toHaveBeenCalled()
  })

  it('removes unattached direct and recursive nodes when text overrides fail', async () => {
    const direct = setup()
    const directPort = repository([])
    const directInstances: CompositeInstancePort[] = []
    const directCreateInstance = directPort.createInstance
    directPort.createInstance = component => {
      const instance = directCreateInstance(component)
      directInstances.push(instance)
      return instance
    }
    directPort.overrideText = async () => {
      throw new Error('direct override failed')
    }

    await expect(applyCompositeImportPlan(
      direct.compositePlan,
      direct.appliedControls,
      directPort
    )).rejects.toThrow('direct override failed')
    expect(directInstances[0]?.remove).toHaveBeenCalledOnce()

    const recursive = setup()
    const recursiveEntry = recursive.compositePlan.groups[0]!.entries[0]!
    const nestedControl = recursiveEntry.children[0]!
    if (nestedControl.kind !== 'control') throw new Error('expected control child')
    recursiveEntry.children = [{
      kind: 'structure',
      source: recursiveEntry.source,
      compositeId: recursiveEntry.source.id,
      state: recursiveEntry.source.state,
      children: [nestedControl]
    }]
    const recursivePort = repository([])
    const recursiveFrames: ControlFramePort[] = []
    const recursiveInstances: CompositeInstancePort[] = []
    const recursiveCreateFrame = recursivePort.createFrame!
    recursivePort.createFrame = () => {
      const frame = recursiveCreateFrame()
      frame.remove = vi.fn()
      recursiveFrames.push(frame)
      return frame
    }
    const recursiveCreateInstance = recursivePort.createInstance
    recursivePort.createInstance = component => {
      const instance = recursiveCreateInstance(component)
      recursiveInstances.push(instance)
      return instance
    }
    recursivePort.overrideText = async () => {
      throw new Error('recursive override failed')
    }

    await expect(applyCompositeImportPlan(
      recursive.compositePlan,
      recursive.appliedControls,
      recursivePort
    )).rejects.toThrow('recursive override failed')
    expect(recursiveInstances[0]?.remove).toHaveBeenCalledOnce()
    expect(recursiveFrames[0]?.remove).toHaveBeenCalledOnce()
  })

  it('removes structural Frames when parent attachment fails', async () => {
    const topLevel = setup()
    const topLevelEntry = topLevel.compositePlan.groups[0]!.entries[0]!
    topLevelEntry.children = [{
      kind: 'structure',
      source: topLevelEntry.source,
      compositeId: topLevelEntry.source.id,
      state: topLevelEntry.source.state,
      children: []
    }]
    const topLevelPort = repository([])
    const topLevelFrames: ControlFramePort[] = []
    const originalTopLevelFrame = topLevelPort.createFrame!
    topLevelPort.createFrame = () => {
      const frame = originalTopLevelFrame()
      frame.remove = vi.fn()
      topLevelFrames.push(frame)
      return frame
    }
    const originalCreateComponent = topLevelPort.createComponent
    topLevelPort.createComponent = () => {
      const component = originalCreateComponent()
      component.appendChild = () => {
        throw new Error('top-level structural attach failed')
      }
      return component
    }

    await expect(applyCompositeImportPlan(
      topLevel.compositePlan,
      topLevel.appliedControls,
      topLevelPort
    )).rejects.toThrow('top-level structural attach failed')
    expect(topLevelFrames[0]?.remove).toHaveBeenCalledOnce()

    const recursive = setup()
    const recursiveEntry = recursive.compositePlan.groups[0]!.entries[0]!
    const controlChild = recursiveEntry.children[0]!
    if (controlChild.kind !== 'control') throw new Error('expected control child')
    recursiveEntry.children = [{
      kind: 'structure',
      source: recursiveEntry.source,
      compositeId: recursiveEntry.source.id,
      state: recursiveEntry.source.state,
      children: [{
        kind: 'structure',
        source: controlChild.source,
        controlId: controlChild.controlId,
        instanceId: controlChild.instanceId,
        state: controlChild.state,
        children: []
      }]
    }]
    const recursivePort = repository([])
    const recursiveFrames: ControlFramePort[] = []
    const originalRecursiveFrame = recursivePort.createFrame!
    recursivePort.createFrame = () => {
      const frame = originalRecursiveFrame()
      frame.remove = vi.fn()
      if (recursiveFrames.length === 0) {
        frame.appendChild = child => {
          if (child.type === 'FRAME') {
            throw new Error('recursive structural attach failed')
          }
          frame.children.push(child)
        }
      }
      recursiveFrames.push(frame)
      return frame
    }

    await expect(applyCompositeImportPlan(
      recursive.compositePlan,
      recursive.appliedControls,
      recursivePort
    )).rejects.toThrow('recursive structural attach failed')
    expect(recursiveFrames[0]?.remove).toHaveBeenCalledOnce()
    expect(recursiveFrames[1]?.remove).toHaveBeenCalledOnce()
  })

  it('materializes confirmed UI icon slots inside anonymous structural control rows', async () => {
    const { compositePlan, appliedControls } = setup()
    const entry = compositePlan.groups[0]!.entries[0]!
    const source: ControlToken = {
      ...control('3', ''),
      sampleText: undefined,
      supportingText: undefined,
      slots: {
        leading: {
          width: 16,
          height: 16,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v12H2Z"/></svg>'
        },
        trailing: null
      },
      content: { kind: 'icon-leading' },
      geometry: {
        ...control('3', '').geometry,
        height: 32,
        minWidth: 288,
        padding: { top: 6, right: 8, bottom: 6, left: 8 },
        gap: 8
      },
      layout: { widthBehavior: 'fill', contentAlignment: 'start' }
    }
    entry.children = [{
      kind: 'structure',
      source,
      controlId: source.id,
      instanceId: source.instanceId,
      state: source.state,
      placement: { x: 8, y: 8, width: 288, height: 32 }
    }]

    const created: CompositeComponentPort[] = []
    const port = repository(created)
    Object.assign(port, {
      createIconInstance: vi.fn(() => ({
        type: 'INSTANCE' as const,
        name: '',
        width: 1,
        height: 1,
        resize(width: number, height: number) {
          this.width = width
          this.height = height
        },
        remove: vi.fn()
      }))
    })

    await applyCompositeImportPlan(compositePlan, appliedControls, port)

    const row = created[0]?.children[0] as ControlFramePort | undefined
    expect(row).toMatchObject({
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'CENTER',
      paddingTop: 6,
      paddingRight: 8,
      paddingBottom: 6,
      paddingLeft: 8
    })
    expect(row?.children).toEqual([
      expect.objectContaining({
        type: 'INSTANCE',
        name: 'Leading UI icon instance',
        width: 16,
        height: 16
      })
    ])
  })

  it('captures placement before moving existing composite children', async () => {
    const { compositePlan, appliedControls } = setup()
    const existing = fakeComponent('component:existing-order', 'composite')
    const group = compositePlan.groups[0]!
    const entry = group.entries[0]!
    group.action = 'update'
    entry.action = 'update'
    entry.existingComponentId = existing.id
    const order: string[] = []
    const port = repository([])
    Object.assign(port, {
      clearChildren(component: CompositeComponentPort) {
        component.children.splice(0)
      },
      backupPlacement(component: CompositeComponentPort) {
        order.push('placement')
        return { x: component.x, y: component.y }
      },
      restorePlacement(component: CompositeComponentPort, backup: unknown) {
        const placement = backup as { x: number; y: number }
        component.x = placement.x
        component.y = placement.y
      },
      backupChildren(component: CompositeComponentPort) {
        order.push('children')
        return component.children.splice(0)
      },
      restoreChildren(
        component: CompositeComponentPort,
        backup: Array<CompositeComponentPort | ControlFramePort>
      ) {
        component.children.splice(0)
        for (const child of backup) component.appendChild(child)
      },
      discardChildrenBackup() {}
    })
    port.getNodeById = async () => existing

    await applyCompositeImportPlan(compositePlan, appliedControls, port)

    expect(order).toEqual(['placement', 'children'])
  })

  it('does not report a committed Composite import as failed when backup disposal fails', async () => {
    const { compositePlan, appliedControls } = setup()
    const existing = fakeComponent('component:existing-disposal', 'composite')
    const group = compositePlan.groups[0]!
    const entry = group.entries[0]!
    group.action = 'update'
    entry.action = 'update'
    entry.existingComponentId = existing.id
    const port = repository([])
    Object.assign(port, {
      clearChildren(component: CompositeComponentPort) {
        component.children.splice(0)
      },
      backupPlacement(component: CompositeComponentPort) {
        return { x: component.x, y: component.y }
      },
      restorePlacement(component: CompositeComponentPort, backup: unknown) {
        const placement = backup as { x: number; y: number }
        component.x = placement.x
        component.y = placement.y
      },
      backupChildren(component: CompositeComponentPort) {
        return component.children.splice(0)
      },
      restoreChildren(
        component: CompositeComponentPort,
        backup: Array<CompositeComponentPort | ControlFramePort>
      ) {
        component.children.splice(0)
        for (const child of backup) component.appendChild(child)
      },
      discardChildrenBackup: vi.fn(() => {
        throw new Error('composite backup remove failed')
      })
    })
    port.getNodeById = async () => existing

    const result = await applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      port
    )

    expect(result.updated).toEqual([existing])
    expect(port.discardChildrenBackup).toHaveBeenCalledOnce()
  })

  it('retains the only composite child backup when rollback restoration fails', async () => {
    const { compositePlan, appliedControls } = setup()
    const existing = fakeComponent('component:failed-composite-restore', 'composite')
    Object.defineProperty(existing, 'fills', {
      get: () => [],
      set: () => { throw new Error('composite configuration failed') }
    })
    const group = compositePlan.groups[0]!
    const entry = group.entries[0]!
    group.action = 'update'
    entry.action = 'update'
    entry.existingComponentId = existing.id
    const backup = { kind: 'only-composite-backup' }
    const port = repository([])
    port.getNodeById = async () => existing
    port.backupChildren = () => backup
    port.restoreChildren = vi.fn(() => {
      throw new Error('composite restoration failed')
    })
    port.discardChildrenBackup = vi.fn()

    await expect(applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      port
    )).rejects.toThrow('composite configuration failed')

    expect(port.restoreChildren).toHaveBeenCalledWith(existing, backup)
    expect(port.discardChildrenBackup).not.toHaveBeenCalledWith(backup)
  })

  it('restores the previous child tree when an existing composite update fails', async () => {
    const { compositePlan, appliedControls } = setup()
    const existing = fakeComponent('component:existing-composite', 'composite')
    const previousChild = {
      ...repository([]).createFrame!(),
      name: 'Previous child'
    } as ControlFramePort
    existing.appendChild(previousChild)
    existing.resize(320, 180)
    existing.setPluginData(COMPOSITE_NODE_OWNERSHIP_KEY, 'previous-ownership')

    const group = compositePlan.groups[0]!
    const entry = group.entries[0]!
    group.action = 'update'
    entry.action = 'update'
    entry.existingComponentId = existing.id

    const port = repository([])
    let instanceCalls = 0
    const originalCreateInstance = port.createInstance
    port.createInstance = component => {
      instanceCalls += 1
      if (instanceCalls === 2) throw new Error('update instance failed')
      return originalCreateInstance(component)
    }
    port.clearChildren = component => {
      for (const child of component.children.splice(0)) child.remove?.()
    }
    Object.assign(port, {
      backupChildren(component: CompositeComponentPort) {
        const backup = component.children.splice(0)
        component.resize(1, 1)
        return backup
      },
      restoreChildren(
        component: CompositeComponentPort,
        backup: Array<CompositeComponentPort | ControlFramePort>
      ) {
        port.clearChildren!(component)
        for (const child of backup) component.appendChild(child)
      },
      discardChildrenBackup() {}
    })
    port.getNodeById = async nodeId => nodeId === existing.id ? existing : null

    await expect(applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      port
    )).rejects.toThrow('update instance failed')

    expect(existing.children).toHaveLength(1)
    expect(existing.children[0]).toMatchObject({
      type: 'FRAME',
      name: 'Previous child'
    })
    expect(existing).toMatchObject({ width: 320, height: 180 })
    expect(existing.getPluginData(COMPOSITE_NODE_OWNERSHIP_KEY))
      .toBe('previous-ownership')
  })

  it('restores an existing Component Set when a later composite group fails', async () => {
    const { compositePlan, appliedControls } = setup()
    const existing = fakeComponent('component:existing-composite', 'composite')
    existing.x = 17
    existing.y = 9
    const setData = new Map<string, string>([[
      COMPOSITE_GROUP_OWNERSHIP_KEY,
      'previous-set-ownership'
    ]])
    const existingSet = {
      id: 'component-set:existing-composite',
      type: 'COMPONENT_SET',
      name: 'Previous set name',
      description: 'Previous set description',
      width: 333,
      height: 222,
      children: [existing],
      setPluginData(key: string, value: string) { setData.set(key, value) },
      getPluginData(key: string) { return setData.get(key) ?? '' },
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      },
      remove: vi.fn()
    } as CompositeComponentSetPort

    const firstGroup = compositePlan.groups[0]!
    firstGroup.kind = 'component_set'
    firstGroup.action = 'update'
    firstGroup.existingGroupNodeId = existingSet.id
    firstGroup.entries[0]!.action = 'update'
    firstGroup.entries[0]!.existingComponentId = existing.id

    const failingGroup = structuredClone(firstGroup)
    failingGroup.kind = 'component'
    failingGroup.action = 'create'
    failingGroup.groupId = id('8')
    failingGroup.groupOwnershipId = `${origin}|failing-group`
    failingGroup.existingGroupNodeId = null
    failingGroup.entries[0]!.action = 'create'
    failingGroup.entries[0]!.ownershipId = `${origin}|failing-entry`
    failingGroup.entries[0]!.existingComponentId = null
    const failingChild = failingGroup.entries[0]!.children[0]!
    if (failingChild.kind !== 'control') throw new Error('expected control child')
    failingChild.controlOwnershipId = `${origin}|missing-control`
    compositePlan.groups.push(failingGroup)

    const port = repository([])
    port.clearChildren = component => {
      for (const child of component.children.splice(0)) child.remove?.()
    }
    Object.assign(port, {
      backupChildren(component: CompositeComponentPort) {
        return component.children.splice(0)
      },
      restoreChildren(
        component: CompositeComponentPort,
        backup: Array<CompositeComponentPort | ControlFramePort>
      ) {
        port.clearChildren!(component)
        for (const child of backup) component.appendChild(child)
      },
      discardChildrenBackup() {},
      appendToComponentSet(
        set: CompositeComponentSetPort,
        component: CompositeComponentPort
      ) {
        const existingIndex = set.children.indexOf(component)
        if (existingIndex >= 0) set.children.splice(existingIndex, 1)
        set.children.push(component)
      }
    })
    port.getNodeById = async nodeId => {
      if (nodeId === existing.id) return existing
      if (nodeId === existingSet.id) return existingSet
      return null
    }

    await expect(applyCompositeImportPlan(
      compositePlan,
      appliedControls,
      port
    )).rejects.toThrow('Composite atomic dependency is missing')

    expect(existingSet.remove).not.toHaveBeenCalled()
    expect(existingSet).toMatchObject({
      name: 'Previous set name',
      description: 'Previous set description',
      width: 333,
      height: 222,
      children: [existing]
    })
    expect(existing).toMatchObject({ x: 17, y: 9 })
    expect(existingSet.getPluginData(COMPOSITE_GROUP_OWNERSHIP_KEY))
      .toBe('previous-set-ownership')
  })
})
