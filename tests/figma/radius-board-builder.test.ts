import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BorderRadiusToken } from '../../src/shared/schema'
import { buildRadiusBoard, RADIUS_BOARD_OWNERSHIP_KEY } from '../../src/figma/radius-board-builder'

type FakeNode = {
  type: string
  name: string
  children: FakeNode[]
  width: number
  height: number
  x: number
  y: number
  pluginData: Map<string, string>
  removed: ReturnType<typeof vi.fn>
  appendChild(node: FakeNode): void
  remove(): void
  resize(width: number, height: number): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setBoundVariable: ReturnType<typeof vi.fn>
  [key: string]: unknown
}

function node(type: string): FakeNode {
  const removed = vi.fn()
  return {
    type,
    name: '',
    children: [],
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    pluginData: new Map(),
    removed,
    appendChild(child) { this.children.push(child) },
    remove() { removed() },
    resize(width, height) { this.width = width; this.height = height },
    setPluginData(key, value) { this.pluginData.set(key, value) },
    getPluginData(key) { return this.pluginData.get(key) ?? '' },
    setBoundVariable: vi.fn()
  }
}

function textNode(): FakeNode {
  const text = node('TEXT')
  Object.defineProperty(text, 'characters', {
    set(value: string) {
      text.width = Math.max(value.length * 6, 1)
      text.height = 12
    }
  })
  return text
}

function token(index: number): BorderRadiusToken {
  return {
    id: `sha256:${index.toString(16).padStart(64, '0')}`,
    name: `radius-${index}`,
    kind: 'px',
    value: index,
    occurrences: 1
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('buildRadiusBoard', () => {
  it('removes the same-origin board when the scan contains no radii', async () => {
    const existing = node('FRAME')
    existing.setPluginData(RADIUS_BOARD_OWNERSHIP_KEY, 'https://example.com')
    const page = node('PAGE')
    page.findOne = vi.fn((predicate: (candidate: FakeNode) => boolean) =>
      predicate(existing) ? existing : null
    )
    vi.stubGlobal('figma', { currentPage: page })

    await expect(buildRadiusBoard([], [], [], 'https://example.com')).resolves.toBeNull()

    expect(existing.removed).toHaveBeenCalledOnce()
  })

  it('keeps every row inside forty-pixel right and bottom safety areas', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame: vi.fn(() => node('FRAME')),
      createRectangle: vi.fn(() => node('RECTANGLE')),
      createText: vi.fn(() => textNode()),
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const board = await buildRadiusBoard(
      Array.from({ length: 17 }, (_, index) => token(index + 1)),
      [],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    expect(board).not.toBeNull()
    if (!board) return
    const cells = board.children.filter(child => child.name.startsWith('radius-'))
    expect(cells).toHaveLength(17)
    expect(Math.max(...cells.map(cell => cell.x + cell.width))).toBeLessThanOrEqual(board.width - 40)
    expect(Math.max(...cells.map(cell => cell.y + cell.height))).toBeLessThanOrEqual(board.height - 40)
  })
})
