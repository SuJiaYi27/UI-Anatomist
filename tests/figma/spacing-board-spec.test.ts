import { describe, expect, it } from 'vitest'
import type { SpacingToken } from '../../src/shared/schema'
import {
  SPACING_BOARD_SPEC,
  spacingBoardHeight,
  spacingTokenDetail,
  spacingTokenLabel
} from '../../src/figma/spacing-board-spec'

const token: SpacingToken = {
  id: `sha256:${'1'.repeat(64)}`,
  name: 'spacing-8',
  value: 8,
  occurrences: 7,
  evidence: { padding: 4, gap: 2, margin: 1 },
  stateOccurrences: 3
}

describe('spacing board specification', () => {
  it('uses a compact six-column teacher-compatible layout', () => {
    expect(SPACING_BOARD_SPEC).toEqual({
      width: 640,
      baselineHeight: 205,
      padding: 40,
      titleFontSize: 24,
      titleLineHeight: 29,
      rowStartY: 93,
      columns: 6,
      cellWidth: 80,
      cellHeight: 72,
      columnGap: 16,
      rowGap: 24,
      barHeight: 24,
      labelGap: 8,
      detailGap: 2,
      labelFontSize: 10,
      labelLineHeight: 12,
      detailFontSize: 8,
      detailLineHeight: 10,
      cornerRadius: 8
    })
  })

  it('grows dynamically after each six tokens', () => {
    expect(spacingBoardHeight(0)).toBe(205)
    expect(spacingBoardHeight(6)).toBe(205)
    expect(spacingBoardHeight(7)).toBe(301)
    expect(spacingBoardHeight(13)).toBe(397)
  })

  it('shows the real value and compact evidence', () => {
    expect(spacingTokenLabel(token)).toBe('8px')
    expect(spacingTokenDetail(token)).toBe('P4 · G2\nM1 · S3')
  })
})
