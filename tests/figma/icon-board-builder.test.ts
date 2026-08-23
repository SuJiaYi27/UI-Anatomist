import { describe, expect, it, vi } from 'vitest'

import {
  buildIconBoard,
  ICON_BOARD_OWNERSHIP_KEY,
  setIconBoardThemeMode
} from '../../src/figma/icon-board-builder'
import { ICON_BOARD_SPEC } from '../../src/figma/icon-board-spec'

type FakeNode = {
  type: string
  name: string
  children: FakeNode[]
  parent?: FakeNode
  width: number
  height: number
  x: number
  y: number
  characters?: string
  textAutoResize?: string
  constraints?: { horizontal: string; vertical: string }
  appendChild(child: FakeNode): void
  resize(width: number, height: number): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  remove(): void
  [key: string]: unknown
}

function fakeNode(type: string): FakeNode {
  const pluginData = new Map<string, string>()
  const item: FakeNode = {
    type,
    name: '',
    children: [],
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    appendChild(child) {
      child.parent = item
      item.children.push(child)
    },
    resize(width, height) {
      item.width = width
      item.height = height
      if (type === 'TEXT' && item.characters) {
        const naturalWidth = [...item.characters].reduce(
          (sum, character) => sum + (/[\u3400-\u9fff]/u.test(character) ? 11 : 6),
          0
        )
        if (item.textAutoResize === 'HEIGHT' && width > 0) {
          item.height = Math.ceil(naturalWidth / width) * 15
        }
      }
    },
    setPluginData(key, value) { pluginData.set(key, value) },
    getPluginData(key) { return pluginData.get(key) ?? '' },
    remove() {}
  }
  if (type === 'TEXT') {
    let characters = ''
    Object.defineProperty(item, 'characters', {
      get: () => characters,
      set(value: string) {
        characters = value
        const naturalWidth = [...value].reduce(
          (sum, character) => sum + (/[\u3400-\u9fff]/u.test(character) ? 11 : 6),
          0
        )
        if (item.textAutoResize === 'HEIGHT' && item.width > 0) {
          item.height = Math.ceil(naturalWidth / item.width) * 15
        } else {
          item.width = naturalWidth
          item.height = 15
        }
      }
    })
  }
  return item
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap(child => [child, ...descendants(child)])
}

describe('setIconBoardThemeMode', () => {
  it('passes the variable collection object required by dynamic-page plugins', () => {
    const setExplicitVariableModeForCollection = vi.fn()
    const frame = { setExplicitVariableModeForCollection }
    const collection = { id: 'VariableCollectionId:1:2' }

    setIconBoardThemeMode(
      frame as unknown as FrameNode,
      collection as unknown as VariableCollection,
      'mode:dark'
    )

    expect(setExplicitVariableModeForCollection)
      .toHaveBeenCalledWith(collection, 'mode:dark')
    expect(setExplicitVariableModeForCollection)
      .not.toHaveBeenCalledWith(collection.id, 'mode:dark')
  })
})

describe('buildIconBoard without confirmed icons', () => {
  it('removes only the existing UI-Anatomist board owned by the same origin', async () => {
    const matching = {
      type: 'FRAME',
      removed: false,
      getPluginData: (key: string) =>
        key === ICON_BOARD_OWNERSHIP_KEY ? 'https://example.com' : '',
      remove() { this.removed = true }
    }
    const otherOrigin = {
      type: 'FRAME',
      removed: false,
      getPluginData: (key: string) =>
        key === ICON_BOARD_OWNERSHIP_KEY ? 'https://other.example' : '',
      remove() { this.removed = true }
    }
    const page = {
      findOne: (predicate: (node: unknown) => boolean) =>
        [otherOrigin, matching].find(predicate) ?? null
    }
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn()
    })

    await expect(buildIconBoard([], [], 'https://example.com')).resolves.toBeNull()
    expect(matching.removed).toBe(true)
    expect(otherOrigin.removed).toBe(false)
    expect(figma.createFrame).not.toHaveBeenCalled()
  })

  it('does not create a board when the origin has no previous owned board', async () => {
    vi.stubGlobal('figma', {
      currentPage: { findOne: () => null },
      createFrame: vi.fn()
    })

    await expect(buildIconBoard([], [], 'https://example.com')).resolves.toBeNull()
    expect(figma.createFrame).not.toHaveBeenCalled()
  })
})

