import type { ColorValue, IconInteractionSurface } from '../../shared/schema'
import { parseCssColor } from './colors'
import { exactControlRadii } from './control-surface'

const ICON_CONTROL_SELECTOR =
  'button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],a[href]'

export type PaintedIconSurface = {
  element: Element
  source: 'element' | 'before' | 'after'
  bounds: {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }
  background: ColorValue
  width: number
  height: number
  radii: IconInteractionSurface['radii']
}

export type PaintedIconSurfaceOptions = {
  accept?: (surface: PaintedIconSurface) => boolean
}

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

function visible(element: Element, view: Window): boolean {
  if (element.closest('[hidden]')) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') === 0
    ) return false
  }
  return true
}

function containsBounds(outer: DOMRect, inner: DOMRect): boolean {
  const tolerance = 0.5
  return inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
}

function elementSurface(
  element: Element,
  graphicBounds: DOMRect,
  view: Window
): PaintedIconSurface | null {
  if (!visible(element, view)) return null
  const bounds = element.getBoundingClientRect()
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !containsBounds(bounds, graphicBounds)
  ) return null
  const style = view.getComputedStyle(element)
  const background = parseCssColor(style.backgroundColor)
  if (!background || background.a <= 0) return null
  return {
    element,
    source: 'element',
    bounds: {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height
    },
    background,
    width: normalizedNumber(bounds.width),
    height: normalizedNumber(bounds.height),
    radii: exactControlRadii(style, bounds.width, bounds.height)
  }
}

function pixelValue(value: string | null | undefined): number | null {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec((value ?? '').trim())
  if (!match) return null
  const parsed = Number.parseFloat(match[1] ?? '')
  return Number.isFinite(parsed) ? parsed : null
}

function pseudoSurface(
  element: Element,
  pseudo: '::before' | '::after',
  graphicBounds: DOMRect,
  view: Window
): PaintedIconSurface | null {
  const style = view.getComputedStyle(element, pseudo)
  if (
    style.content === 'none' ||
    style.content === 'normal' ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number.parseFloat(style.opacity || '1') === 0
  ) return null
  const background = parseCssColor(style.backgroundColor)
  if (!background || background.a <= 0) return null

  const hostBounds = element.getBoundingClientRect()
  const left = pixelValue(style.left)
  const right = pixelValue(style.right)
  const top = pixelValue(style.top)
  const bottom = pixelValue(style.bottom)
  const declaredWidth = pixelValue(style.width)
  const declaredHeight = pixelValue(style.height)
  const width = declaredWidth ?? (
    left !== null && right !== null ? hostBounds.width - left - right : hostBounds.width
  )
  const height = declaredHeight ?? (
    top !== null && bottom !== null ? hostBounds.height - top - bottom : hostBounds.height
  )
  if (width <= 0 || height <= 0) return null
  const x = hostBounds.left + (
    left ??
    (right !== null ? hostBounds.width - right - width : (hostBounds.width - width) / 2)
  )
  const y = hostBounds.top + (
    top ??
    (bottom !== null ? hostBounds.height - bottom - height : (hostBounds.height - height) / 2)
  )
  const bounds = {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height
  } as DOMRect
  if (!containsBounds(bounds, graphicBounds)) return null

  return {
    element,
    source: pseudo === '::before' ? 'before' : 'after',
    bounds: {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width,
      height
    },
    background,
    width: normalizedNumber(width),
    height: normalizedNumber(height),
    radii: exactControlRadii(style, width, height)
  }
}

/**
 * Returns the nearest rendered paint layer around an icon. The choice is based
 * only on current computed geometry and paint, so a forced Hover state naturally
 * selects the inner layer that actually acquired the Hover background.
 */
export function findPaintedIconSurface(
  graphic: Element,
  view: Window,
  options: PaintedIconSurfaceOptions = {}
): PaintedIconSurface | null {
  const control = graphic.closest<HTMLElement>(ICON_CONTROL_SELECTOR)
  if (!control) return null
  const graphicBounds = graphic.getBoundingClientRect()
  if (graphicBounds.width <= 0 || graphicBounds.height <= 0) return null

  const surfaceElements = new Set<Element>()
  // A graphic host can itself carry the painted surface (for example an SVG
  // with a circular background). Keep it in the same bounded candidate walk
  // as its wrappers; the caller still applies the ownership/security filter.
  surfaceElements.add(graphic)
  for (
    let current = graphic.parentElement;
    current;
    current = current === control ? null : current.parentElement
  ) {
    if (!control.contains(current) && current !== control) break
    surfaceElements.add(current)
    if (current === control) break
  }
  for (const descendant of Array.from(control.querySelectorAll('*')).slice(0, 64)) {
    if (
      descendant.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
      descendant !== graphic
    ) surfaceElements.add(descendant as HTMLElement)
  }
  const wrapper = control.parentElement
  if (
    wrapper &&
    wrapper !== control.ownerDocument.body &&
    wrapper !== control.ownerDocument.documentElement
  ) {
    surfaceElements.add(wrapper)
    for (const descendant of Array.from(wrapper.querySelectorAll('*')).slice(0, 64)) {
      if (
        descendant.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
        descendant !== graphic
      ) surfaceElements.add(descendant as HTMLElement)
    }
  }

  const candidates: PaintedIconSurface[] = []
  for (const current of surfaceElements) {
    const surface = elementSurface(current, graphicBounds, view)
    if (surface) candidates.push(surface)
    const before = pseudoSurface(current, '::before', graphicBounds, view)
    if (before) candidates.push(before)
    const after = pseudoSurface(current, '::after', graphicBounds, view)
    if (after) candidates.push(after)
  }

  return candidates
    .filter(surface => options.accept?.(surface) ?? true)
    .sort((left, right) =>
    left.width * left.height - right.width * right.height ||
    left.width - right.width ||
    left.height - right.height
    )[0] ?? null
}
