import { describe, expect, it } from 'vitest'
import {
  CONTROL_BOARD_SPEC,
  atomicPreviewHeight,
  atomicSpecimenWidth,
  layoutControlBoard,
  orderedCatalogSections,
  orderedControlFamilies,
  orderedControlStates
} from '../../src/figma/control-board-spec'

describe('control board specification', () => {
  it('uses the approved teacher-aligned wide layout', () => {
    expect(CONTROL_BOARD_SPEC).toMatchObject({
      width: 1513,
      padding: 40,
      columns: 3,
      specimenMinWidth: 445,
      titleFontSize: 24,
      cornerRadius: 8,
      sectionGap: 32,
      itemGap: 24
    })
  })

  it('keeps deterministic family and observed-state order', () => {
    expect(orderedCatalogSections).toEqual([
      'composites', 'button', 'input', 'textarea',
      'select', 'toggle', 'checkbox', 'radio'
    ])
    expect(orderedControlFamilies).toEqual([
      'button', 'input', 'textarea', 'select', 'toggle', 'checkbox', 'radio'
    ])
    expect(orderedControlStates).toEqual([
      'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
    ])
  })

  it('keeps atomic specimen cards compact while preserving large content', () => {
    expect(atomicSpecimenWidth(18)).toBe(216)
    expect(atomicSpecimenWidth(120)).toBe(216)
    expect(atomicSpecimenWidth(320)).toBe(416)
    expect(atomicSpecimenWidth(900)).toBe(445)

    expect(atomicPreviewHeight(18)).toBe(48)
    expect(atomicPreviewHeight(32)).toBe(48)
    expect(atomicPreviewHeight(80)).toBe(96)
    expect(atomicPreviewHeight(900)).toBe(96)
  })

  it('wraps samples before the board content width and grows dynamically', () => {
    const layout = layoutControlBoard([
      { id: '1', family: 'button', state: 'default', width: 720, height: 40 },
      { id: '2', family: 'button', state: 'hover', width: 720, height: 40 },
      { id: '3', family: 'button', state: 'pressed', width: 120, height: 40 },
      { id: '4', family: 'input', state: 'default', width: 360, height: 40 }
    ])
    expect(layout.items[1]?.y).toBeGreaterThan(layout.items[0]?.y ?? 0)
    expect(layout.items.every(item =>
      item.x + item.width <= layout.boardWidth - CONTROL_BOARD_SPEC.padding
    )).toBe(true)
    expect(layout.sections.map(section => section.family)).toEqual(['button', 'input'])
    expect(layout.boardHeight).toBeGreaterThan(CONTROL_BOARD_SPEC.emptyHeight)
  })

  it('uses three stable catalog columns for ordinary specimens', () => {
    const layout = layoutControlBoard(Array.from({ length: 7 }, (_, index) => ({
      id: String(index),
      family: 'button' as const,
      state: 'default' as const,
      width: CONTROL_BOARD_SPEC.specimenMinWidth,
      height: 220
    })))
    const rows = new Map<number, number>()
    for (const item of layout.items) {
      rows.set(item.y, (rows.get(item.y) ?? 0) + 1)
    }

    expect([...rows.values()]).toEqual([3, 3, 1])
  })

  it('widens for an oversized first item and keeps the item inside its safety area', () => {
    const layout = layoutControlBoard([
      { id: 'wide', family: 'button', state: 'default', width: 1900, height: 80 },
      { id: 'normal', family: 'button', state: 'hover', width: 216, height: 80 }
    ])

    expect(layout.boardWidth).toBe(1900 + CONTROL_BOARD_SPEC.padding * 2)
    expect(layout.items.every(item =>
      item.x >= CONTROL_BOARD_SPEC.padding &&
      item.x + item.width <= layout.boardWidth - CONTROL_BOARD_SPEC.padding
    )).toBe(true)
  })

  it('returns one readable empty-state board when nothing was observed', () => {
    expect(layoutControlBoard([])).toEqual({
      boardWidth: CONTROL_BOARD_SPEC.width,
      boardHeight: CONTROL_BOARD_SPEC.emptyHeight,
      sections: [],
      items: []
    })
  })
})
