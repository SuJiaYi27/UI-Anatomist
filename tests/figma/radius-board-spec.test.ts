import { describe, expect, it } from 'vitest'

import type { BorderRadiusToken } from '../../src/shared/schema'
import {
  RADIUS_BOARD_SPEC,
  radiusBoardHeight,
  radiusSampleValue,
  radiusTokenLabel
} from '../../src/figma/radius-board-spec'

const token = (kind: BorderRadiusToken['kind'], value: number | null): BorderRadiusToken => ({
  id: `sha256:${kind === 'px' ? '1' : kind === 'percent' ? '2' : '3'}`.padEnd(71, kind === 'px' ? '1' : kind === 'percent' ? '2' : '3'),
  name: kind === 'full' ? 'radius-full' : `radius-${value}`,
  kind,
  value,
  occurrences: 1
} as BorderRadiusToken)

describe('teacher-aligned border radii board', () => {
  it('keeps the measured teacher geometry and color constants', () => {
    expect(RADIUS_BOARD_SPEC).toEqual({
      width: 640,
      firstRowHeight: 209,
      padding: 40,
      columns: 8,
      sampleSize: 56,
      columnGap: 16,
      labelGap: 8,
      labelFontSize: 10,
      labelLineHeight: 12,
      rowGap: 24,
      rowHeight: 76,
      cornerRadius: 8,
      sampleFill: '#D9E5FF',
      sampleStroke: '#99B2E5'
    })
  })

  it('grows dynamically after eight tokens instead of assuming the teacher count', () => {
    expect(radiusBoardHeight(1)).toBe(209)
    expect(radiusBoardHeight(8)).toBe(209)
    expect(radiusBoardHeight(9)).toBe(309)
    expect(radiusBoardHeight(17)).toBe(409)
  })

  it('labels px, percentage, and full values without hiding their semantics', () => {
    expect(radiusTokenLabel(token('px', 10.5))).toBe('10.5px')
    expect(radiusTokenLabel(token('percent', 25))).toBe('25%')
    expect(radiusTokenLabel(token('full', null))).toBe('full')
    expect(radiusSampleValue(token('percent', 25))).toBe(14)
    expect(radiusSampleValue(token('full', null))).toBe(9999)
  })
})
