import { parseCssColor } from './colors'

function opacityIsZero(value: string): boolean {
  const opacity = Number.parseFloat(value || '1')
  return Number.isFinite(opacity) && opacity === 0
}

function expandedInsetValues(values: string[]): [string, string, string, string] | null {
  if (values.length < 1 || values.length > 4) return null
  const [top, right = top, bottom = top, left = right] = values
  if (!top || !right || !bottom || !left) return null
  if (values.length === 3) return [top, right, bottom, right]
  return [top, right, bottom, left]
}

function insetPercentage(value: string): number | null {
  if (/^[+-]?0(?:\.0+)?(?:px|%)?$/.test(value)) return 0
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))%$/.exec(value)
  if (!match) return null
  const percentage = Number.parseFloat(match[1] ?? '')
  return Number.isFinite(percentage) ? percentage : null
}

function fullyClippedInset(clipPath: string): boolean {
  const match = /^inset\((.*)\)$/i.exec(clipPath.trim())
  if (!match) return false
  const insetPart = (match[1] ?? '').split(/\s+round\s+/i, 1)[0]?.trim() ?? ''
  const values = expandedInsetValues(insetPart.split(/\s+/).filter(Boolean))
  if (!values) return false
  const top = insetPercentage(values[0])
  const right = insetPercentage(values[1])
  const bottom = insetPercentage(values[2])
  const left = insetPercentage(values[3])
  return top !== null && bottom !== null && top + bottom >= 100 ||
    left !== null && right !== null && left + right >= 100
}

function fullyClipped(style: CSSStyleDeclaration): boolean {
  const normalizedClip = style.clip.replace(/\s+/g, '').toLowerCase()
  const clipPath = style.clipPath.trim().toLowerCase()
  const normalizedClipPath = clipPath.replace(/\s+/g, '')
  return /^(?:rect\((?:0(?:px)?[, ]*){4}\)|rect\(0(?:px)?[, ]0(?:px)?[, ]0(?:px)?[, ]0(?:px)?\))$/.test(normalizedClip) ||
    fullyClippedInset(clipPath) ||
    /^circle\(0(?:px|%)?(?:at[^)]*)?\)$/.test(normalizedClipPath) ||
    /^ellipse\(0(?:px|%)?0(?:px|%)?(?:at[^)]*)?\)$/.test(normalizedClipPath) ||
    /^polygon\((?:0(?:%|px)?0(?:%|px)?[, ]*){2,}\)$/.test(normalizedClipPath)
}

function positiveBounds(bounds: DOMRect): boolean {
  return bounds.width > 0 && bounds.height > 0
}

export function renderedRectIntersectsRoot(
  bounds: DOMRect,
  root: Element
): boolean {
  const rootBounds = root.getBoundingClientRect()
  if (!positiveBounds(bounds) || !positiveBounds(rootBounds)) return true
  return bounds.right > rootBounds.left &&
    bounds.left < rootBounds.right &&
    bounds.bottom > rootBounds.top &&
    bounds.top < rootBounds.bottom
}

