import type { BorderRadiusToken } from '../shared/schema'

export const RADIUS_BOARD_SPEC = {
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
} as const

export function radiusBoardHeight(tokenCount: number): number {
  const rows = Math.max(1, Math.ceil(tokenCount / RADIUS_BOARD_SPEC.columns))
  return RADIUS_BOARD_SPEC.firstRowHeight + (rows - 1) * (
    RADIUS_BOARD_SPEC.rowHeight + RADIUS_BOARD_SPEC.rowGap
  )
}

export function radiusTokenLabel(token: BorderRadiusToken): string {
  if (token.kind === 'full') return 'full'
  if (token.kind === 'percent') return `${token.value}%`
  return `${token.value}px`
}

export function radiusSampleValue(token: BorderRadiusToken): number {
  if (token.kind === 'full') return 9999
  if (token.kind === 'percent') return RADIUS_BOARD_SPEC.sampleSize * token.value / 100
  return token.value
}
