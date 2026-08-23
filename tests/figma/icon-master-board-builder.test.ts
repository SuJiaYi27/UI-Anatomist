import { describe, expect, it, vi } from 'vitest'

import {
  buildIconMasterBoard,
  ICON_MASTER_BOARD_OWNERSHIP_KEY,
  ICON_MASTER_SOURCE_ASSETS_OWNERSHIP_KEY
} from '../../src/figma/icon-master-board-builder'
import { ICON_MASTER_BOARD_SPEC } from '../../src/figma/icon-master-board-spec'
import { ICON_NODE_OWNERSHIP_KEY } from '../../src/figma/icon-component-applier'

type FakeNode = {
  id: string
  type: string
  name: string
  children: FakeNode[]
  parent?: FakeNode
  x: number
  y: number
  width: number
  height: number
  characters?: string
  textAutoResize?: string
  appendChild(child: FakeNode): void
  resize(width: number, height: number): void
  remove(): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData(namespace: string, key: string, value: string): void
  getSharedPluginData(namespace: string, key: string): string
  [key: string]: unknown
}

let nextId = 0

function fakeNode(type: string): FakeNode {
  const privateData = new Map<string, string>()
  const sharedData = new Map<string, string>()
  const node: FakeNode = {
    id: `${type}:${nextId += 1}`,
    type,
    name: '',
    children: [],
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    appendChild(child) {
      if (child.parent) {
        child.parent.children = child.parent.children.filter(item => item !== child)
      }
      child.parent = node
      node.children.push(child)
    },
    resize(width, height) {
      node.width = width
      node.height = height
    },
    remove() {
      if (node.parent) {
        node.parent.children = node.parent.children.filter(item => item !== node)
      }
      node.parent = undefined
    },
    setPluginData(key, value) { privateData.set(key, value) },
    getPluginData(key) { return privateData.get(key) ?? '' },
    setSharedPluginData(namespace, key, value) {
      sharedData.set(`${namespace}:${key}`, value)
    },
    getSharedPluginData(namespace, key) {
      return sharedData.get(`${namespace}:${key}`) ?? ''
    }
  }
  if (type === 'TEXT') {
    let characters = ''
    Object.defineProperty(node, 'characters', {
      get: () => characters,
      set(value: string) {
        characters = value
        const naturalWidth = [...value].reduce(
          (sum, character) =>
            sum + (/[\u3400-\u9fff]/u.test(character) ? 11 : 6),
          0
        )
        if (node.textAutoResize === 'HEIGHT' && node.width > 0) {
          node.height = Math.ceil(naturalWidth / node.width) * 15
        } else {
          node.width = naturalWidth
          node.height = 15
        }
      }
    })
  }
  return node
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap(child => [child, ...descendants(child)])
}

