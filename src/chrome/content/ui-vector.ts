import {
  isRenderedVisualElement,
  isRenderedVisualTextContainer
} from './rendered-visual'

export type SanitizedUiVector = {
  vectorSvg: string
  viewBox: { minX: number; minY: number; width: number; height: number }
}

export type UiVectorOptions = {
  allowCurrentColorFill?: boolean
  allowResolvedCurrentColorFill?: boolean
  maximumLength?: number
}

const SHAPE_SELECTOR = 'path,line,polyline,polygon,circle,rect,ellipse'
const GRAPHIC_SELECTOR = 'svg,img,picture,canvas,[role="img"]'
const IDENTITY_ROW_SELECTOR = [
  'a[href]',
  'button',
  '[role="button"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[tabindex="0"]'
].join(',')
const spriteVectorCache = new Map<string, Promise<SanitizedUiVector | null>>()

function finite(raw: string | null | undefined): number | null {
  const value = Number.parseFloat(raw ?? '')
  return Number.isFinite(value) ? value : null
}

function viewBoxFor(element: Element): SanitizedUiVector['viewBox'] | null {
  const raw = element.getAttribute('viewBox')?.trim()
  if (raw) {
    const values = raw.split(/[\s,]+/).map(Number)
    if (
      values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2]! > 0 &&
      values[3]! > 0
    ) {
      return {
        minX: values[0]!,
        minY: values[1]!,
        width: values[2]!,
        height: values[3]!
      }
    }
  }
  const width = finite(element.getAttribute('width'))
  const height = finite(element.getAttribute('height'))
  if (width && height && width > 0 && height > 0) {
    return { minX: 0, minY: 0, width, height }
  }
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0
    ? { minX: 0, minY: 0, width: bounds.width, height: bounds.height }
    : null
}

function allowedColor(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'none' ||
    normalized === 'currentcolor' ||
    /^url\(\s*#[^)]+\s*\)$/.test(normalized)
}

function normalizedResolvableSolidPaint(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '')
  if (
    normalized === 'black' ||
    normalized === 'white' ||
    /^#[0-9a-f]{3,8}$/.test(normalized) ||
    /^(?:rgb|rgba|hsl|hsla)\([^)]+\)$/.test(normalized)
  ) return normalized
  return null
}

function resolvedMonochromePaint(
  colors: string[],
  options: UiVectorOptions
): string | null {
  if (!options.allowResolvedCurrentColorFill) return null
  const explicit = colors
    .filter(value => !allowedColor(value))
    .map(normalizedResolvableSolidPaint)
  if (
    explicit.length === 0 ||
    explicit.some(value => value === null)
  ) return null
  const unique = new Set(explicit)
  return unique.size === 1 ? explicit[0]! : null
}

function replaceResolvedMonochromePaint(
  clone: SVGElement,
  resolvedPaint: string
): void {
  for (const node of [clone, ...Array.from(clone.querySelectorAll(SHAPE_SELECTOR))]) {
    for (const attribute of ['fill', 'stroke'] as const) {
      const value = node.getAttribute(attribute)
      if (
        value &&
        normalizedResolvableSolidPaint(value) === resolvedPaint
      ) {
        node.setAttribute(attribute, 'currentColor')
      }
    }
  }
}

function computedPaint(value: string): 'none' | 'currentColor' | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'none' || normalized === 'transparent') return 'none'
  if (
    normalized === 'currentcolor' ||
    normalized.startsWith('rgb(') ||
    normalized.startsWith('rgba(') ||
    normalized.startsWith('hsl(') ||
    normalized.startsWith('hsla(') ||
    normalized.startsWith('#')
  ) return 'currentColor'
  return null
}

