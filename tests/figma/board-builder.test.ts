import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTypographyBoard, TYPOGRAPHY_BOARD_OWNERSHIP_KEY } from '../../src/figma/board-builder'
import type { AppliedStyle } from '../../src/figma/style-applier'

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
  setTextStyleIdAsync: ReturnType<typeof vi.fn>
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
    setTextStyleIdAsync: vi.fn(async function (this: FakeNode) {
      this.height = 96
    })
  }
}

function textNode(): FakeNode {
  const text = node('TEXT')
  let characters = ''
  Object.defineProperty(text, 'characters', {
    get() { return characters },
    set(value: string) {
      characters = value
      const lines = value.split('\n')
      text.width = Math.max(...lines.map(line => line.length * 7), 1)
      text.height = Math.max(lines.length * 18, 18)
    }
  })
  return text
}

function installFigma(existing: FakeNode | null = null): {
  page: FakeNode
  createFrame: ReturnType<typeof vi.fn>
  createText: ReturnType<typeof vi.fn>
} {
  const page = node('PAGE')
  page.findOne = vi.fn((predicate: (candidate: FakeNode) => boolean) =>
    existing && predicate(existing) ? existing : null
  )
  page.selection = []
  const createFrame = vi.fn(() => node('FRAME'))
  const createText = vi.fn(() => textNode())
  vi.stubGlobal('figma', {
    currentPage: page,
    createFrame,
    createText,
    loadFontAsync: vi.fn().mockResolvedValue(undefined),
    viewport: { scrollAndZoomIntoView: vi.fn() }
  })
  return { page, createFrame, createText }
}

function style(index: number): AppliedStyle {
  return {
    entry: {
      action: 'create',
      source: {
        id: `sha256:${String(index).padStart(64, '0')}`,
        name: `body-${index}`,
        fontFamilyStack: ['Inter'],
        fontStyle: 'normal',
        fontSizePx: 16,
        fontWeight: 400,
        lineHeightPx: 96,
        letterSpacingPx: 0,
        role: 'body',
        occurrences: 1
      },
      targetName: `UI-Anatomist/body-${index}`,
      ownershipId: `https://example.com|${index}`,
      existingStyleId: null,
      fontName: { family: 'Inter', style: 'Regular' }
    },
    style: {
      id: `style:${index}`,
      name: `UI-Anatomist/body-${index}`,
      description: '',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 96 },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      setPluginData: vi.fn(),
      getPluginData: vi.fn(() => ''),
      remove: vi.fn()
    }
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('buildTypographyBoard', () => {
  it('removes the same-origin board when the scan contains no typography', async () => {
    const existing = node('FRAME')
    existing.setPluginData(TYPOGRAPHY_BOARD_OWNERSHIP_KEY, 'https://example.com')
    installFigma(existing)

    await expect(buildTypographyBoard([], [], 'https://example.com')).resolves.toBeNull()

    expect(existing.removed).toHaveBeenCalledOnce()
  })

  it('gives every text row an explicit remaining width and grows the board around measured rows', async () => {
    installFigma()

    const board = await buildTypographyBoard(
      Array.from({ length: 10 }, (_, index) => style(index + 1)),
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    expect(board).not.toBeNull()
    if (!board) return
    expect(board.paddingTop).toBe(40)
    expect(board.paddingRight).toBe(40)
    expect(board.paddingBottom).toBe(40)
    expect(board.paddingLeft).toBe(40)

    const rows = board.children.slice(2)
    const firstSample = rows[0]?.children[1]
    expect(firstSample?.width).toBeGreaterThan(0)
    expect(firstSample?.layoutGrow).toBe(1)
    expect(firstSample?.textAutoResize).toBe('HEIGHT')

    const measuredContentHeight = board.children.reduce((sum, child) => sum + child.height, 0)
      + Math.max(0, board.children.length - 1) * Number(board.itemSpacing)
    expect(board.height).toBeGreaterThanOrEqual(
      Number(board.paddingTop) + measuredContentHeight + Number(board.paddingBottom)
    )
  })

  it('uses Chinese presentation copy while preserving the scanned font specimen', async () => {
    installFigma()

    const board = await buildTypographyBoard(
      [style(1)],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    expect(board?.name).toBe('UI-Anatomist / 字体')
    expect((board?.children[0] as FakeNode).characters).toBe('字体')
    expect((board?.children[1] as FakeNode).characters).toContain('默认字体')
    expect((board?.children[1] as FakeNode).characters).toContain('等宽字体')
    expect((board?.children[2]?.children[1] as FakeNode).characters)
      .toBe('The quick brown fox')
  })
})
