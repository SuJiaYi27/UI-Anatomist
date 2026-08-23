import type { ColorValue, ShadowToken } from '../shared/schema'

export const SHADOW_BOARD_SPEC = {
  width: 1513,
  baselineHeight: 213,
  padding: 40,
  titleFontSize: 24,
  titleLineHeight: 29,
  rowStartY: 93,
  rowGap: 24,
  cellGap: 24,
  sampleWidth: 80,
  sampleHeight: 60,
  labelGap: 8,
  labelFontSize: 10,
  labelLineHeight: 12,
  cornerRadius: 8
} as const

export type ShadowCellMeasurement = {
  labelWidth: number
  labelHeight?: number
}

export type ShadowVisualInsets = {
  left: number
  top: number
  right: number
  bottom: number
}

export type ShadowCellLayout = {
  x: number
  y: number
  width: number
  height: number
  sampleX: number
  sampleY: number
  labelY: number
}

export type ShadowBoardLayout = {
  cells: ShadowCellLayout[]
  rows: number
  boardHeight: number
}

const ZERO_VISUAL_INSETS: ShadowVisualInsets = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0
}

export function shadowVisualInsets(token: ShadowToken): ShadowVisualInsets {
  const insets = { ...ZERO_VISUAL_INSETS }
  for (const layer of token.layers) {
    if (layer.kind !== 'outer' || layer.color.a <= 0) continue
    // Negative spread can reduce a shadow but must never make the visual
    // safety estimate smaller than the offset itself.
    const outwardRadius = Math.max(0, layer.blur) + Math.max(0, layer.spread)
    insets.left = Math.max(
      insets.left,
      Math.max(0, outwardRadius - layer.offsetX)
    )
    insets.top = Math.max(
      insets.top,
      Math.max(0, outwardRadius - layer.offsetY)
    )
    insets.right = Math.max(
      insets.right,
      Math.max(0, outwardRadius + layer.offsetX)
    )
    insets.bottom = Math.max(
      insets.bottom,
      Math.max(0, outwardRadius + layer.offsetY)
    )
  }
  return insets
}

function measuredCellWidth(measurement: ShadowCellMeasurement): number {
  const availableWidth = SHADOW_BOARD_SPEC.width - SHADOW_BOARD_SPEC.padding * 2
  return Math.min(
    availableWidth,
    Math.max(SHADOW_BOARD_SPEC.sampleWidth, measurement.labelWidth)
  )
}

function measuredCellHeight(measurement: ShadowCellMeasurement): number {
  return SHADOW_BOARD_SPEC.sampleHeight +
    SHADOW_BOARD_SPEC.labelGap +
    (measurement.labelHeight ?? SHADOW_BOARD_SPEC.labelLineHeight)
}

export function layoutShadowCells(
  measurements: ShadowCellMeasurement[]
): ShadowBoardLayout {
  if (measurements.length === 0) {
    return { cells: [], rows: 0, boardHeight: SHADOW_BOARD_SPEC.baselineHeight }
  }

  const rightEdge = SHADOW_BOARD_SPEC.width - SHADOW_BOARD_SPEC.padding
  const cells: ShadowCellLayout[] = []
  let x = SHADOW_BOARD_SPEC.padding
  let y = SHADOW_BOARD_SPEC.rowStartY
  let rowHeight = 0
  let rows = 1

  for (const measurement of measurements) {
    const width = measuredCellWidth(measurement)
    const height = measuredCellHeight(measurement)

    if (x > SHADOW_BOARD_SPEC.padding && x + width > rightEdge) {
      x = SHADOW_BOARD_SPEC.padding
      y += rowHeight + SHADOW_BOARD_SPEC.rowGap
      rowHeight = 0
      rows += 1
    }

    cells.push({
      x,
      y,
      width,
      height,
      sampleX: (width - SHADOW_BOARD_SPEC.sampleWidth) / 2,
      sampleY: 0,
      labelY: SHADOW_BOARD_SPEC.sampleHeight + SHADOW_BOARD_SPEC.labelGap
    })
    x += width + SHADOW_BOARD_SPEC.cellGap
    rowHeight = Math.max(rowHeight, height)
  }

  return {
    cells,
    rows,
    boardHeight: Math.max(
      SHADOW_BOARD_SPEC.baselineHeight,
      y + rowHeight + SHADOW_BOARD_SPEC.padding
    )
  }
}

export function shadowTokenLabel(token: ShadowToken): string {
  const kinds = new Set(token.layers.map(layer => layer.kind))
  const category = kinds.size > 1
    ? '混合阴影'
    : kinds.has('inner') ? '内阴影' : '外阴影'
  const details = token.layers.map((layer, index) => {
    const number = (value: number): string => {
      const normalized = Object.is(value, -0) ? 0 : Number(value.toFixed(3))
      return String(normalized)
    }
    return `${index + 1}:${number(layer.offsetX)}/${number(layer.offsetY)}/${number(layer.blur)}/${number(layer.spread)}/a${number(layer.color.a)}`
  })
  return `${token.name}\n完整 token · ${category} · ${token.layers.length} 层叠加 · ${details.join(' · ')}`
}

export function shadowSpecimenFill(token: ShadowToken): ColorValue {
  return token.layers.some(layer => layer.kind === 'inner')
    ? { r: 0.94, g: 0.95, b: 0.97, a: 1 }
    : { r: 1, g: 1, b: 1, a: 1 }
}