function materializeComputedPresentation(
  source: Element,
  clone: SVGElement,
  view: Window
): void {
  const sourceShapes = Array.from(source.querySelectorAll(SHAPE_SELECTOR))
  const clonedShapes = Array.from(clone.querySelectorAll(SHAPE_SELECTOR))
  for (const [index, sourceShape] of sourceShapes.entries()) {
    const clonedShape = clonedShapes[index]
    if (!clonedShape) continue
    const style = view.getComputedStyle(sourceShape)
    const fill = computedPaint(style.fill)
    const stroke = computedPaint(style.stroke)
    const hasStrokeGeometry = [
      'stroke-width', 'stroke-linecap', 'stroke-linejoin'
    ].some(attribute => sourceShape.hasAttribute(attribute))
    const hasStrokeIntent =
      sourceShape.hasAttribute('stroke') ||
      hasStrokeGeometry ||
      Boolean((sourceShape as HTMLElement).style?.stroke) ||
      fill === 'none'
    if (
      !sourceShape.hasAttribute('fill') &&
      (fill === 'none' || hasStrokeIntent)
    ) {
      clonedShape.setAttribute('fill', 'none')
    }
    if (
      !sourceShape.hasAttribute('stroke') &&
      hasStrokeIntent &&
      ((stroke && stroke !== 'none') || hasStrokeGeometry)
    ) {
      clonedShape.setAttribute('stroke', 'currentColor')
    }
    const effectiveStroke = clonedShape.getAttribute('stroke')
    if (effectiveStroke && effectiveStroke !== 'none') {
      const strokeWidth = finite(style.strokeWidth)
      if (strokeWidth !== null && !sourceShape.hasAttribute('stroke-width')) {
        clonedShape.setAttribute('stroke-width', String(strokeWidth))
      }
      if (
        !sourceShape.hasAttribute('stroke-linecap') &&
        ['butt', 'round', 'square'].includes(style.strokeLinecap)
      ) {
        clonedShape.setAttribute('stroke-linecap', style.strokeLinecap)
      }
      if (
        !sourceShape.hasAttribute('stroke-linejoin') &&
        ['miter', 'round', 'bevel'].includes(style.strokeLinejoin)
      ) {
        clonedShape.setAttribute('stroke-linejoin', style.strokeLinejoin)
      }
    }
    if (
      !sourceShape.hasAttribute('fill-rule') &&
      ['nonzero', 'evenodd'].includes(style.fillRule)
    ) {
      clonedShape.setAttribute('fill-rule', style.fillRule)
    }
    const opacity = Number.parseFloat(style.opacity)
    if (Number.isFinite(opacity) && opacity >= 0 && opacity < 1) {
      clonedShape.setAttribute('opacity', String(opacity))
    }
  }
}