describe('buildIconMasterBoard', () => {
  it('keeps observed-state assets hidden while cards preview only Glyph', async () => {
    const page = fakeNode('PAGE')
    page.findOne = (predicate: (node: FakeNode) => boolean) =>
      [page, ...descendants(page)].find(predicate) ?? null
    const glyph = fakeNode('COMPONENT')
    glyph.name = 'State=Glyph'
    glyph.resize(24, 24)
    glyph.createInstance = () => {
      const instance = fakeNode('INSTANCE')
      instance.mainComponent = glyph
      instance.resize(24, 24)
      return instance
    }
    const defaultState = fakeNode('COMPONENT')
    defaultState.name = 'State=Default'
    defaultState.resize(50, 50)
    const hoverState = fakeNode('COMPONENT')
    hoverState.name = 'State=Hover'
    hoverState.resize(52, 52)
    const asset = fakeNode('COMPONENT_SET')
    const assetId = asset.id
    asset.name = 'Icon/Navigation/Observed'
    asset.appendChild(glyph)
    asset.appendChild(defaultState)
    asset.appendChild(hoverState)
    asset.resize(174, 52)
    asset.setPluginData(ICON_NODE_OWNERSHIP_KEY, 'https://example.com|icon:observed')
    page.appendChild(asset)
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => {
        const frame = fakeNode('FRAME')
        page.appendChild(frame)
        return frame
      }),
      createText: vi.fn(() => fakeNode('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })

    const board = await buildIconMasterBoard([{
      entry: {
        assetKind: 'component-set',
        states: ['Glyph', 'Default', 'Hover'],
        source: { id: 'observed', name: 'Observed', category: 'navigation' }
      },
      asset,
      componentSet: asset,
      components: [glyph, defaultState, hoverState]
    }] as never, [
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Semibold' }
    ], 'https://example.com') as unknown as FakeNode

    const card = descendants(board).find(node =>
      node.name === 'Master specimen / Observed'
    )!
    const preview = card.children.find(child => child.type === 'INSTANCE')!
    expect(preview.mainComponent).toBe(glyph)
    expect(card.children).not.toContain(asset)
    expect(board.children.some(child => child.name === 'Source assets')).toBe(false)
    const sourceAssets = page.children.find(child =>
      child.getPluginData(ICON_MASTER_SOURCE_ASSETS_OWNERSHIP_KEY) ===
        'https://example.com'
    )!
    expect(asset.parent).toBe(sourceAssets)
    expect(asset.parent).not.toBe(page)
    expect(asset.children).toEqual([glyph, defaultState, hoverState])
    expect(sourceAssets.visible).toBe(false)
    expect(board.height).toBeLessThan(ICON_MASTER_BOARD_SPEC.minimumHeight + 200)

    const rediscoveredAsset = descendants(page).find(node =>
      node.type === 'COMPONENT_SET' &&
      node.getPluginData(ICON_NODE_OWNERSHIP_KEY) ===
        'https://example.com|icon:observed'
    )!
    expect(rediscoveredAsset).toBe(asset)
    const rediscoveredComponents = rediscoveredAsset.children.filter(node =>
      node.type === 'COMPONENT'
    )

    const rebuilt = await buildIconMasterBoard([{
      entry: {
        assetKind: 'component-set',
        states: ['Glyph', 'Default', 'Hover'],
        source: { id: 'observed', name: 'Observed', category: 'navigation' },
        ownershipId: 'https://example.com|icon:observed',
        existingNodeId: rediscoveredAsset.id
      },
      asset: rediscoveredAsset,
      componentSet: rediscoveredAsset,
      components: rediscoveredComponents
    }] as never, [
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Semibold' }
    ], 'https://example.com') as unknown as FakeNode

    expect(rebuilt).toBe(board)
    expect(board.children.some(child => child.name === 'Source assets')).toBe(false)
    const rebuiltSourceAssets = page.children.filter(child =>
      child.getPluginData(ICON_MASTER_SOURCE_ASSETS_OWNERSHIP_KEY) ===
        'https://example.com'
    )
    expect(rebuiltSourceAssets).toHaveLength(1)
    expect(asset.parent).toBe(rebuiltSourceAssets[0])
    expect(asset.id).toBe(assetId)
    expect(page.children).not.toContain(asset)
    const rebuiltCard = descendants(board).find(node =>
      node.name === 'Master specimen / Observed'
    )!
    expect(rebuiltCard.children.find(child => child.type === 'INSTANCE')?.mainComponent)
      .toBe(glyph)
  })

  it('contains mixed Components and observed-state Component Sets in one dynamic board without overlap', async () => {
    const page = fakeNode('PAGE')
    page.findOne = () => null
    const roots = Array.from({ length: 30 }, (_, index) => {
      const root = fakeNode(index % 3 === 0 ? 'COMPONENT' : 'COMPONENT_SET')
      root.name = `Icon/${index < 19 ? 'Navigation' : 'Action'}/Icon ${index}`
      root.resize(32, 32)
      page.appendChild(root)
      return root
    })
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => fakeNode('FRAME')),
      createText: vi.fn(() => fakeNode('TEXT')),
      loadFontAsync: vi.fn().mockResolvedValue(undefined)
    })
    const previewable = (component: FakeNode) => {
      component.createInstance = () => {
        const instance = fakeNode('INSTANCE')
        instance.mainComponent = component
        instance.resize(component.width, component.height)
        return instance
      }
      return component
    }
    const applied = roots.map((asset, index) => {
      if (asset.type === 'COMPONENT') {
        return {
          entry: {
            assetKind: 'component' as const,
            states: ['Default'],
            source: {
              id: `icon-${index}`,
              name: index === 3
                ? 'A very long reusable interface icon name that wraps safely'
                : `Icon ${index}`,
              category: index < 19 ? 'navigation' as const : 'action' as const
            }
          },
          asset,
          componentSet: null,
          components: [previewable(asset)]
        }
      }
      const glyph = previewable(fakeNode('COMPONENT'))
      glyph.name = 'State=Glyph'
      glyph.resize(24, 24)
      const defaultState = previewable(fakeNode('COMPONENT'))
      defaultState.name = 'State=Default'
      defaultState.resize(32, 32)
      const hoverState = previewable(fakeNode('COMPONENT'))
      hoverState.name = 'State=Hover'
      hoverState.resize(32, 32)
      asset.appendChild(glyph)
      asset.appendChild(defaultState)
      asset.appendChild(hoverState)
      return {
        entry: {
          assetKind: 'component-set' as const,
          states: ['Glyph', 'Default', 'Hover'],
          source: {
            id: `icon-${index}`,
            name: index === 3
              ? 'A very long reusable interface icon name that wraps safely'
              : `Icon ${index}`,
            category: index < 19 ? 'navigation' as const : 'action' as const
          }
        },
        asset,
        componentSet: asset,
        components: [glyph, defaultState, hoverState]
      }
    })
    const board = await buildIconMasterBoard(
      applied as never,
      [
        { family: 'PingFang SC', style: 'Regular' },
        { family: 'PingFang SC', style: 'Semibold' }
      ],
      'https://example.com'
    ) as unknown as FakeNode

    expect(board.name).toBe('UI-Anatomist / Icon Masters')
    expect(board.width).toBe(ICON_MASTER_BOARD_SPEC.width)
    expect(board.getPluginData(ICON_MASTER_BOARD_OWNERSHIP_KEY))
      .toBe('https://example.com')
    expect(roots.every(root => descendants(page).includes(root))).toBe(true)
    expect(roots.every(root => descendants(board).includes(root))).toBe(false)
    expect(board.children.some(child => child.name === 'Source assets')).toBe(false)

    const cards = descendants(board).filter(node =>
      node.type === 'FRAME' && node.name.startsWith('Master specimen / ')
    )
    expect(cards).toHaveLength(roots.length)
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index]!
      expect(card.x).toBeGreaterThanOrEqual(ICON_MASTER_BOARD_SPEC.padding)
      expect(card.x + card.width)
        .toBeLessThanOrEqual(board.width - ICON_MASTER_BOARD_SPEC.padding)
      expect(card.y + card.height)
        .toBeLessThanOrEqual(board.height - ICON_MASTER_BOARD_SPEC.padding)
      expect(card.children.some(child => child.type === 'INSTANCE')).toBe(true)
    }
    const summary = descendants(board).find(node => node.name === 'Summary')
    expect(summary?.characters).toContain('10 components')
    expect(summary?.characters).toContain('20 observed-state sets')
  })
})