describe('buildIconBoard adaptive layout', () => {
  it('uses the Glyph identity variant for both themed previews of an observed-state set', async () => {
    const page = fakeNode('PAGE')
    page.findOne = () => null
    const preview = (width: number, height: number) => vi.fn(() => {
      const instance = fakeNode('INSTANCE')
      instance.resize(width, height)
      return instance
    })
    const glyph = preview(24, 24)
    const defaultState = preview(50, 50)
    const hoverState = preview(52, 52)
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => fakeNode('FRAME')),
      createText: vi.fn(() => fakeNode('TEXT')),
      createEllipse: vi.fn(() => fakeNode('ELLIPSE')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })

    const board = await buildIconBoard([{
      entry: {
        assetKind: 'component-set',
        states: ['Glyph', 'Default', 'Hover'],
        source: {
          id: 'observed-icon',
          name: 'observed icon',
          category: 'navigation'
        }
      },
      asset: { type: 'COMPONENT_SET' },
      componentSet: { type: 'COMPONENT_SET' },
      components: [
        { createInstance: glyph },
        { createInstance: defaultState },
        { createInstance: hoverState }
      ]
    }] as never, [
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Semibold' }
    ], 'https://example.com') as unknown as FakeNode

    expect(glyph).toHaveBeenCalledTimes(3)
    expect(defaultState).not.toHaveBeenCalled()
    expect(hoverState).not.toHaveBeenCalled()
    const previews = descendants(board).filter(node =>
      node.type === 'INSTANCE' && node.name === 'observed icon'
    )
    expect(board.clipsContent).toBe(false)
    expect(previews).toHaveLength(2)
    expect(previews.every(instance =>
      instance.width === 24 && instance.height === 24
    )).toBe(true)
  })

  it('fails closed when an observed-state asset has no Glyph identity variant', async () => {
    const page = fakeNode('PAGE')
    page.findOne = () => null
    const preview = () => {
      const instance = fakeNode('INSTANCE')
      instance.resize(24, 24)
      return instance
    }
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => fakeNode('FRAME')),
      createText: vi.fn(() => fakeNode('TEXT')),
      createEllipse: vi.fn(() => fakeNode('ELLIPSE')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })

    await expect(buildIconBoard([{
      entry: {
        assetKind: 'component-set',
        states: ['Default', 'Hover'],
        source: { id: 'missing-glyph', name: 'missing glyph', category: 'navigation' }
      },
      asset: { type: 'COMPONENT_SET' },
      componentSet: { type: 'COMPONENT_SET' },
      components: [{ createInstance: preview }, { createInstance: preview }]
    }] as never, [
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Semibold' }
    ], 'https://example.com')).rejects.toThrow('Glyph')
  })

  it('keeps each generated preview instance inside its measured preview region', async () => {
    const page = fakeNode('PAGE')
    page.findOne = () => null
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => fakeNode('FRAME')),
      createText: vi.fn(() => fakeNode('TEXT')),
      createEllipse: vi.fn(() => fakeNode('ELLIPSE')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const footprints = [
      ['glyph', 24, 24],
      ['carrier-50', 50, 50],
      ['carrier-52', 52, 52],
      ['wide', 52, 36]
    ] as const
    const board = await buildIconBoard(footprints.map(([id, width, height]) => ({
      entry: {
        states: ['Default'],
        source: { id, name: id, category: 'navigation' }
      },
      components: [{
        createInstance() {
          const instance = fakeNode('INSTANCE')
          instance.resize(width, height)
          return instance
        }
      }]
    })) as never, [
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Semibold' }
    ], 'https://example.com') as unknown as FakeNode

    const cards = descendants(board).filter(node =>
      node.type === 'FRAME' && node.name.endsWith(' · Light')
    )
    for (const [id, width, height] of footprints) {
      const card = cards.find(candidate => candidate.name === `${id} · Light`)!
      const instance = card.children.find(child => child.type === 'INSTANCE')!
      expect(instance.width).toBe(width)
      expect(instance.height).toBe(height)
      expect(instance.x).toBe((card.width - width) / 2)
      const label = card.children.find(child => child.type === 'TEXT')!
      expect(instance.y).toBeGreaterThanOrEqual(ICON_BOARD_SPEC.previewTopPadding)
      expect(instance.y + instance.height).toBeLessThanOrEqual(label.y)
    }
  })

  it('renders glyph identities while retaining observed Hover indicators', async () => {
    const page = fakeNode('PAGE')
    page.findOne = () => null
    const makeInstance = () => {
      const instance = fakeNode('INSTANCE')
      instance.resize(24, 24)
      return instance
    }
    const defaultPreview = vi.fn(makeInstance)
    const glyphPreview = vi.fn(makeInstance)
    const unobservedHoverPreview = vi.fn(makeInstance)
    const observedDefaultPreview = vi.fn(makeInstance)
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => fakeNode('FRAME')),
      createText: vi.fn(() => fakeNode('TEXT')),
      createEllipse: vi.fn(() => fakeNode('ELLIPSE')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })

    const board = await buildIconBoard([
      {
        entry: {
          assetKind: 'component',
          states: ['Default'],
          source: {
            id: 'component-icon',
            name: 'component icon',
            category: 'navigation'
          }
        },
        asset: { type: 'COMPONENT' },
        componentSet: null,
        components: [{ createInstance: defaultPreview }]
      },
      {
        entry: {
          assetKind: 'component-set',
          states: ['Glyph', 'Default', 'Hover'],
          source: {
            id: 'set-icon',
            name: 'hover icon',
            category: 'action'
          }
        },
        asset: { type: 'COMPONENT_SET' },
        componentSet: { type: 'COMPONENT_SET' },
        components: [{ createInstance: glyphPreview }, {
          createInstance: observedDefaultPreview
        }, {
          createInstance: unobservedHoverPreview
        }]
      }
    ] as never, [
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Semibold' }
    ], 'https://example.com') as unknown as FakeNode

    expect(defaultPreview).toHaveBeenCalledTimes(3)
    expect(glyphPreview).toHaveBeenCalledTimes(3)
    expect(observedDefaultPreview).not.toHaveBeenCalled()
    expect(unobservedHoverPreview).not.toHaveBeenCalled()
    expect(descendants(board).filter(node => node.name === 'hover-indicator'))
      .toHaveLength(2)
  })

  it('wraps long names, grows their rows, and keeps both theme surfaces full bleed', async () => {
    const page = fakeNode('PAGE')
    page.findOne = () => null
    page.selection = []
    const createdFrames: FakeNode[] = []
    const createFrame = vi.fn(() => {
      const frame = fakeNode('FRAME')
      createdFrames.push(frame)
      return frame
    })
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createText: vi.fn(() => fakeNode('TEXT')),
      createEllipse: vi.fn(() => fakeNode('ELLIPSE')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const longName =
      'This is an exceptionally long reusable interface icon name that must wrap safely'
    const applied = Array.from({ length: 41 }, (_, index) => ({
      entry: {
        assetKind: 'component-set',
        states: ['Glyph', 'Default', 'Hover'],
        source: {
          id: `icon-${index}`,
          name: index === 0 ? longName : `icon-${index}`,
          category: index < 33 ? 'navigation' : 'action'
        }
      },
      asset: { type: 'COMPONENT_SET' },
      componentSet: { type: 'COMPONENT_SET' },
      components: [{
        createInstance() {
          const instance = fakeNode('INSTANCE')
          instance.resize(index === 0 ? 52 : 24, index === 0 ? 52 : 24)
          return instance
        }
      }, {
        createInstance() {
          const instance = fakeNode('INSTANCE')
          instance.resize(index === 0 ? 52 : 24, index === 0 ? 52 : 24)
          return instance
        }
      }, {
        createInstance() {
          const instance = fakeNode('INSTANCE')
          instance.resize(index === 0 ? 52 : 24, index === 0 ? 52 : 24)
          return instance
        }
      }]
    }))

    const board = await buildIconBoard(
      applied as never,
      [
        { family: 'PingFang SC', style: 'Regular' },
        { family: 'PingFang SC', style: 'Semibold' }
      ],
      'https://example.com'
    ) as unknown as FakeNode

    const themes = board.children.filter(child =>
      child.type === 'FRAME' && (child.name === 'Light' || child.name === 'Dark')
    )
    expect(themes).toHaveLength(2)
    expect(themes.every(theme =>
      theme.width === board.width &&
      theme.constraints?.horizontal === 'STRETCH'
    )).toBe(true)
    expect(themes.find(theme => theme.name === 'Light')?.constraints?.vertical)
      .toBe('MIN')
    expect(themes.find(theme => theme.name === 'Dark')?.constraints?.vertical)
      .toBe('STRETCH')
    const dark = themes.find(theme => theme.name === 'Dark')!
    expect(dark.y + dark.height).toBe(board.height)

    const cards = themes.flatMap(theme => theme.children.filter(child =>
      child.type === 'FRAME' && child.name.includes(' · ')
    ))
    expect(Math.min(...cards.map(card => card.x)))
      .toBeGreaterThanOrEqual(ICON_BOARD_SPEC.padding)
    expect(Math.max(...cards.map(card => card.x + card.width)))
      .toBeLessThanOrEqual(board.width - ICON_BOARD_SPEC.padding)

    const longCards = cards.filter(card => card.name.startsWith(longName))
    expect(longCards).toHaveLength(2)
    expect(longCards.every(card => card.height > ICON_BOARD_SPEC.cardHeight))
      .toBe(true)
    for (const card of longCards) {
      const label = card.children.find(child =>
        child.type === 'TEXT' && child.characters === longName
      )!
      const indicator = card.children.find(child => child.name === 'hover-indicator')!
      expect(label.textAutoResize).toBe('HEIGHT')
      expect(label.width).toBe(card.width - ICON_BOARD_SPEC.labelInset * 2)
      expect(label.x).toBe(ICON_BOARD_SPEC.labelInset)
      expect(label.y + label.height).toBeLessThanOrEqual(
        indicator.y - ICON_BOARD_SPEC.indicatorGap
      )
      const instance = card.children.find(child => child.type === 'INSTANCE')!
      expect(instance.y + instance.height).toBeLessThanOrEqual(label.y)
      expect(indicator.y + indicator.height + ICON_BOARD_SPEC.cardBottomPadding)
        .toBeLessThanOrEqual(card.height)
    }

    const deepestCardBottom = Math.max(...themes.flatMap(theme =>
      theme.children
        .filter(child => child.type === 'FRAME' && child.name.includes(' · '))
        .map(card => theme.y + card.y + card.height)
    ))
    expect(deepestCardBottom)
      .toBeLessThanOrEqual(board.height - ICON_BOARD_SPEC.padding)
    expect(descendants(board).filter(node => node.type === 'TEXT')
      .every(node => node.x >= 0 && node.y >= 0)).toBe(true)
  })
})