function sanitizeStandaloneSvg(
  element: Element,
  options: UiVectorOptions = {},
  view?: Window
): SanitizedUiVector | null {
  if (element.tagName.toLowerCase() !== 'svg') return null
  const raw = (element as SVGElement).outerHTML
  if (
    /<(?:script|style|image|foreignObject|text|linearGradient|radialGradient)\b/i.test(raw) ||
    /\bon[a-z]+\s*=/i.test(raw) ||
    /\b(?:href|xlink:href)\s*=\s*[\"'](?!#)/i.test(raw)
  ) return null
  const shapes = Array.from(element.querySelectorAll(SHAPE_SELECTOR))
  if (shapes.length === 0 || shapes.length > 32) return null
  const colors = [
    element.getAttribute('fill'),
    element.getAttribute('stroke'),
    ...shapes.flatMap(shape => [shape.getAttribute('fill'), shape.getAttribute('stroke')])
  ].filter((value): value is string => Boolean(value))
  const resolvedPaint = resolvedMonochromePaint(colors, options)
  if (colors.some(value => !allowedColor(value)) && !resolvedPaint) return null
  const currentColorStroke = [
    element.getAttribute('stroke'),
    ...shapes.map(shape => shape.getAttribute('stroke'))
  ].some(value => value?.toLowerCase() === 'currentcolor')
  const currentColorFill = [
    element.getAttribute('fill'),
    ...shapes.map(shape => shape.getAttribute('fill'))
  ].some(value => value?.toLowerCase() === 'currentcolor')
  if (
    colors.length > 0 &&
    !currentColorStroke &&
    !(options.allowCurrentColorFill && currentColorFill) &&
    !resolvedPaint
  ) return null

  const parsedViewBox = viewBoxFor(element)
  if (!parsedViewBox) return null
  const clone = element.cloneNode(true) as SVGElement
  const allowedTags = new Set([
    'svg', 'g', 'defs', 'clippath', 'mask',
    'path', 'line', 'polyline', 'polygon', 'circle', 'rect', 'ellipse'
  ])
  const allowedAttributes = new Set([
    'viewBox', 'preserveAspectRatio', 'fill', 'stroke', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule',
    'clip-rule', 'clip-path', 'mask', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
    'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'opacity', 'id'
  ])
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    if (!allowedTags.has(node.tagName.toLowerCase())) {
      node.remove()
      continue
    }
    for (const attribute of Array.from(node.attributes)) {
      if (!allowedAttributes.has(attribute.name)) node.removeAttribute(attribute.name)
    }
  }
  if (resolvedPaint) replaceResolvedMonochromePaint(clone, resolvedPaint)
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.removeAttribute('id')
  clone.setAttribute(
    'viewBox',
    `${parsedViewBox.minX} ${parsedViewBox.minY} ${parsedViewBox.width} ${parsedViewBox.height}`
  )
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (view) materializeComputedPresentation(element, clone, view)
  const serialized = clone.outerHTML
    .replace(/currentcolor/gi, 'currentColor')
    .replace(/>\s+</g, '><')
    .trim()
  return serialized.length <= (options.maximumLength ?? 65_536)
    ? { vectorSvg: serialized, viewBox: parsedViewBox }
    : null
}

export function isLikelyBrandGraphic(element: Element): boolean {
  const explicitAssetAncestor = element.closest(
    '[id*="logo" i],[class*="logo" i],[data-testid*="logo" i],[aria-label*="logo" i]'
  )
  const marker = [
    element.getAttribute('id'),
    element.getAttribute('class'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.closest('[data-testid]')?.getAttribute('data-testid'),
    explicitAssetAncestor?.getAttribute('id'),
    explicitAssetAncestor?.getAttribute('class'),
    explicitAssetAncestor?.getAttribute('data-testid'),
    explicitAssetAncestor?.getAttribute('aria-label')
  ].filter(Boolean).join(' ')
  const words = marker
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
  if (
    /(?:^|\s)(?:brand|logo|avatar|logomark|wordmark|brandmark)(?=\s|$)/i
      .test(words)
  ) return true
  const tokens = words.toLowerCase().split(/\s+/).filter(Boolean)
  const genericMarkSuffixes = new Set([
    'icon', 'symbol', 'outline', 'filled', 'solid', 'small', 'large'
  ])
  return tokens.some((word, index) =>
    word === 'mark' &&
    Boolean(tokens[index + 1]) &&
    !genericMarkSuffixes.has(tokens[index + 1]!)
  )
}

/**
 * Quarantines authored wordmarks without relying on company or product names.
 * A wide, compact graphic with its own accessible title is an asset rather
 * than a reusable interface glyph, even when the surrounding card is a link.
 */
export function isLikelyTitledWordmarkGraphic(
  element: Element,
  view: Window
): boolean {
  if (!element.matches(GRAPHIC_SELECTOR) || !renderedForIdentity(element, view)) {
    return false
  }
  const bounds = element.getBoundingClientRect()
  if (
    bounds.width < 48 ||
    bounds.height <= 0 ||
    bounds.height > 64 ||
    bounds.width / bounds.height < 2
  ) return false
  const title = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('alt'),
    element.querySelector(':scope > title')?.textContent
  ].find(value => Boolean(value?.trim()))
  return Boolean(title)
}

function renderedForIdentity(element: Element, view: Window): boolean {
  return isRenderedVisualElement(element, view)
}