function visibleGlyphPaint(style: CSSStyleDeclaration): boolean {
  const fill = style.getPropertyValue('-webkit-text-fill-color').trim()
  const fillColor = fill && fill !== 'currentcolor'
    ? parseCssColor(fill)
    : parseCssColor(style.color)
  if (!fillColor || fillColor.a > 0) return true

  const shadow = style.textShadow.trim().toLowerCase()
  if (shadow && shadow !== 'none') {
    const shadowColors = shadow.match(/(?:rgba?|hsla?|oklab|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/gi) ?? []
    if (shadowColors.some(value => {
      const parsed = parseCssColor(value)
      return parsed ? parsed.a > 0 : true
    })) return true
    const currentColor = parseCssColor(style.color)
    const keywordSource = shadow
      .replace(/(?:rgba?|hsla?|oklab|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/gi, ' ')
    const keywords = keywordSource.match(/\b[a-z][a-z-]*\b/gi) ?? []
    const nonColorKeywords = new Set([
      'px', 'em', 'rem', 'ex', 'ch', 'cap', 'ic', 'lh', 'rlh',
      'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'cm', 'mm', 'q', 'in', 'pt', 'pc'
    ])
    if (keywords.some(keyword => {
      if (nonColorKeywords.has(keyword)) return false
      if (keyword === 'currentcolor') return Boolean(currentColor && currentColor.a > 0)
      const parsed = parseCssColor(keyword)
      if (parsed) return parsed.a > 0
      // A computed text-shadow can only leave a bare non-global word here as
      // a CSS named color. Browsers normally serialize it to rgb(); JSDOM
      // preserves the authored keyword, so treat that valid paint as opaque.
      return keyword !== 'none' && keyword !== 'transparent'
    })) return true
    if (!shadowColors.length && !keywords.length) {
      return Boolean(currentColor && currentColor.a > 0)
    }
  }

  const strokeWidth = Number.parseFloat(
    style.getPropertyValue('-webkit-text-stroke-width') || '0'
  )
  const strokeColor = parseCssColor(
    style.getPropertyValue('-webkit-text-stroke-color') || style.color
  )
  if (strokeWidth > 0 && (!strokeColor || strokeColor.a > 0)) return true

  const backgroundClip = style.getPropertyValue('background-clip').toLowerCase()
  const webkitBackgroundClip = style.getPropertyValue('-webkit-background-clip').toLowerCase()
  if (backgroundClip.includes('text') || webkitBackgroundClip.includes('text')) {
    const background = parseCssColor(style.backgroundColor)
    return style.backgroundImage !== 'none' || Boolean(background && background.a > 0)
  }
  return false
}

/**
 * Returns whether an element contributes a rendered box to the page.
 *
 * Accessibility metadata such as `aria-hidden` and presentational roles does
 * not affect pixels, so it is intentionally absent here. Interaction and copy
 * eligibility remain separate decisions in their existing callers.
 */
export function isRenderedVisualElement(
  element: Element,
  view: Window
): boolean {
  if (
    !element.isConnected ||
    element.closest(
      'script,style,noscript,template,[hidden],[data-smart-scan-overlay="true"]'
    )
  ) return false
  const elementStyle = view.getComputedStyle(element)
  if (elementStyle.visibility === 'hidden') return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' ||
      opacityIsZero(style.opacity) ||
      fullyClipped(style)
    ) return false
  }
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0
}

function hasVisuallyHiddenTextStyle(
  element: Element,
  view: Window
): boolean {
  const style = view.getComputedStyle(element)
  const bounds = element.getBoundingClientRect()
  const collapsedAbsoluteText =
    style.position === 'absolute' &&
    bounds.width <= 2 &&
    bounds.height <= 2 &&
    ['clip', 'hidden'].includes(style.overflow)
  return fullyClipped(style) || collapsedAbsoluteText
}

/**
 * Text can stay in the accessibility tree while its CSS removes it from the
 * visual canvas. Walk from the text container to the requested root so a
 * clipped wrapper is honored even when the direct text span has normal style.
 */
export function isRenderedVisualTextContainer(
  element: Element,
  view: Window,
  root: Element = element
): boolean {
  if (
    !element.isConnected ||
    element.closest('script,style,noscript,template,[hidden]')
  ) return false
  const elementStyle = view.getComputedStyle(element)
  if (
    elementStyle.visibility === 'hidden' ||
    Number.parseFloat(elementStyle.fontSize || '0') === 0 ||
    !visibleGlyphPaint(elementStyle) ||
    !renderedRectIntersectsRoot(element.getBoundingClientRect(), root)
  ) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' ||
      opacityIsZero(style.opacity)
    ) return false
    if (hasVisuallyHiddenTextStyle(current, view)) return false
    if (current === root) break
    if (!root.contains(current)) return false
  }
  return true
}
