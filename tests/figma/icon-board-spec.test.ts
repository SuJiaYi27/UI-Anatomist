import { describe, expect, it } from 'vitest'
import { ICON_BOARD_SPEC, layoutIconBoard } from '../../src/figma/icon-board-spec'

describe('layoutIconBoard', () => {
  it('does not reserve Light/Dark sections when there are no confirmed icons', () => {
    expect(layoutIconBoard([])).toEqual({
      boardHeight: 0,
      themes: []
    })
  })

  it('keeps the teacher 1176 width and creates non-overlapping Light/Dark category sections', () => {
    const items = Array.from({ length: 23 }, (_, index) => ({
      id: String(index),
      category: index < 15 ? 'navigation' as const : 'action' as const
    }))
    const layout = layoutIconBoard(items)
    expect(ICON_BOARD_SPEC.width).toBe(1176)
    expect(layout.themes.map(theme => theme.theme)).toEqual(['light', 'dark'])
    expect(layout.boardHeight).toBeGreaterThanOrEqual(1344)
    for (const theme of layout.themes) {
      for (let index = 1; index < theme.cards.length; index += 1) {
        const previous = theme.cards[index - 1]!
        const current = theme.cards[index]!
        const overlaps = previous.x < current.x + current.width &&
          previous.x + previous.width > current.x &&
          previous.y < current.y + current.height &&
          previous.y + previous.height > current.y
        expect(overlaps).toBe(false)
      }
    }
    const dark = layout.themes.at(-1)!
    expect(dark.y + dark.height).toBe(layout.boardHeight)
  })

  it('uses the tallest wrapped label in a row and keeps every card inside the safe area', () => {
    const items = Array.from({ length: 65 }, (_, index) => ({
      id: String(index),
      category: index < 41 ? 'navigation' as const : 'action' as const,
      labelHeight: index === 2 ? 68 : index % 7 === 0 ? 32 : 15
    }))
    const layout = layoutIconBoard(items)

    for (const theme of layout.themes) {
      expect(Math.min(...theme.cards.map(card => card.x)))
        .toBeGreaterThanOrEqual(ICON_BOARD_SPEC.padding)
      expect(Math.max(...theme.cards.map(card => card.x + card.width)))
        .toBeLessThanOrEqual(ICON_BOARD_SPEC.width - ICON_BOARD_SPEC.padding)
      expect(Math.max(...theme.cards.map(card => card.y + card.height)))
        .toBeLessThanOrEqual(layout.boardHeight - ICON_BOARD_SPEC.padding)

      for (const card of theme.cards) {
        expect(card.height).toBeGreaterThanOrEqual(
          card.indicator.y +
          card.indicator.height +
          ICON_BOARD_SPEC.cardBottomPadding
        )
        expect(card.preview.y + card.preview.height).toBeLessThanOrEqual(card.label.y)
        expect(card.label.y + card.label.height).toBeLessThanOrEqual(card.indicator.y)
      }

      const navigation = theme.cards.filter(card => card.category === 'navigation')
      const firstRowY = navigation[0]!.y
      const secondRow = navigation.find(card => card.y > firstRowY)!
      const firstRowBottom = Math.max(...navigation
        .filter(card => card.y === firstRowY)
        .map(card => card.y + card.height))
      expect(secondRow.y).toBeGreaterThanOrEqual(
        firstRowBottom + ICON_BOARD_SPEC.rowGap
      )
    }
  })

  it('derives card regions and row height from every applied asset footprint', () => {
    const items = [
      { id: 'glyph', category: 'navigation' as const, labelHeight: 15, footprint: { width: 24, height: 24 } },
      { id: 'carrier-50', category: 'navigation' as const, labelHeight: 15, footprint: { width: 50, height: 50 } },
      { id: 'carrier-52', category: 'navigation' as const, labelHeight: 68, footprint: { width: 52, height: 52 } },
      { id: 'wide', category: 'navigation' as const, labelHeight: 15, footprint: { width: 52, height: 36 } }
    ]
    const layout = layoutIconBoard(items)

    for (const theme of layout.themes) {
      const cards = theme.cards
      for (const item of items) {
        const card = cards.find(candidate => candidate.id === item.id)!
        expect(card.preview.width).toBeGreaterThanOrEqual(item.footprint.width)
        expect(card.preview.height).toBeGreaterThanOrEqual(item.footprint.height)
        expect(card.preview.y).toBeGreaterThanOrEqual(0)
        expect(card.preview.y + card.preview.height).toBeLessThanOrEqual(card.label.y)
        expect(card.label.y + card.label.height).toBeLessThanOrEqual(card.indicator.y)
        expect(card.indicator.y + card.indicator.height + ICON_BOARD_SPEC.cardBottomPadding)
          .toBeLessThanOrEqual(card.height)
        expect(card.x + card.width).toBeLessThanOrEqual(
          ICON_BOARD_SPEC.width - ICON_BOARD_SPEC.padding
        )
      }

      const navigation = cards.filter(card => card.category === 'navigation')
      const firstRowY = navigation[0]!.y
      const rowHeight = Math.max(...navigation
        .filter(card => card.y === firstRowY)
        .map(card => card.height))
      const following = navigation.find(card => card.y > firstRowY)
      if (following) {
        expect(following.y).toBeGreaterThanOrEqual(firstRowY + rowHeight + ICON_BOARD_SPEC.rowGap)
      }
    }
  })
})
