import { isWebsiteAppliedContentPresentation } from './content-payload'

const visualAssetSelector = 'img,svg,picture,video,canvas,[role="img"]'
const rasterAssetSelector = 'img,picture,video,canvas'
const interactiveSelector = [
  'button', 'input', 'textarea', 'select', 'a[href]',
  '[role="button"]', '[role="tab"]', '[role="option"]', '[role="checkbox"]',
  '[role="radio"]', '[role="switch"]'
].join(',')
const svgControlSelector = [
  'button', 'input', '[role="button"]', '[role="tab"]', '[role="option"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]'
].join(',')

function normalizedMarker(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function hasAssetMarker(value: string, includeIcon: boolean): boolean {
  const terms = includeIcon ? 'logo|brand|avatar|icon' : 'logo|brand|avatar'
  return new RegExp(`(^|[\\s_-])(${terms})(?=$|[\\s_-])`).test(normalizedMarker(value))
}

function isInteractive(element: Element): boolean {
  return element.matches(interactiveSelector)
}

function validBounds(element: Element): DOMRect | null {
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0 ? bounds : null
}

function compactWrapperBounds(element: Element): DOMRect | null {
  const bounds = validBounds(element)
  if (!bounds) return null
  const longSide = Math.max(bounds.width, bounds.height)
  const shortSide = Math.min(bounds.width, bounds.height)
  if (longSide > 192 || longSide / shortSide > 4) return null
  return bounds
}

function occupiesWrapper(asset: Element, wrapper: DOMRect): boolean {
  const assetBounds = validBounds(asset)
  if (!assetBounds) return false
  const widthRatio = Math.min(assetBounds.width / wrapper.width, 1)
  const heightRatio = Math.min(assetBounds.height / wrapper.height, 1)
  return widthRatio * heightRatio >= 0.15 || (widthRatio >= 0.35 && heightRatio >= 0.35)
}

function descendantAssets(element: Element, selector: string): Element[] {
  return Array.from(element.querySelectorAll(selector))
}

function containsOccupyingAsset(element: Element, selector: string, wrapper: DOMRect): boolean {
  return descendantAssets(element, selector).some(asset => occupiesWrapper(asset, wrapper))
}

export function isExcludedVisualAsset(element: Element): boolean {
  if (element.closest(visualAssetSelector)) return true

  for (let current: Element | null = element; current; current = current.parentElement) {
    const marker = `${current.getAttribute('id') ?? ''} ${current.getAttribute('class') ?? ''}`
    if (hasAssetMarker(marker, false)) return true
    if (!isInteractive(current) && hasAssetMarker(marker, true)) return true
  }

  const wrapper = compactWrapperBounds(element)
  if (!wrapper) return false

  // Image layout can temporarily report 0×0 while its compact shell already has
  // rendered colors or shadows. The shell is still an asset surface, so waiting
  // for the descendant bounds would make scans depend on image loading timing.
  if (descendantAssets(element, rasterAssetSelector).length > 0) return true

  const protectedSvgControl = element.matches(svgControlSelector)
  if (!protectedSvgControl && containsOccupyingAsset(element, '[role="img"]', wrapper)) return true
  return !isInteractive(element) && containsOccupyingAsset(element, 'svg', wrapper)
}

/**
 * Style collectors work at the property layer rather than excluding an
 * author-content region wholesale. A site's non-graphic presentation shell
 * remains eligible even when it wraps a user supplied image/SVG; the payload
 * node itself is still excluded by isExcludedVisualAsset().
 */
export function isExcludedStyleAssetSurface(element: Element): boolean {
  if (isWebsiteAppliedContentPresentation(element)) return false
  return isExcludedVisualAsset(element)
}
