import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpacingToken } from '../../src/shared/schema'
import { buildSpacingBoard } from '../../src/figma/spacing-board-builder'
import type { AppliedSpacing, SpacingVariablePort } from '../../src/figma/spacing-variable-applier'

type FakeNode = {
  type: string
  name: string
  children: FakeNode[]
  width: number
  height: number
  x: number
  y: number
  pluginData: Map<string, string>
  appendChild(node: FakeNode): void
  remove(): void
  resize(width: number, height: number): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setBoundVariable: ReturnType<typeof vi.fn>
  [key: string]: unknown
}

function node(type: string): FakeNode {
  return {
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
    getPluginData(key) { return this.pluginData.get(key) ?? '' },
    setBoundVariable: vi.fn()
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('buildSpacingBoard', () => {
  it('creates one owned board with a width-bound sample per applied variable', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    const createFrame = vi.fn(() => node('FRAME'))
    const createRectangle = vi.fn(() => node('RECTANGLE'))
    const createText = vi.fn(() => {
      const text = node('TEXT')
      Object.defineProperty(text, 'characters', {
        set(value: string) { text.width = value.length * 6 }
      })
      return text
    })
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle,
      createText,
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const token: SpacingToken = {
      id: `sha256:${'1'.repeat(64)}`,
      name: 'spacing-8',
      value: 8,
      occurrences: 2,
      evidence: { padding: 1, gap: 1, margin: 0 },
      stateOccurrences: 1
    }
    const variable = { id: 'variable:8' } as SpacingVariablePort
    const applied: AppliedSpacing[] = [{
      entry: {
        action: 'create',
        source: token,
        targetName: 'Spacing/8',
        ownershipId: `https://example.com|${token.id}`,
        existingVariableId: null
      },
      variable
    }]

    const board = await buildSpacingBoard(
      [token],
      applied,
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    expect(board.name).toBe('UI-Anatomist / Spacing')
    const sample = createRectangle.mock.results[0]?.value as FakeNode
    expect(sample.setBoundVariable).toHaveBeenCalledWith('width', variable)
    expect(page.selection).toEqual([board])
  })

  it('expands cells for real large spacing values instead of clipping their rulers', async () => {
    const page = node('PAGE')
    page.findOne = vi.fn(() => null)
    page.selection = []
    const createFrame = vi.fn(() => node('FRAME'))
    const createRectangle = vi.fn(() => node('RECTANGLE'))
    const createText = vi.fn(() => {
      const text = node('TEXT')
      Object.defineProperty(text, 'characters', {
        set(value: string) {
          text.width = Math.max(...value.split('\n').map(line => line.length * 6))
          text.height = value.split('\n').length * 10
        }
      })
      return text
    })
    vi.stubGlobal('figma', {
      currentPage: page,
      createFrame,
      createRectangle,
      createText,
      loadFontAsync: vi.fn().mockResolvedValue(undefined),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    })

    const token: SpacingToken = {
      id: `sha256:${'2'.repeat(64)}`,
      name: 'spacing-800',
      value: 800,
      occurrences: 2,
      evidence: { padding: 1, gap: 1, margin: 0 },
      stateOccurrences: 1
    }

    const board = await buildSpacingBoard(
      [token],
      [],
      [{ family: 'Inter', style: 'Regular' }],
      'https://example.com'
    )

    const cell = createFrame.mock.results[1]?.value as FakeNode
    const sample = createRectangle.mock.results[0]?.value as FakeNode
    expect(cell.clipsContent).toBe(false)
    expect(cell.width).toBeGreaterThanOrEqual(sample.width)
    expect(cell.x + sample.width).toBeLessThanOrEqual(board.width - 40)
  })
})
