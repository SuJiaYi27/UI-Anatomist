import { describe, expect, it } from 'vitest'

import { BOARD_SAMPLE_TEXT, BOARD_SPEC, boardHeightForRows, styleSpecificationLabel } from '../../src/figma/board-spec'

describe('teacher-aligned typography board', () => {
  it('keeps the measured teacher layout constants', () => {
    expect(BOARD_SPEC).toEqual({
      width: 543,
      minHeight: 646,
      padding: 40,
      sectionGap: 24,
      rowGap: 24,
      infoWidth: 160,
      cornerRadius: 8
    })
    expect(BOARD_SAMPLE_TEXT).toBe('The quick brown fox')
  })

  it('stays at teacher height for nine rows and grows for larger imports', () => {
    expect(boardHeightForRows(9)).toBe(646)
    expect(boardHeightForRows(12)).toBeGreaterThan(646)
  })

  it('prints measurable typography values in plain language', () => {
    expect(styleSpecificationLabel({
      fontSizePx: 16,
      fontWeight: 400,
      lineHeightPx: null,
      letterSpacingPx: 0
    })).toBe('16px / 400 / Auto · 0px')
  })
})
