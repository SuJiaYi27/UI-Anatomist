import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppliedControl, ControlComponentPort } from '../../src/figma/control-component-applier'
import type { ControlImportPlanEntry, ControlImportPlanGroup } from '../../src/figma/control-import-plan'
import type { ControlToken } from '../../src/shared/schema'
import { buildControlBoard } from '../../src/figma/control-board-builder'
import {
  CONTROL_BOARD_SPEC,
  atomicSpecimenWidth
} from '../../src/figma/control-board-spec'

type FakeNode = {
  id: string
  type: string
  name: string
  children: FakeNode[]
  width: number
  height: number
  x: number
  y: number
  mainComponent?: FakeNode
  pluginData: Map<string, string>
  appendChild(child: FakeNode): void
  remove(): void
  resize(width: number, height: number): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  [key: string]: unknown
}

let nextId = 0
function node(type: string): FakeNode {
  return {
    id: `${type.toLowerCase()}:${nextId++}`,
    type,
    name: '',
    children: [],
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    pluginData: new Map(),
    appendChild(child) { this.children.push(child) },
    remove() {},
    resize(width, height) { this.width = width; this.height = height },
    setPluginData(key, value) { this.pluginData.set(key, value) },
    getPluginData(key) { return this.pluginData.get(key) ?? '' }
  }
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap(child => [child, ...descendants(child)])
}

function token(state: ControlToken['state'], id: string): ControlToken {
  return {
    id: `sha256:${id.repeat(64)}`,
    groupId: `sha256:${'9'.repeat(64)}`,
    name: `button-primary-md-${state}`,
    family: 'button', state, intent: 'primary', size: 'md',
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
    occurrences: 1, stateOccurrences: 1
  }
}

function applied(
  state: ControlToken['state'],
  id: string,
  presentationGroup = id
): AppliedControl {
  const source = token(state, id)
  source.groupId = `sha256:${presentationGroup.repeat(64)}`
  const componentNode = node('COMPONENT')
  componentNode.name = `State=${state}`
  componentNode.resize(120, 40)
  componentNode.createInstance = () => {
    const instance = node('INSTANCE')
    instance.mainComponent = componentNode
    instance.resize(componentNode.width, componentNode.height)
    return instance
  }
  const entry: ControlImportPlanEntry = {
    action: 'create',
    source,
    targetName: `State=${state}`,
    ownershipId: `https://example.com|${source.id}`,
    existingComponentId: null,
    fontName: { family: 'Inter', style: 'Regular' }
  }
  const group: ControlImportPlanGroup = {
    action: 'create',
    kind: 'component_set',
    groupId: `presentation:${presentationGroup}`,
    targetName: 'Control/Button/Primary/Md',
    groupOwnershipId: `https://example.com|${source.groupId}`,
    existingGroupNodeId: null,
    conflictName: null,
    entries: [entry]
  }
  return {
    group,
    entry,
    component: componentNode as unknown as ControlComponentPort,
    componentSet: null
  }
}

function stubPreviewFigma(): FakeNode {
  const page = node('PAGE')
  page.findOne = vi.fn(() => null)
  page.selection = []
  vi.stubGlobal('figma', {
    currentPage: page,
    createFrame: vi.fn(() => node('FRAME')),
    createRectangle: vi.fn(() => node('RECTANGLE')),
    createText: vi.fn(() => {
      const text = node('TEXT')
      let characters = ''
      Object.defineProperty(text, 'characters', {
        get() { return characters },
        set(value: string) {
          characters = value
          text.width = value.length * 6
          text.height = 14
        }
      })
      return text
    }),
    loadFontAsync: vi.fn().mockResolvedValue(undefined),
    viewport: { scrollAndZoomIntoView: vi.fn() }
  })
  return page
}

function previewInstance(board: FrameNode): FakeNode {
  const instances = descendants(board as unknown as FakeNode)
    .filter(child => child.type === 'INSTANCE')
  expect(instances).toHaveLength(1)
  return instances[0]!
}

