import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppliedControl,
  ControlComponentPort
} from '../../src/figma/control-component-applier'
import type {
  ControlImportPlanEntry,
  ControlImportPlanGroup
} from '../../src/figma/control-import-plan'
import type { ControlToken } from '../../src/shared/schema'
import {
  buildControlMasterBoard,
  CONTROL_MASTER_BOARD_OWNERSHIP_KEY
} from '../../src/figma/control-master-board-builder'

type FakeNode = {
  id: string
  type: string
  name: string
  children: FakeNode[]
  width: number
  height: number
  x: number
  y: number
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

function control(): ControlToken {
  return {
    id: `sha256:${'1'.repeat(64)}`,
    groupId: `sha256:${'9'.repeat(64)}`,
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
  }
}

function applied(): AppliedControl {
  const source = control()
  const component = node('COMPONENT')
  component.name = 'Control/Button/Primary/SolidDark/Md/Light/TextOnly'
  component.resize(120, 40)
  const entry: ControlImportPlanEntry = {
    action: 'create',
    source,
    targetName: component.name,
    ownershipId: `https://example.com|${source.id}`,
    existingComponentId: null,
    fontName: { family: 'Inter', style: 'Regular' }
  }
  const group: ControlImportPlanGroup = {
    action: 'create',
    kind: 'component',
    groupId: 'button|primary|md|solid-dark|light|text-only',
    targetName: component.name,
    groupOwnershipId:
      'https://example.com|presentation:button|primary|md|solid-dark|light|text-only',
    existingGroupNodeId: null,
    conflictName: null,
    entries: [entry]
  }
  return {
    group,
    entry,
    component: component as unknown as ControlComponentPort,
    componentSet: null
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  nextId = 0
})

describe('buildControlMasterBoard', () => {
  it('documents composite masters before atomic masters with readable captions', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
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
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const compositeRoot = node('COMPONENT')
    compositeRoot.name = 'Composite/Menu/Vertical/Fill'
    compositeRoot.resize(280, 116)
    const composite = {
      group: { groupId: 'composite-group' },
      entry: {
        source: {
          kind: 'menu',
          state: 'default',
          geometry: { gap: 4 },
          layout: { direction: 'vertical', widthBehavior: 'fill' },
          children: [],
          appearance: { background: { r: 1, g: 1, b: 1, a: 1 } }
        }
      },
      component: compositeRoot,
      componentSet: null
    }

    const result = await buildControlMasterBoard(
      [applied()],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode,
      [composite] as never
    ) as unknown as FakeNode
    const cards = descendants(result)
      .filter(item => item.name.startsWith('Master specimen /'))
      .sort((left, right) => left.y - right.y || left.x - right.x)
    const visibleText = descendants(result)
      .filter(item => item.type === 'TEXT')
      .map(item => String(item.characters ?? ''))

    expect(cards).toHaveLength(2)
    expect(descendants(cards[0]!).some(item => item.id === compositeRoot.id)).toBe(true)
    expect(visibleText.some(value => value.includes('Composite/'))).toBe(false)
    expect(visibleText.some(value => value.includes('复合组件'))).toBe(true)
  })

  it('uses a CJK-capable annotation font before Inter when it is available', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)

    const result = await buildControlMasterBoard(
      [applied()],
      [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Semi Bold' },
        { family: 'PingFang SC', style: 'Regular' },
        { family: 'PingFang SC', style: 'Semibold' }
      ],
      'https://example.com',
      anchor as unknown as FrameNode
    )

    expect(descendants(result as unknown as FakeNode)
      .filter(item => item.type === 'TEXT')
      .every(item => (item.fontName as { family: string }).family === 'PingFang SC'))
      .toBe(true)
  })

  it('documents every UI-Anatomist main component without changing the component', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => {
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
      }),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.x = 100
    anchor.y = 1000
    anchor.resize(1513, 500)
    const value = applied()

    const result = await buildControlMasterBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    )
    const allNodes = descendants(result as unknown as FakeNode)
    const cards = allNodes.filter(child => child.name.startsWith('Master specimen /'))
    const boundaries = allNodes.filter(
      child => child.name === 'Inspection clearance — specimen only'
    )

    expect(result.name).toBe('UI-Anatomist / Control Masters')
    expect(result.getPluginData(CONTROL_MASTER_BOARD_OWNERSHIP_KEY))
      .toBe('https://example.com')
    expect(cards).toHaveLength(1)
    expect(boundaries).toHaveLength(0)
    expect(descendants(cards[0])).toContain(value.component)
    expect(allNodes.some(child => child.name === 'Title')).toBe(true)
    expect(allNodes.some(child => child.name === 'State summary')).toBe(true)
    expect(allNodes.some(child => child.name === 'Preview surface')).toBe(true)
    expect(allNodes.find(child => child.name === 'Component name')?.characters)
      .toBe('Button · 主要 · 深色实底 · 中 · 浅色字 · 仅文字')
    expect(allNodes.find(child => child.name === 'State summary')?.characters)
      .toBe('状态：默认')
    expect(result.x).toBe(anchor.x + anchor.width + 80)
    expect(result.y).toBe(anchor.y)
  })

  it('reuses the owned master frame instead of creating a duplicate', async () => {
    const page = node('PAGE')
    const existing = node('FRAME')
    existing.setPluginData(CONTROL_MASTER_BOARD_OWNERSHIP_KEY, 'https://example.com')
    page.findOne = vi.fn(predicate => predicate(existing) ? existing : null)
    const createFrame = vi.fn(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)

    expect(await buildControlMasterBoard(
      [applied()],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    )).toBe(existing)
    expect(existing.name).toBe('UI-Anatomist / Control Masters')
  })

  it('uses a dark preview surface for transparent masters with light foregrounds', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const value = applied()
    value.entry.source.appearance.background = { r: 0, g: 0, b: 0, a: 0 }
    value.entry.source.appearance.foreground = { r: 1, g: 1, b: 1, a: 1 }

    const board = await buildControlMasterBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    ) as unknown as FakeNode
    const preview = descendants(board)
      .find(child => child.name === 'Preview surface')!
    const fill = (preview.fills as Array<{ color: { r: number; g: number; b: number } }>)[0]

    expect(fill.color.r).toBeLessThan(0.2)
    expect(fill.color.g).toBeLessThan(0.2)
    expect(fill.color.b).toBeLessThan(0.2)
  })

  it('keeps the preview transparent when a master needs no contrast surface', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const value = applied()
    value.entry.source.appearance.background = { r: 0, g: 0, b: 0, a: 0 }
    value.entry.source.appearance.foreground = { r: 0, g: 0, b: 0, a: 1 }

    const board = await buildControlMasterBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    ) as unknown as FakeNode
    const preview = descendants(board)
      .find(child => child.name === 'Preview surface')!

    expect(preview.fills).toEqual([])
  })

  it('annotates a master whose text cannot be rendered without substituting its font', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const value = applied()
    value.entry.fontName = null
    value.entry.source.typography.fontFamilyStack = ['Interface Mono']

    const board = await buildControlMasterBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    ) as unknown as FakeNode
    const state = descendants(board).find(child => child.name === 'State summary')!

    expect(state.characters).toBe('状态：默认 · 缺少字体：Interface Mono')
  })

  it('widens master cards so fill-width compound controls never overflow the preview', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const value = applied()
    value.component.resize(360, 52)

    const result = await buildControlMasterBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    )
    const allNodes = descendants(result as unknown as FakeNode)
    const preview = allNodes.find(child => child.name === 'Preview surface')!
    expect(preview.width).toBeGreaterThan(value.component.width + 8)
    expect(value.component.x).toBeGreaterThanOrEqual(0)
    expect(value.component.x + value.component.width).toBeLessThanOrEqual(preview.width)
  })

  it('places one oversized master on its own row without tripling every card width', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const wide = applied()
    const normal = applied()
    wide.component.resize(1600, 80)
    normal.component.resize(120, 40)

    const result = await buildControlMasterBoard(
      [wide, normal],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    ) as unknown as FakeNode
    const cards = descendants(result)
      .filter(child => child.name.startsWith('Master specimen /'))
      .sort((left, right) => left.width - right.width)

    expect(cards).toHaveLength(2)
    expect(cards[0]?.width).toBe(304)
    expect(cards[1]?.width).toBe(1648)
    expect(cards[0]?.y).not.toBe(cards[1]?.y)
    expect(result.width).toBeLessThan(wide.component.width * 2)
  })

  it('uses true render bounds for preview height and keeps the next row below painted overflow', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
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
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const values = [applied(), applied(), applied(), applied()]
    values.forEach((value, index) => {
      ;(value.component as unknown as FakeNode).name = `Control ${index + 1}`
    })
    const overflowing = values[0].component as unknown as FakeNode
    overflowing.absoluteBoundingBox = {
      x: 100, y: 100, width: 120, height: 40
    }
    overflowing.absoluteRenderBounds = {
      x: 88, y: 92, width: 154, height: 188
    }

    const result = await buildControlMasterBoard(
      values,
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    ) as unknown as FakeNode
    const cards = descendants(result)
      .filter(child => child.name.startsWith('Master specimen /'))
      .sort((left, right) => left.y - right.y || left.x - right.x)
    const firstPreview = descendants(cards[0])
      .find(child => child.name === 'Preview surface')!
    const firstRoot = descendants(firstPreview)
      .find(child => child.id === overflowing.id)!
    const renderedTop = firstRoot.y +
      ((overflowing.absoluteRenderBounds as { y: number }).y -
        (overflowing.absoluteBoundingBox as { y: number }).y)
    const renderedBottom = renderedTop +
      (overflowing.absoluteRenderBounds as { height: number }).height

    expect(firstPreview.height).toBeGreaterThanOrEqual(188 + 24)
    expect(renderedTop).toBeGreaterThanOrEqual(12)
    expect(renderedBottom).toBeLessThanOrEqual(firstPreview.height - 12)
    expect(cards[3].y).toBeGreaterThanOrEqual(
      cards[0].y + cards[0].height + 16
    )
  })

  it('falls back to recursive child geometry when the root has no absolute render bounds', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
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
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const values = [applied(), applied(), applied(), applied()]
    values.forEach((value, index) => {
      ;(value.component as unknown as FakeNode).name = `Control ${index + 1}`
    })
    const overflowing = values[0].component as unknown as FakeNode
    const child = node('FRAME')
    child.x = -10
    child.y = -8
    child.resize(120, 80)
    const grandchild = node('RECTANGLE')
    grandchild.x = 0
    grandchild.y = 70
    grandchild.resize(400, 100)
    child.appendChild(grandchild)
    overflowing.appendChild(child)

    const result = await buildControlMasterBoard(
      values,
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    ) as unknown as FakeNode
    const cards = descendants(result)
      .filter(item => item.name.startsWith('Master specimen /'))
      .sort((left, right) => left.y - right.y || left.x - right.x)
    const firstPreview = descendants(cards[0])
      .find(item => item.name === 'Preview surface')!
    const firstRoot = descendants(firstPreview)
      .find(item => item.id === overflowing.id)!
    const paintedLeft = firstRoot.x + child.x
    const paintedTop = firstRoot.y + child.y
    const paintedRight = firstRoot.x + child.x + grandchild.x + grandchild.width
    const paintedBottom = firstRoot.y + child.y + grandchild.y + grandchild.height

    expect(firstPreview.height).toBeGreaterThanOrEqual(170 + 24)
    expect(cards[0].width).toBeGreaterThanOrEqual(400 + 48)
    expect(paintedLeft).toBeGreaterThanOrEqual(8)
    expect(paintedTop).toBeGreaterThanOrEqual(12)
    expect(paintedRight).toBeLessThanOrEqual(firstPreview.width - 8)
    expect(paintedBottom).toBeLessThanOrEqual(firstPreview.height - 12)
    expect(cards[3].y).toBeGreaterThanOrEqual(
      cards[0].y + cards[0].height + 16
    )
  })

  it('does not size a master preview from descendants outside a clipped component', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    const master = node('FRAME')
    const createFrame = vi.fn()
      .mockReturnValueOnce(master)
      .mockImplementation(() => node('FRAME'))
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => node('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const anchor = node('FRAME')
    anchor.resize(1513, 500)
    const value = applied()
    const root = value.component as unknown as FakeNode
    root.clipsContent = true
    const clippedChild = node('FRAME')
    clippedChild.y = 1000
    clippedChild.resize(100, 100)
    root.appendChild(clippedChild)

    const result = await buildControlMasterBoard(
      [value],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com',
      anchor as unknown as FrameNode
    ) as unknown as FakeNode
    const preview = descendants(result)
      .find(item => item.name === 'Preview surface')!

    expect(preview.height).toBe(72)
  })
})
