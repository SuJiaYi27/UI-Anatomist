import { describe, expect, it } from 'vitest'

import {
  ICON_MASTER_BOARD_SPEC,
  layoutIconMasterBoard
} from '../../src/figma/icon-master-board-spec'

describe('layoutIconMasterBoard', () => {
  it('keeps every icon master card inside a dynamic safe-area board', () => {
    const items = Array.from({ length: 61 }, (_, index) => ({
      id: `icon-${index}`,
      category: index < 31
        ? 'navigation' as const
        : index < 48
          ? 'action' as const
          : 'misc' as const,
      labelHeight: index === 4 ? 58 : index % 9 === 0 ? 30 : 15
    }))

    const layout = layoutIconMasterBoard(items)

    expect(layout.width).toBe(ICON_MASTER_BOARD_SPEC.width)
    expect(layout.height).toBeGreaterThan(ICON_MASTER_BOARD_SPEC.minimumHeight)
    expect(layout.cards).toHaveLength(items.length)
    expect(Math.min(...layout.cards.map(card => card.x)))
      .toBeGreaterThanOrEqual(ICON_MASTER_BOARD_SPEC.padding)
    expect(Math.max(...layout.cards.map(card => card.x + card.width)))
      .toBeLessThanOrEqual(layout.width - ICON_MASTER_BOARD_SPEC.padding)
    expect(Math.max(...layout.cards.map(card => card.y + card.height)))
      .toBeLessThanOrEqual(layout.height - ICON_MASTER_BOARD_SPEC.padding)

    for (let index = 0; index < layout.cards.length; index += 1) {
      for (let next = index + 1; next < layout.cards.length; next += 1) {
        const left = layout.cards[index]!
        const right = layout.cards[next]!
        const overlaps = left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y
        expect(overlaps).toBe(false)
      }
    }
  })

  it('returns no board geometry when no icon masters exist', () => {
    expect(layoutIconMasterBoard([])).toEqual({
      width: 0,
      height: 0,
      cards: [],
      categories: []
    })
  })
})
