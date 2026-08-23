import type { IconInteractionSurface } from '../../shared/schema'

type CornerRadii = IconInteractionSurface['radii']

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

function cssLength(raw: string, axisLength: number): number | null {
  const value = raw.trim()
  const px = value.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px$/i)
  if (px) return Math.max(0, normalizedNumber(Number.parseFloat(px[1]!)))
  const percent = value.match(/^(-?\d+(?:\.\d+)?)%$/)
  if (percent) {
    return Math.max(
      0,
      normalizedNumber(axisLength * Number.parseFloat(percent[1]!) / 100)
    )
  }
  if (value === '0') return 0
  return null
}

function cornerRadius(raw: string, width: number, height: number): number | null {
  const [horizontalRaw = '', verticalRaw] = raw.trim().split(/\s+/)
  const horizontal = cssLength(horizontalRaw, width)
  const vertical = cssLength(verticalRaw ?? horizontalRaw, height)
  if (horizontal === null || vertical === null) return null
  return normalizedNumber(Math.min(
    horizontal,
    vertical,
    Math.max(0, Math.min(width, height) / 2)
  ))
}

function expandFour(values: string[]): [string, string, string, string] | null {
  if (values.length === 1) return [values[0]!, values[0]!, values[0]!, values[0]!]
  if (values.length === 2) return [values[0]!, values[1]!, values[0]!, values[1]!]
  if (values.length === 3) return [values[0]!, values[1]!, values[2]!, values[1]!]
  if (values.length === 4) return [values[0]!, values[1]!, values[2]!, values[3]!]
  return null
}

function shorthandRadii(
  raw: string,
  width: number,
  height: number
): CornerRadii | null {
  const [horizontalRaw = '', verticalRaw] = raw.split('/').map(value => value.trim())
  const horizontal = expandFour(horizontalRaw.split(/\s+/).filter(Boolean))
  if (!horizontal) return null
  const vertical = verticalRaw
    ? expandFour(verticalRaw.split(/\s+/).filter(Boolean))
    : horizontal
  if (!vertical) return null
  const radii = horizontal.map((value, index) =>
    cornerRadius(`${value} ${vertical[index]!}`, width, height)
  )
  if (radii.some(value => value === null)) return null
  return {
    topLeft: radii[0]!,
    topRight: radii[1]!,
    bottomRight: radii[2]!,
    bottomLeft: radii[3]!
  }
}

export function exactControlRadii(
  style: CSSStyleDeclaration,
  width: number,
  height: number
): CornerRadii {
  const shorthand = shorthandRadii(style.borderRadius, width, height)
  if (shorthand) return shorthand
  return {
    topLeft: cornerRadius(style.borderTopLeftRadius, width, height) ?? 0,
    topRight: cornerRadius(style.borderTopRightRadius, width, height) ?? 0,
    bottomRight: cornerRadius(style.borderBottomRightRadius, width, height) ?? 0,
    bottomLeft: cornerRadius(style.borderBottomLeftRadius, width, height) ?? 0
  }
}
