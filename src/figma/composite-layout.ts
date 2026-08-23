import type { CompositeToken } from '../shared/schema'

export type CompositeChildPlacement = NonNullable<
  CompositeToken['children'][number]['placement']
>

type Insets = { top: number; right: number; bottom: number; left: number }
type CompositeAlignment = 'start' | 'center' | 'end' | 'stretch'

export type CompositeLayoutPlan =
  | {
      mode: 'auto'
      direction: 'horizontal' | 'vertical'
      align: CompositeAlignment
      padding: Insets
      gap: number
      children: CompositeChildPlacement[]
    }
  | { mode: 'fixed'; children: CompositeChildPlacement[] }
  | { mode: 'legacy' }

const TOLERANCE = 2

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE
}

function half(value: number): number {
  return Math.round(Math.max(0, value) * 2) / 2
}

function detectedAlignment(
  token: CompositeToken,
  placements: CompositeChildPlacement[]
): CompositeAlignment | null {
  const vertical = token.layout.direction === 'vertical'
  const parentCross = vertical ? token.geometry.width : token.geometry.height
  const crossStart = vertical ? token.geometry.padding.left : token.geometry.padding.top
  const crossEnd = vertical ? token.geometry.padding.right : token.geometry.padding.bottom
  const innerCenter = (crossStart + parentCross - crossEnd) / 2
  const starts = placements.map(item => vertical ? item.x : item.y)
  const ends = placements.map(item =>
    vertical ? item.x + item.width : item.y + item.height
  )
  const centers = starts.map((start, index) => (start + ends[index]!) / 2)
  const startAligned = starts.every(value => close(value, crossStart))
  const endAligned = ends.every(value => close(parentCross - value, crossEnd))
  if (startAligned && endAligned) return 'stretch'
  if (centers.every(value => close(value, innerCenter))) return 'center'
  if (startAligned) return 'start'
  if (endAligned) return 'end'
  return null
}

export function planCompositeLayout(token: CompositeToken): CompositeLayoutPlan {
  const placements = token.children.map(child => child.placement)
  if (placements.some(placement => !placement)) return { mode: 'legacy' }
  const measured = placements as CompositeChildPlacement[]
  if (measured.length === 0 || token.layout.wrap) return { mode: 'legacy' }

  const vertical = token.layout.direction === 'vertical'
  const mainStart = (item: CompositeChildPlacement) => vertical ? item.y : item.x
  const mainSize = (item: CompositeChildPlacement) => vertical ? item.height : item.width
  const parentMain = vertical ? token.geometry.height : token.geometry.width
  const declaredStart = vertical
    ? token.geometry.padding.top
    : token.geometry.padding.left
  const declaredEnd = vertical
    ? token.geometry.padding.bottom
    : token.geometry.padding.right
  const gaps: number[] = []
  let monotonic = true
  for (let index = 1; index < measured.length; index += 1) {
    const previous = measured[index - 1]!
    const current = measured[index]!
    const gap = mainStart(current) - (mainStart(previous) + mainSize(previous))
    gaps.push(gap)
    if (gap < -TOLERANCE) monotonic = false
  }
  const regularGap = gaps.length === 0 ||
    Math.max(...gaps) - Math.min(...gaps) <= TOLERANCE
  const observedStart = mainStart(measured[0]!)
  const last = measured[measured.length - 1]!
  const observedEnd = parentMain - (mainStart(last) + mainSize(last))
  const paddingMatches = close(observedStart, declaredStart) &&
    close(observedEnd, declaredEnd)
  const align = detectedAlignment(token, measured)
  const spaceBetween = token.layout.justify === 'space-between'

  if (
    monotonic &&
    paddingMatches &&
    align &&
    (regularGap || spaceBetween)
  ) {
    return {
      mode: 'auto',
      direction: token.layout.direction,
      align,
      padding: {
        top: half(vertical ? observedStart : Math.min(...measured.map(item => item.y))),
        right: half(token.geometry.width - Math.max(...measured.map(item => item.x + item.width))),
        bottom: half(token.geometry.height - Math.max(...measured.map(item => item.y + item.height))),
        left: half(vertical ? Math.min(...measured.map(item => item.x)) : observedStart)
      },
      gap: half(spaceBetween ? token.geometry.gap : (gaps[0] ?? token.geometry.gap)),
      children: measured
    }
  }
  return { mode: 'fixed', children: measured }
}