function makeModernStateFamily(
  defaultValue: AppliedControl,
  hoverValue: AppliedControl
): void {
  const templateId = `sha256:${'a'.repeat(64)}`
  const logicalControlId = `sha256:${'b'.repeat(64)}`
  const instanceId = `sha256:${'c'.repeat(64)}`
  for (const value of [defaultValue, hoverValue]) {
    value.entry.source.templateId = templateId
    value.entry.source.logicalControlId = logicalControlId
    value.entry.source.instanceId = instanceId
    value.entry.source.sampleText = { value: 'Choice', source: 'visible-text' }
    value.group.templateId = templateId
    value.group.stateEvidenceId = logicalControlId
  }
  const instances = [defaultValue.entry.source, hoverValue.entry.source]
  defaultValue.group.instances = instances
  hoverValue.group.instances = instances
}

afterEach(() => {
  vi.unstubAllGlobals()
  nextId = 0
})

describe('buildControlBoard', () => {
  it('uses the exact recursively placed composite occurrence for an atomic preview only', async () => {
    stubPreviewFigma()
    const value = applied('default', '1', '8')
    const source = value.entry.source
    source.templateId = `sha256:${'a'.repeat(64)}`
    source.logicalControlId = `sha256:${'b'.repeat(64)}`
    source.instanceId = `sha256:${'c'.repeat(64)}`
    source.sampleText = { value: 'Row label', source: 'visible-text' }
    value.group.instances = [source]
    const structuralSource = {
      id: `sha256:${'d'.repeat(64)}`,
      state: 'default',
      geometry: {},
      appearance: {},
      layout: {},
      children: []
    }
    const compositeComponent = applied('default', '9', '7').component
    const appliedComposite = {
      group: { groupId: 'composite:placement' },
      entry: {
        source: {
          ...structuralSource,
          kind: 'list',
          name: 'list-vertical',
          layout: { direction: 'vertical', widthBehavior: 'fill' },
          geometry: {
            width: 282,
            height: 72,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            gap: 0,
            radius: 0,
            borderWidth: 0
          },
          appearance: { background: { r: 1, g: 1, b: 1, a: 1 } }
        },
        children: [{
          kind: 'structure',
          source: structuralSource,
          state: 'default',
          children: [{
            kind: 'control',
            controlId: source.id,
            instanceId: source.instanceId,
            state: source.state,
            source,
            placement: { x: 0, y: 0, width: 282, height: 72 }
          }, {
            kind: 'control',
            controlId: source.id,
            instanceId: `sha256:${'e'.repeat(64)}`,
            state: source.state,
            source: {
              ...source,
              instanceId: `sha256:${'e'.repeat(64)}`
            },
            placement: { x: 0, y: 72, width: 240, height: 72 }
          }]
        }]
      },
      component: compositeComponent,
      componentSet: null
    }

    const board = await buildControlBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      1,
      [appliedComposite] as never
    )

    expect(value.component.width).toBe(120)
    const atomicPreview = descendants(board as unknown as FakeNode).find(node =>
      node.type === 'INSTANCE' && node.mainComponent === value.component
    )!
    expect(atomicPreview.width).toBe(282)
  })

  it('uses a CJK-capable annotation font before Inter when it is available', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const board = await buildControlBoard(
      [],
      [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Semi Bold' },
        { family: 'PingFang SC', style: 'Regular' },
        { family: 'PingFang SC', style: 'Semibold' }
      ],
      'https://example.com'
    )

    expect(descendants(board as unknown as FakeNode)
      .filter(item => item.type === 'TEXT')
      .every(item => (item.fontName as { family: string }).family === 'PingFang SC'))
      .toBe(true)
  })

  it('creates one owned board whose samples are instances of applied components', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    const createFrame = vi.fn(() => node('FRAME'))
    const createText = vi.fn(() => {
      const text = node('TEXT')
      let characters = ''
      Object.defineProperty(text, 'characters', {
        get() { return characters },
        set(value: string) {
          characters = value
          text.width = value.length * 6
        }
      })
      return text
    })
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText,
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const hover = applied('hover', '2', '9')
    hover.entry.source.appearance.background = { r: 0.05, g: 0.05, b: 0.05, a: 1 }
    const defaultValue = applied('default', '1', '9')
    defaultValue.entry.source.appearance.background = { r: 0, g: 0, b: 0, a: 0 }
    const controls = [hover, defaultValue]
    const board = await buildControlBoard(
      controls,
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )
    const allNodes = descendants(board as unknown as FakeNode)
    const instances = allNodes.filter(child => child.type === 'INSTANCE')
    const cards = allNodes.filter(child => child.name.startsWith('Specimen /'))
    const previewAreas = allNodes.filter(child => child.name === 'Preview surface')
    const componentBounds = allNodes.filter(
      child => child.name === 'Inspection clearance — specimen only'
    )
    expect(board.name).toBe('UI-Anatomist / Interactive Controls')
    expect(instances).toHaveLength(1)
    expect(cards).toHaveLength(1)
    expect(previewAreas).toHaveLength(1)
    expect(componentBounds).toHaveLength(0)
    expect(previewAreas.every(area =>
      Array.isArray(area.fills) && area.fills.length === 1 &&
      Array.isArray(area.strokes) && area.strokes.length === 0
    )).toBe(true)
    expect(previewAreas.every(area =>
      area.children.filter(child => child.type === 'INSTANCE').length === 1
    )).toBe(true)
    expect(instances.every(instance =>
      controls.some(item => item.component === instance.mainComponent)
    )).toBe(true)
    expect(allNodes.filter(item => item.type === 'TEXT')
      .every(item => !String(item.characters ?? '').includes('sha256'))).toBe(true)
    expect(instances[0]?.mainComponent).toBe(hover.component)
    expect(allNodes.find(item => item.name === 'Family')?.characters).toBe('Button (1)')
    expect(allNodes.find(item => item.name === 'Summary')?.characters)
      .toContain('真实状态与矢量已保留')
    expect(allNodes.find(item => item.name === 'Asset name')?.characters)
      .toBe('Button · 主要 · 深色实底')
    expect(allNodes.filter(item => item.name === 'Component').map(item => item.characters))
      .toEqual(['中 · 浅色字 · 仅文字'])
    expect(allNodes.filter(item => item.name === 'State and size').map(item => item.characters))
      .toEqual(['悬浮 · 40px'])
    expect(page.selection).toEqual([board])
  })

  it('keeps Default as the preview when Default already has a visible surface', async () => {
    stubPreviewFigma()
    const defaultValue = applied('default', '1', '8')
    defaultValue.entry.source.appearance.background = {
      r: 0.8, g: 0.8, b: 0.8, a: 0.2
    }
    const hoverValue = applied('hover', '2', '8')
    hoverValue.entry.source.appearance.background = {
      r: 0.05, g: 0.05, b: 0.05, a: 1
    }

    const board = await buildControlBoard(
      [hoverValue, defaultValue],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    expect(previewInstance(board).mainComponent).toBe(defaultValue.component)
  })

  it('uses a real low-alpha Hover surface when Default has no visible surface', async () => {
    stubPreviewFigma()
    const defaultValue = applied('default', '1', '7')
    defaultValue.entry.source.appearance.background = {
      r: 0, g: 0, b: 0, a: 0
    }
    const hoverValue = applied('hover', '2', '7')
    hoverValue.entry.source.appearance.background = {
      r: 0, g: 0, b: 0, a: 0.0419
    }
    hoverValue.entry.source.geometry.radius = 12
    makeModernStateFamily(defaultValue, hoverValue)

    const board = await buildControlBoard(
      [defaultValue, hoverValue],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    expect(previewInstance(board).mainComponent).toBe(hoverValue.component)
  })

  it('shows one catalog card for reusable state families without merging ownership', async () => {
    stubPreviewFigma()
    const firstDefault = applied('default', '1', '7')
    const firstHover = applied('hover', '2', '7')
    makeModernStateFamily(firstDefault, firstHover)
    for (const value of [firstDefault, firstHover]) {
      value.entry.source.sampleText = { value: 'First command', source: 'visible-text' }
    }
    firstDefault.group.instances = [firstDefault.entry.source, firstHover.entry.source]
    firstHover.group.instances = firstDefault.group.instances

    const secondDefault = applied('default', '3', '8')
    const secondHover = applied('hover', '4', '8')
    makeModernStateFamily(secondDefault, secondHover)
    const secondLogicalId = `sha256:${'d'.repeat(64)}`
    const secondInstanceId = `sha256:${'e'.repeat(64)}`
    for (const value of [secondDefault, secondHover]) {
      value.entry.source.logicalControlId = secondLogicalId
      value.entry.source.instanceId = secondInstanceId
      value.entry.source.sampleText = { value: 'Second command', source: 'visible-text' }
      value.group.stateEvidenceId = secondLogicalId
    }
    secondDefault.group.instances = [secondDefault.entry.source, secondHover.entry.source]
    secondHover.group.instances = secondDefault.group.instances

    const board = await buildControlBoard(
      [firstDefault, firstHover, secondDefault, secondHover],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const allNodes = descendants(board)

    expect(allNodes.filter(child => child.name.startsWith('Specimen /'))).toHaveLength(1)
    expect(allNodes.filter(child => child.type === 'INSTANCE')).toHaveLength(1)
    expect(new Set([
      firstDefault.entry.ownershipId,
      secondDefault.entry.ownershipId
    ]).size).toBe(2)
  })

  it('keeps a one-sided bordered Default instead of promoting a filled Hover', async () => {
    stubPreviewFigma()
    const defaultValue = applied('default', '1', '5')
    defaultValue.entry.source.appearance.background = {
      r: 0, g: 0, b: 0, a: 0
    }
    defaultValue.entry.source.appearance.border = {
      r: 0.2, g: 0.2, b: 0.2, a: 1
    }
    defaultValue.entry.source.geometry = {
      ...defaultValue.entry.source.geometry,
      borderWidth: 0,
      borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
    }
    const hoverValue = applied('hover', '2', '5')
    hoverValue.entry.source.appearance.background = {
      r: 0.9, g: 0.9, b: 0.9, a: 1
    }

    const board = await buildControlBoard(
      [hoverValue, defaultValue],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    expect(previewInstance(board).mainComponent).toBe(defaultValue.component)
  })

  it('keeps Default and invents no card fill when neither state has a surface', async () => {
    stubPreviewFigma()
    const defaultValue = applied('default', '1', '6')
    defaultValue.entry.source.appearance.background = {
      r: 0, g: 0, b: 0, a: 0
    }
    defaultValue.entry.source.appearance.foreground = {
      r: 0.05, g: 0.05, b: 0.05, a: 1
    }
    const hoverValue = applied('hover', '2', '6')
    hoverValue.entry.source.appearance.background = {
      r: 0, g: 0, b: 0, a: 0
    }
    hoverValue.entry.source.appearance.foreground = {
      r: 0.2, g: 0.2, b: 0.8, a: 1
    }

    const board = await buildControlBoard(
      [hoverValue, defaultValue],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )
    const preview = descendants(board as unknown as FakeNode)
      .find(child => child.name === 'Preview surface')!

    expect(previewInstance(board).mainComponent).toBe(defaultValue.component)
    expect(preview.fills).toEqual([])
  })

  it('puts composite components first, groups safe content instances, and hides anonymous atomic internals from the catalog', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => {
        const text = node('TEXT')
        let characters = ''
        Object.defineProperty(text, 'characters', {
          get() { return characters },
          set(value: string) {
            characters = value
            text.width = value.length * 6
            text.height = 14
          }
        })
        return text
      }),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const content = applied('default', '1', '1')
    content.entry.source.templateId = `sha256:${'a'.repeat(64)}`
    content.entry.source.logicalControlId = `sha256:${'b'.repeat(64)}`
    content.entry.source.instanceId = `sha256:${'c'.repeat(64)}`
    content.group.templateId = content.entry.source.templateId
    content.group.instances = [
      {
        ...content.entry.source,
        id: `sha256:${'d'.repeat(64)}`,
        instanceId: `sha256:${'e'.repeat(64)}`,
        sampleText: { value: 'Search the web', source: 'visible-text' }
      },
      {
        ...content.entry.source,
        id: `sha256:${'f'.repeat(64)}`,
        instanceId: `sha256:${'0'.repeat(64)}`,
        sampleText: { value: 'Create an image', source: 'visible-text' }
      }
    ]

    const anonymous = applied('default', '2', '2')
    anonymous.entry.source.templateId = `sha256:${'3'.repeat(64)}`
    anonymous.entry.source.logicalControlId = `sha256:${'4'.repeat(64)}`
    anonymous.entry.source.instanceId = `sha256:${'5'.repeat(64)}`
    anonymous.group.templateId = anonymous.entry.source.templateId
    anonymous.group.instances = [anonymous.entry.source]

    const compositeComponent = node('COMPONENT')
    compositeComponent.resize(280, 116)
    compositeComponent.createInstance = () => {
      const instance = node('INSTANCE')
      instance.mainComponent = compositeComponent
      instance.resize(280, 116)
      return instance
    }
    const composite = {
      group: {
        groupId: `sha256:${'6'.repeat(64)}`,
        targetName: 'Composite/Menu/Vertical/Fill',
        entries: []
      },
      entry: {
        source: {
          id: `sha256:${'7'.repeat(64)}`,
          kind: 'menu',
          state: 'default',
          geometry: {
            width: 280,
            height: 116,
            padding: { top: 8, right: 8, bottom: 8, left: 8 },
            gap: 4,
            radius: 12,
            borderWidth: 1
          },
          appearance: {
            background: { r: 1, g: 1, b: 1, a: 1 },
            border: { r: 0.85, g: 0.85, b: 0.85, a: 1 },
            shadows: []
          },
          layout: {
            direction: 'vertical',
            widthBehavior: 'fill',
            align: 'stretch',
            justify: 'start'
          },
          children: [{ kind: 'control' }, { kind: 'control' }],
          occurrences: 1,
          stateOccurrences: 1
        },
        children: [{
          kind: 'control',
          source: {
            ...content.entry.source,
            sampleText: { value: 'Find a branch…', source: 'placeholder' }
          }
        }]
      },
      component: compositeComponent,
      componentSet: null
    }
    const hoverCompositeComponent = node('COMPONENT')
    hoverCompositeComponent.resize(280, 116)
    hoverCompositeComponent.createInstance = () => {
      const instance = node('INSTANCE')
      instance.mainComponent = hoverCompositeComponent
      instance.resize(280, 116)
      return instance
    }
    const hoverComposite = {
      ...composite,
      entry: {
        ...composite.entry,
        source: {
          ...composite.entry.source,
          id: `sha256:${'8'.repeat(64)}`,
          state: 'hover'
        }
      },
      component: hoverCompositeComponent
    }

    const board = await buildControlBoard(
      [content, anonymous],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      4,
      [composite, hoverComposite] as never
    ) as unknown as FakeNode
    const allNodes = descendants(board)
    const sections = allNodes
      .filter(item => item.name === 'Composite components (1)' || item.name === 'Button (1)')
      .sort((left, right) => left.y - right.y)
    const cards = allNodes.filter(item => item.name.startsWith('Specimen /'))
    const visibleText = allNodes
      .filter(item => item.type === 'TEXT')
      .map(item => String(item.characters ?? ''))

    expect(sections.map(item => item.name)).toEqual([
      'Composite components (1)',
      'Button (1)'
    ])
    expect(cards).toHaveLength(2)
    expect(cards.find(item => item.name.includes('复合组件'))?.width).toBe(640)
    expect(cards.find(item => item.name.includes('Button'))?.width).toBe(216)
    expect(cards.find(item => item.name.includes('Button'))
      ?.children.flatMap(descendants).filter(item => item.type === 'INSTANCE'))
      .toHaveLength(1)
    expect(visibleText.some(value =>
      value.includes('Control/') || value.includes('Composite/')
    )).toBe(false)
    expect(visibleText.some(value => value.includes('复合组件'))).toBe(true)
    expect(visibleText).toContain('复合组件 · 菜单 · Find a branch…')
    expect(visibleText.some(value => value.includes('安全区 8px'))).toBe(true)
    expect(allNodes.filter(item => item.name === 'Preview state').map(item => item.characters))
      .toEqual(['默认', '悬浮'])
  })

  it('creates a readable empty state without detached visual samples', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })
    const board = await buildControlBoard(
      [],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )
    const allNodes = (board as unknown as FakeNode).children
    expect(allNodes.some(child => child.name === 'Empty state')).toBe(true)
    expect(allNodes.some(child => child.type === 'RECTANGLE')).toBe(false)
  })

  it('uses a dark specimen surface for transparent controls with light foregrounds', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })
    const value = applied('default', '1')
    value.entry.source.appearance.background = { r: 0, g: 0, b: 0, a: 0 }
    value.entry.source.appearance.foreground = { r: 1, g: 1, b: 1, a: 1 }

    const board = await buildControlBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const preview = descendants(board)
      .find(child => child.name === 'Preview surface')!
    const fill = (preview.fills as Array<{ color: { r: number; g: number; b: number } }>)[0]

    expect(fill.color.r).toBeLessThan(0.2)
    expect(fill.color.g).toBeLessThan(0.2)
    expect(fill.color.b).toBeLessThan(0.2)
  })

  it('does not invent a gray specimen fill around a light-theme control', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })
    const value = applied('default', '1')
    value.entry.source.appearance.background = { r: 0, g: 0, b: 0, a: 0 }
    value.entry.source.appearance.foreground = { r: 0.05, g: 0.05, b: 0.05, a: 1 }

    const board = await buildControlBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const preview = descendants(board).find(child => child.name === 'Preview surface')!

    expect(preview.fills).toEqual([])
  })

  it('adds a neutral board-only hint for an empty input without changing the source', async () => {
    stubPreviewFigma()
    const value = applied('default', '1')
    value.entry.source.family = 'input'
    value.entry.source.content = { kind: 'compound-input' }
    value.entry.source.sampleText = undefined
    value.entry.source.templateId = `sha256:${'a'.repeat(64)}`
    value.entry.source.logicalControlId = `sha256:${'b'.repeat(64)}`
    value.entry.source.instanceId = `sha256:${'c'.repeat(64)}`
    value.group.templateId = value.entry.source.templateId
    value.group.stateEvidenceId = value.entry.source.logicalControlId
    value.group.instances = [value.entry.source]
    value.entry.source.geometry = {
      ...value.entry.source.geometry,
      height: 32,
      minWidth: 280,
      padding: { top: 6, right: 12, bottom: 6, left: 12 }
    }
    value.component.resize(280, 32)

    const board = await buildControlBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const nodes = descendants(board)
    const hint = nodes.find(child => child.name === 'Preview-only input hint')
    const detail = nodes.find(child => child.name === 'State and size')

    expect(value.entry.source.sampleText).toBeUndefined()
    expect(hint?.characters).toBe('输入区域')
    expect(detail?.characters).toContain('检视占位，非源网页文案')
  })

  it('explains missing-font and transparent-foreground structural specimens', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })
    const missingFont = applied('default', '1')
    missingFont.entry.fontName = null
    missingFont.entry.source.typography.fontFamilyStack = ['Interface Mono']
    const transparent = applied('hover', '2')
    transparent.entry.source.appearance.foreground = { r: 0, g: 0, b: 0, a: 0 }

    const board = await buildControlBoard(
      [missingFont, transparent],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const details = descendants(board)
      .filter(child => child.name === 'State and size')
      .map(child => String(child.characters))
    const previewAnnotations = descendants(board)
      .filter(child => child.name === 'Missing font annotation')
      .map(child => String(child.characters))
    const annotationNode = descendants(board)
      .find(child => child.name === 'Missing font annotation')!
    const missingFontInstance = descendants(board)
      .find(child => child.type === 'INSTANCE' && child.mainComponent === missingFont.component)!

    expect(details).toContain('默认 · 40px · 缺少字体：Interface Mono')
    expect(details).toContain('悬浮 · 40px · 前景透明，仅保留结构')
    expect(previewAnnotations).toEqual(['缺少字体：Interface Mono'])
    expect(annotationNode.y + annotationNode.height + 8)
      .toBeLessThanOrEqual(missingFontInstance.y)
  })

  it('widens the board and every section for an oversized specimen', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })
    const value = applied('default', '1')
    value.component.resize(1900, 64)

    const board = await buildControlBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const allNodes = descendants(board)
    const section = allNodes.find(child => child.name === 'Button (1)')!
    const separator = allNodes.find(child => child.name === 'Separator')!
    const card = allNodes.find(child => child.name.startsWith('Specimen /'))!

    expect(board.width).toBeGreaterThan(1513)
    expect(section.width).toBe(board.width)
    expect(separator.width).toBe(board.width - 80)
    expect(card.x + card.width).toBeLessThanOrEqual(board.width - 40)
  })

  it('constrains specimen captions to the card width and enables wrapping', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => {
        const text = node('TEXT')
        text.width = 1000
        text.height = 14
        return text
      }),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const board = await buildControlBoard(
      [applied('default', '1')],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const allNodes = descendants(board)
    const card = allNodes.find(child => child.name.startsWith('Specimen /'))!
    const caption = allNodes.find(child => child.name === 'Component')!

    expect(caption.textAutoResize).toBe('HEIGHT')
    expect(caption.width).toBe(card.width - 32)
    expect(card.width).toBe(atomicSpecimenWidth(120))
  })

  it('uses compact responsive bounds for small atomic specimens', async () => {
    stubPreviewFigma()
    const value = applied('default', '1')
    value.component.resize(32, 32)

    const board = await buildControlBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const allNodes = descendants(board)
    const card = allNodes.find(child => child.name.startsWith('Specimen /'))!
    const preview = allNodes.find(child => child.name === 'Preview surface')!

    expect(card.width).toBe(216)
    expect(preview.height).toBe(64)
  })

  it('measures wrapped Chinese captions before laying out cards and later rows', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => {
        const text = node('TEXT')
        let characters = ''
        let lineHeight = 14
        Object.defineProperty(text, 'characters', {
          get() { return characters },
          set(value: string) {
            characters = value
            text.width = value.length * 20
            text.height = lineHeight
          }
        })
        Object.defineProperty(text, 'lineHeight', {
          get() { return { unit: 'PIXELS', value: lineHeight } },
          set(value: { unit: 'PIXELS', value: number }) {
            lineHeight = value.value
            text.height = lineHeight
          }
        })
        text.resize = (width: number, height: number) => {
          text.width = width
          if (text.textAutoResize === 'HEIGHT') {
            const charactersPerLine = Math.max(1, Math.floor(width / 20))
            text.height = Math.ceil(characters.length / charactersPerLine) * lineHeight
          } else {
            text.height = height
          }
        }
        return text
      }),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const board = await buildControlBoard(
      Array.from({ length: 7 }, (_, index) => applied('default', String(index + 1))),
      [{ family: 'PingFang SC', style: 'Regular' }],
      'https://example.com'
    ) as unknown as FakeNode
    const cards = descendants(board)
      .filter(child => child.name.startsWith('Specimen /'))
      .sort((left, right) => left.y - right.y || left.x - right.x)

    expect(cards).toHaveLength(7)
    for (const card of cards) {
      const detail = card.children.find(child => child.name === 'State and size')!
      expect(detail.y + detail.height + 16).toBeLessThanOrEqual(card.height)
    }

    const firstRowBottom = Math.max(
      ...cards.filter(card => card.y === cards[0]!.y).map(card => card.y + card.height)
    )
    const secondRow = cards.find(card => card.y > cards[0]!.y)!
    expect(secondRow.y).toBeGreaterThanOrEqual(firstRowBottom + 24)
  })
})
