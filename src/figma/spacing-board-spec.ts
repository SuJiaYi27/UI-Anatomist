import type { SpacingToken } from '../shared/schema'

export const SPACING_BOARD_SPEC = {
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
} as const

export function spacingBoardHeight(tokenCount: number): number {
  const rows = Math.max(1, Math.ceil(tokenCount / SPACING_BOARD_SPEC.columns))
  return SPACING_BOARD_SPEC.baselineHeight + (rows - 1) * (
    SPACING_BOARD_SPEC.cellHeight + SPACING_BOARD_SPEC.rowGap
  )
}

export function spacingTokenLabel(token: SpacingToken): string {
  return `${token.value}px`
}

export function spacingTokenDetail(token: SpacingToken): string {
  const primary = [
    `P${token.evidence.padding}`,
    `G${token.evidence.gap}`
  ].join(' · ')
  const secondary = [
    `M${token.evidence.margin}`,
    `S${token.stateOccurrences}`
  ].join(' · ')
  return `${primary}\n${secondary}`
}
