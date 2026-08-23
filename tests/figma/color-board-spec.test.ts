import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type {
  InteractiveColorToken,
  PrimitiveColorToken,
  SemanticColorToken
} from '../../src/shared/schema'
import {
  COLOR_BOARD_SPECS,
  compactColorLabel,
  contrastTextColor,
  formatColorValue,
  layoutInteractiveBoard,
  layoutPrimitiveBoard,
  layoutSemanticBoard,
  nextColorClusterStartY,
  planColorBoardPositions,
  planOwnedClusterShifts,
  provenanceMark
} from '../../src/figma/color-board-spec'

const primitive = (
  key: string,
  family: PrimitiveColorToken['family'],
  step: number | null,
  provenance: PrimitiveColorToken['provenance'] = 'observed'
): PrimitiveColorToken => ({
  id: `sha256:${key.repeat(64)}`,
  name: step === null ? `${family}-${key.repeat(6)}` : `${family}-${step}`,
  value: key === 'f'
    ? { r: 1, g: 1, b: 1, a: 1 }
    : { r: 0.1, g: 0.2, b: 0.3, a: 1 },
  family,
  step,
  provenance,
  occurrences: provenance === 'inferred' ? 0 : 1
})

describe('color board specifications', () => {
  it('keeps the teacher reference widths and foundation styling', () => {
    expect(COLOR_BOARD_SPECS.primitive.width).toBe(1513)
    expect(COLOR_BOARD_SPECS.semantic.width).toBe(880)
    expect(COLOR_BOARD_SPECS.interactive.width).toBe(506)
    expect(COLOR_BOARD_SPECS.primitive.padding).toBe(40)
    expect(COLOR_BOARD_SPECS.primitive.titleFontSize).toBe(24)
    expect(COLOR_BOARD_SPECS.primitive.cornerRadius).toBe(8)
    expect(COLOR_BOARD_SPECS.primitive.sampleWidth).toBeGreaterThanOrEqual(140)
    expect(COLOR_BOARD_SPECS.semantic.cellWidth).toBeGreaterThanOrEqual(220)
  })

  it('formats hex/alpha and makes provenance explicit', () => {
    expect(formatColorValue({ r: 1, g: 0.5, b: 0, a: 1 })).toBe('#FF8000')
    expect(formatColorValue({ r: 1, g: 0.5, b: 0, a: 0.5 })).toBe('#FF8000 · 50%')
    expect(provenanceMark('observed')).toBe('实测')
    expect(provenanceMark('declared')).toBe('声明')
    expect(provenanceMark('inferred')).toBe('推断')
  })

  it('compacts long token labels while preserving recognizable ends', () => {
    expect(compactColorLabel('surface-primary', 16)).toBe('surface-primary')
    expect(compactColorLabel('surface-extraordinarily-long-primary', 16))
      .toBe('surface-ext…mary')
    expect(compactColorLabel('123456789', 4)).toBe('1234')
  })

  it('chooses readable sample text without creating a token', () => {
    expect(contrastTextColor({ r: 0, g: 0, b: 0, a: 1 })).toBe('light')
    expect(contrastTextColor({ r: 1, g: 1, b: 1, a: 1 })).toBe('dark')
  })

  it('orders primitive families and grows only when rows wrap', () => {
    const short = layoutPrimitiveBoard([
      primitive('f', 'neutral', 0),
      primitive('a', 'blue', 500),
      primitive('b', 'red', 500)
    ])
    expect(short.groups.map(group => group.key)).toEqual(['中性灰', '蓝色', '红色'])
    expect(short.cells.map(cell => cell.label)).toEqual([
      '中性灰-0',
      '蓝色-500',
      '红色-500'
    ])
    const many = layoutPrimitiveBoard(Array.from({ length: 30 }, (_, index) =>
      primitive((index % 9).toString(), 'neutral', index * 25)
    ))
    expect(many.height).toBeGreaterThan(layoutPrimitiveBoard([
      primitive('f', 'neutral', 0)
    ]).height)
    expect(Math.max(...many.cells.map(cell => cell.x + cell.width)))
      .toBeLessThanOrEqual(COLOR_BOARD_SPECS.primitive.width - COLOR_BOARD_SPECS.primitive.padding)
  })

  it('does not present inferred neutrals as deliverable primitive assets', () => {
    const observed = primitive('f', 'neutral', 0)
    const inferred = primitive('a', 'neutral', 500, 'inferred')
    const layout = layoutPrimitiveBoard([observed, inferred])

    expect(layout.cells.map(cell => cell.tokenId)).toEqual([observed.id])
  })

  it('packs small primitive families side by side instead of reserving full-width empty rows', () => {
    const layout = layoutPrimitiveBoard([
      primitive('1', 'cyan', 500),
      primitive('2', 'green', 500),
      primitive('3', 'yellow', 500),
      primitive('4', 'orange', 500),
      primitive('5', 'red', 500),
      primitive('6', 'purple', 500)
    ])

    expect(new Set(layout.groups.map(group => group.y)).size)
      .toBeLessThan(layout.groups.length)
    expect(layout.height).toBeLessThan(500)
  })

  it('orders semantic groups and packs observed interactive states without fabricated gaps', () => {
    const base = primitive('f', 'neutral', 0)
    const semantic: SemanticColorToken[] = ['border', 'background', 'status'].map((group, index) => ({
      id: `sha256:${String(index + 1).repeat(64)}`,
      name: `${group}-primary`, group: group as SemanticColorToken['group'],
      value: base.value, primitiveId: base.id, provenance: 'observed', occurrences: 1
    }))
    expect(layoutSemanticBoard(semantic).groups.map(group => group.key))
      .toEqual(['背景', '边框', '状态'])
    expect(layoutSemanticBoard(semantic).cells.map(cell => cell.label))
      .toEqual(['背景-主要', '边框-主要', '状态-主要'])

    const interactive: InteractiveColorToken[] = ['selected', 'hover'].map((state, index) => ({
      id: `sha256:${String(index + 4).repeat(64)}`,
      name: `primary-${state}-background`, intent: 'primary',
      state: state as InteractiveColorToken['state'], usage: 'background',
      value: base.value, primitiveId: base.id, provenance: 'declared', occurrences: 1
    }))
    const layout = layoutInteractiveBoard(interactive)
    expect(layout.groups.map(group => group.key)).toEqual(['主要 · 背景'])
    expect(layout.cells.map(cell => cell.label)).toEqual(['悬浮', '选中'])
    expect(layout.cells).toHaveLength(2)
    expect(layout.cells[0]?.x).toBeLessThan(layout.cells[1]?.x ?? 0)
    expect(layout.cells[0]?.x).toBe(COLOR_BOARD_SPECS.interactive.padding)
    expect(layout.cells[1]?.x).toBe(
      COLOR_BOARD_SPECS.interactive.padding +
      COLOR_BOARD_SPECS.interactive.cellWidth +
      COLOR_BOARD_SPECS.interactive.columnGap
    )
  })

  it('keeps generated labels within their fixed cell widths', () => {
    const base = primitive('f', 'neutral', 0)
    const semantic: SemanticColorToken = {
      id: `sha256:${'8'.repeat(64)}`,
      name: 'surface-extraordinarily-long-primary',
      group: 'background', value: base.value, primitiveId: base.id,
      provenance: 'declared', occurrences: 1
    }
    expect(layoutSemanticBoard([semantic]).cells[0]?.label)
      .toBe('surface-extraordinarily-long-主要')
  })

  it('uses measured wrapped text height and preserves a 40px safe area on every edge', () => {
    const base = primitive('f', 'neutral', 0)
    const semantic: SemanticColorToken[] = Array.from({ length: 18 }, (_, index) => ({
      id: `sha256:${String(index).padStart(2, '0').repeat(32)}`,
      name: `surface-extraordinarily-long-primary-${index}`,
      group: 'background',
      value: base.value,
      primitiveId: base.id,
      provenance: 'observed',
      occurrences: 1
    }))
    const measurements = new Map(semantic.map((token, index) => [
      token.id,
      {
        width: index === 0 ? 10_000 : 180,
        height: index === 0 ? 116 : 86
      }
    ]))
    const layout = layoutSemanticBoard(semantic, measurements)
    const right = COLOR_BOARD_SPECS.semantic.width - COLOR_BOARD_SPECS.semantic.padding
    expect(layout.cells[0]).toMatchObject({
      x: COLOR_BOARD_SPECS.semantic.padding,
      width: right - COLOR_BOARD_SPECS.semantic.padding,
      height: 116
    })
    expect(layout.cells.every(cell => cell.x >= COLOR_BOARD_SPECS.semantic.padding)).toBe(true)
    expect(layout.cells.every(cell => cell.x + cell.width <= right)).toBe(true)
    expect(layout.height - Math.max(...layout.cells.map(cell => cell.y + cell.height)))
      .toBeGreaterThanOrEqual(COLOR_BOARD_SPECS.semantic.padding)

    const sorted = [...layout.cells].sort((left, rightCell) =>
      left.y - rightCell.y || left.x - rightCell.x
    )
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      if (previous && current && previous.y === current.y) {
        expect(current.x).toBeGreaterThanOrEqual(
          previous.x + previous.width + COLOR_BOARD_SPECS.semantic.columnGap
        )
      }
    }
  })

  it('places a second source after existing owned boards while preserving an existing source position', () => {
    const first = planColorBoardPositions({
      primitiveHeight: 500, semanticHeight: 600, interactiveHeight: 400,
      startY: nextColorClusterStartY([], null)
    })
    expect(first.primitive).toEqual({ x: 100, y: 100 })
    const firstBottom = Math.max(
      first.semantic.y + 600,
      first.interactive.y + 400
    )
    const secondStart = nextColorClusterStartY([{ y: 100, height: firstBottom - 100 }], null)
    const second = planColorBoardPositions({
      primitiveHeight: 300, semanticHeight: 300, interactiveHeight: 300, startY: secondStart
    })
    expect(second.primitive.y).toBeGreaterThan(firstBottom)
    expect(nextColorClusterStartY([{ y: 100, height: 1200 }], 260)).toBe(260)
  })

  it('pushes later owned sources down when an earlier source grows', () => {
    const shifts = planOwnedClusterShifts([
      { origin: 'https://a.example', y: 100, height: 500 },
      { origin: 'https://a.example', y: 680, height: 900 },
      { origin: 'https://b.example', y: 1200, height: 500 },
      { origin: 'https://c.example', y: 1800, height: 300 }
    ])
    expect(shifts).toEqual([
      { origin: 'https://a.example', shiftY: 0 },
      { origin: 'https://b.example', shiftY: 460 },
      { origin: 'https://c.example', shiftY: 440 }
    ])
  })

  it('measures wrapped Figma text before laying out every color board', () => {
    const source = readFileSync(
      new URL('../../src/figma/color-board-builder.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain("node.textAutoResize = 'HEIGHT'")
    expect(source).toContain('layoutPrimitiveBoard(visible, measurements)')
    expect(source).toContain('layoutSemanticBoard(visible, measurements)')
    expect(source).toContain('layoutInteractiveBoard(visible, measurements)')
    expect(source).toContain("alias.name = 'Primitive alias'")
    expect(source).toContain('按用途与状态分组')
    expect(source).not.toContain('compactColorLabel(')
  })
})