function hasRenderedNonGraphicText(element: Element, view: Window): boolean {
  const visit = (node: Node): boolean => {
    if (node.nodeType === 3) {
      const parent = node.parentElement
      return Boolean(
        node.textContent?.trim() &&
        parent &&
        renderedForIdentity(parent, view) &&
        isRenderedVisualTextContainer(parent, view, element)
      )
    }
    if (node.nodeType !== 1) return false
    const child = node as Element
    if (
      child !== element &&
      (
        child.matches(GRAPHIC_SELECTOR) ||
        !renderedForIdentity(child, view)
      )
    ) return false
    return Array.from(child.childNodes).some(visit)
  }
  return Array.from(element.childNodes).some(visit)
}

function graphicOnlyLink(link: HTMLAnchorElement, view: Window): boolean {
  if (!renderedForIdentity(link, view)) return false
  const graphics = Array.from(link.querySelectorAll(GRAPHIC_SELECTOR))
    .filter(graphic => renderedForIdentity(graphic, view))
  return graphics.length > 0 && !hasRenderedNonGraphicText(link, view)
}

function isCrossOriginLink(link: HTMLAnchorElement): boolean {
  try {
    return new URL(
      link.getAttribute('href') ?? '',
      link.ownerDocument.location.href
    ).origin !== link.ownerDocument.location.origin
  } catch {
    return false
  }
}

/**
 * Detects footer/social-style brand groups without using site, company or
 * network names. A group is brand-like when it contains at least three
 * rendered, graphic-only external links. A same-origin graphic-only link in
 * that same compact group is also quarantined because it is commonly the
 * owning organization's mark.
 */
