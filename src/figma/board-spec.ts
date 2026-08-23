export const BOARD_SPEC = {
  width: 543,
  minHeight: 646,
  padding: 40,
  sectionGap: 24,
  rowGap: 24,
  infoWidth: 160,
  cornerRadius: 8
} as const

export const BOARD_SAMPLE_TEXT = 'The quick brown fox'

export function boardHeightForRows(rowCount: number): number {
  return BOARD_SPEC.minHeight + Math.max(0, rowCount - 9) * 58
}

export function styleSpecificationLabel(value: {
  fontSizePx: number
  fontWeight: number
  lineHeightPx: number | null
  letterSpacingPx: number
}): string {
  const lineHeight = value.lineHeightPx === null ? 'Auto' : `${value.lineHeightPx}px`
  return `${value.fontSizePx}px / ${value.fontWeight} / ${lineHeight} · ${value.letterSpacingPx}px`
}