export function isLikelyGraphicOnlyBrandCluster(
  element: Element,
  view: Window
): boolean {
  if (!element.matches(GRAPHIC_SELECTOR) || !renderedForIdentity(element, view)) {
    return false
  }
  const link = element.closest<HTMLAnchorElement>('a[href]')
  if (!link || !graphicOnlyLink(link, view)) return false

  let ancestor = link.parentElement
  for (let depth = 0; ancestor && depth < 6; depth += 1) {
    if (
      ancestor === element.ownerDocument.body ||
      ancestor === element.ownerDocument.documentElement
    ) break
    const links = Array.from(ancestor.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter(candidate => graphicOnlyLink(candidate, view))
    if (
      links.includes(link) &&
      links.length >= 3 &&
      links.filter(isCrossOriginLink).length >= 3
    ) return true
    ancestor = ancestor.parentElement
  }
  return false
}

function hasDirectRenderedText(element: Element): boolean {
  return Array.from(element.childNodes).some(node =>
    node.nodeType === 3 && Boolean(node.textContent?.trim())
  )
}

function normalizedIdentityWords(element: Element): string[] {
  return (element.textContent ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function supportingRepeatsPrimary(
  primary: Element,
  supporting: Element
): boolean {
  const primaryWords = normalizedIdentityWords(primary)
  const supportingWords = normalizedIdentityWords(supporting)
  if (
    primaryWords.length === 0 ||
    primaryWords.length > 6 ||
    primaryWords.join(' ').length > 32 ||
    supportingWords.length < primaryWords.length
  ) return false
  for (
    let index = 0;
    index <= supportingWords.length - primaryWords.length;
    index += 1
  ) {
    if (
      primaryWords.every((word, offset) =>
        supportingWords[index + offset] === word
      )
    ) return true
  }
  return false
}

function belongsToIdentityRow(element: Element, row: Element): boolean {
  const nestedInteractive = element.closest(IDENTITY_ROW_SELECTOR)
  return nestedInteractive === row || (
    nestedInteractive === null &&
    row.contains(element)
  )
}

function pointerBackedMenuRow(
  element: Element,
  view: Window
): Element | null {
  let candidate = element.parentElement
  for (let depth = 0; candidate && depth < 6; depth += 1) {
    if (
      candidate.matches('div,li') &&
      candidate.closest('[role="menu"]') !== null &&
      candidate.getAttribute('role') !== 'menu' &&
      view.getComputedStyle(candidate).cursor === 'pointer' &&
      renderedForIdentity(candidate, view)
    ) {
      const bounds = candidate.getBoundingClientRect()
      if (
        bounds.width >= 120 &&
        bounds.height >= 24 &&
        bounds.height <= 80
      ) return candidate
    }
    candidate = candidate.parentElement
  }
  return null
}

function identityRowsFor(element: Element, view: Window): Element[] {
  const rows: Element[] = []
  let ancestor = element.parentElement
  for (let depth = 0; ancestor && depth < 7; depth += 1) {
    if (
      ancestor.matches(IDENTITY_ROW_SELECTOR) &&
      renderedForIdentity(ancestor, view)
    ) rows.push(ancestor)
    ancestor = ancestor.parentElement
  }
  const pointerRow = pointerBackedMenuRow(element, view)
  if (pointerRow && !rows.includes(pointerRow)) rows.push(pointerRow)
  return rows
}

/**
 * Detects a leading identity/brand-like graphic from generic component anatomy.
 *
 * This deliberately ignores paint, names, sites and geometry hashes. A graphic
 * is identity-like only when it leads an interactive compound row with two
 * stacked text regions and a distinct trailing selection/action marker.
 * The trailing marker is the structural selection evidence because many sites
 * expose the selected state only visually and omit aria/data state attributes.
 */
export function isLikelyIdentityGraphic(
  element: Element,
  view: Window
): boolean {
  if (!element.matches(GRAPHIC_SELECTOR) || !renderedForIdentity(element, view)) {
    return false
  }
  for (const row of identityRowsFor(element, view)) {
    if (!renderedForIdentity(row, view)) continue

    const textRegions = [row, ...Array.from(row.querySelectorAll('*'))]
      .filter(candidate =>
        belongsToIdentityRow(candidate, row) &&
        !candidate.matches(GRAPHIC_SELECTOR) &&
        renderedForIdentity(candidate, view) &&
        hasDirectRenderedText(candidate)
      )
      .map(candidate => ({
        element: candidate,
        bounds: candidate.getBoundingClientRect()
      }))
      .sort((left, right) =>
        left.bounds.top - right.bounds.top ||
        left.bounds.left - right.bounds.left
      )

    const graphics = [row, ...Array.from(row.querySelectorAll(GRAPHIC_SELECTOR))]
      .filter(candidate =>
        candidate.matches(GRAPHIC_SELECTOR) &&
        belongsToIdentityRow(candidate, row) &&
        renderedForIdentity(candidate, view)
      )

    const elementBounds = element.getBoundingClientRect()
    for (const primary of textRegions) {
      const supporting = textRegions.find(candidate =>
        candidate !== primary &&
        Math.abs(candidate.bounds.left - primary.bounds.left) <= 8 &&
        candidate.bounds.top >=
          primary.bounds.top + primary.bounds.height * 0.5
      )
      if (!supporting) continue
      const textLeft = Math.min(primary.bounds.left, supporting.bounds.left)
      if (elementBounds.right > textLeft + 4) continue
      const textRight = Math.max(primary.bounds.right, supporting.bounds.right)
      const trailingMarker = graphics.some(graphic => {
        if (
          graphic === element ||
          element.contains(graphic) ||
          graphic.contains(element)
        ) return false
        const bounds = graphic.getBoundingClientRect()
        return bounds.left >= textRight - 4
      }) || textRegions.some(candidate =>
        candidate !== primary &&
        candidate !== supporting &&
        candidate.bounds.left >= textRight - 4
      )
      if (trailingMarker) return true
      const rowBounds = row.getBoundingClientRect()
      const iconAboveText =
        elementBounds.bottom <=
          Math.min(primary.bounds.top, supporting.bounds.top) + 4 &&
        elementBounds.right >= textLeft - 4 &&
        elementBounds.left <= textRight + 4
      const largeSelfDescribingCard =
        rowBounds.height >= Math.max(72, elementBounds.height * 3) &&
        (elementBounds.right <= textLeft + 4 || iconAboveText) &&
        supportingRepeatsPrimary(primary.element, supporting.element)
      if (largeSelfDescribingCard) return true
    }
  }
  return false
}

function importTarget(
  sourceElement: Element,
  target: Element,
  viewBox: SanitizedUiVector['viewBox']
): SVGElement {
  const document = sourceElement.ownerDocument
  const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  wrapper.setAttribute(
    'viewBox',
    `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`
  )
  for (const attribute of ['fill', 'stroke', 'stroke-width'] as const) {
    const value = sourceElement.querySelector('use')?.getAttribute(attribute) ??
      sourceElement.getAttribute(attribute)
    if (value) wrapper.setAttribute(attribute, value)
  }
  for (const child of Array.from(target.childNodes)) {
    wrapper.appendChild(document.importNode(child, true))
  }
  return wrapper
}

async function resolveUseVector(
  element: Element,
  view: Window,
  options: UiVectorOptions
): Promise<SanitizedUiVector | null> {
  if (element.tagName.toLowerCase() !== 'svg') return null
  const uses = Array.from(element.querySelectorAll('use'))
  if (uses.length !== 1 || element.querySelectorAll(SHAPE_SELECTOR).length > 0) return null
  const href = uses[0]?.getAttribute('href') ?? uses[0]?.getAttribute('xlink:href')
  if (!href) return null

  if (href.startsWith('#')) {
    const target = element.ownerDocument.getElementById(decodeURIComponent(href.slice(1)))
    if (!target || !['symbol', 'g', 'svg'].includes(target.tagName.toLowerCase())) return null
    const parsedViewBox = viewBoxFor(target) ?? viewBoxFor(element)
    if (!parsedViewBox) return null
    return sanitizeStandaloneSvg(
      importTarget(element, target, parsedViewBox),
      {
        ...options,
        allowCurrentColorFill: options.allowResolvedCurrentColorFill ?? true
      },
      view
    )
  }

  let url: URL
  try {
    url = new URL(href, element.ownerDocument.location.href)
  } catch {
    return null
  }
  if (
    url.origin !== element.ownerDocument.location.origin ||
    !url.hash ||
    !/\.svg$/i.test(url.pathname)
  ) return null

  const cacheKey = url.href
  const cached = spriteVectorCache.get(cacheKey)
  if (cached) return cached
  const resolution = (async (): Promise<SanitizedUiVector | null> => {
    const fetcher = (view as Window & {
      fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    }).fetch
    if (!fetcher) return null
    try {
      const requestUrl = new URL(url.href)
      requestUrl.hash = ''
      const response = await fetcher.call(view, requestUrl.href, {
        credentials: 'same-origin',
        cache: 'force-cache'
      })
      if (!response.ok) return null
      const source = await response.text()
      if (source.length > 2_000_000) return null
      const Parser = (view as unknown as { DOMParser: typeof DOMParser }).DOMParser
      const parsed = new Parser().parseFromString(source, 'image/svg+xml')
      if (parsed.querySelector('parsererror')) return null
      const target = parsed.getElementById(decodeURIComponent(url.hash.slice(1)))
      if (!target || !['symbol', 'g', 'svg'].includes(target.tagName.toLowerCase())) {
        return null
      }
      const parsedViewBox = viewBoxFor(target) ?? viewBoxFor(element)
      if (!parsedViewBox) return null
      return sanitizeStandaloneSvg(
        importTarget(element, target, parsedViewBox),
        {
          ...options,
          allowCurrentColorFill: options.allowResolvedCurrentColorFill ?? true
        },
        view
      )
    } catch {
      return null
    }
  })()
  spriteVectorCache.set(cacheKey, resolution)
  return resolution
}

export async function sanitizeUiVector(
  element: Element,
  view: Window,
  options: UiVectorOptions = {}
): Promise<SanitizedUiVector | null> {
  if (isLikelyBrandGraphic(element)) return null
  return sanitizeStandaloneSvg(element, options, view) ??
    resolveUseVector(element, view, options)
}
