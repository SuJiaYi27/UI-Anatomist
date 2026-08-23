import type { Font, FontCollection, Glyph } from 'fontkit'
import { isPrivateControlContext } from './control-sample-text'
import {
  sanitizeUiVector,
  type SanitizedUiVector
} from './ui-vector'

export const FONT_ICON_SELECTOR = [
  '[data-mat-icon-type="font"]',
  '[data-mat-icon-name]',
  '[data-icon-type="font"]',
  '[data-icon-name]',
  '[fonticon]',
  '[role="img"]',
  'mat-icon',
  'md-icon',
  '[class*="symbol" i]',
  '[class*="glyph" i]',
  '[class*="ligature" i]'
].join(',')

export type FontIconDependencies = {
  loadFontResources?: (
    element: HTMLElement,
    familyNames: string[]
  ) => Promise<Uint8Array[]>
  createFont?: (bytes: Uint8Array) => Font | FontCollection
}

const resourceCache = new Map<string, Promise<Uint8Array | null>>()
const directGlyphPattern = /^[\p{L}\p{N}_-]{1,32}$/u
const FONT_RESOURCE_TIMEOUT_MS = 4_000

function directGlyphText(element: Element): string | null {
  const value = Array.from(element.childNodes)
    .filter(node => node.nodeType === 3)
    .map(node => node.textContent ?? '')
    .join('')
    .trim()
  return directGlyphPattern.test(value) ? value : null
}

function metadataGlyphText(element: Element): string | null {
  const attributes = [
    'data-mat-icon-name',
    'data-icon-name',
    'fonticon'
  ]
  for (const name of attributes) {
    const value = element.getAttribute(name)?.trim() ?? ''
    if (directGlyphPattern.test(value)) return value
  }
  return null
}

function hasExplicitFontIconMetadata(element: Element): boolean {
  return Array.from(element.attributes).some(attribute => {
    const name = attribute.name.toLowerCase()
    const value = attribute.value.trim().toLowerCase()
    return (
      /(?:^|[-:])icon-type$/.test(name) && value === 'font'
    ) || /(?:^|[-:])icon-name$/.test(name) ||
      name === 'fonticon'
  })
}

function hasGenericFontIconSemantics(element: Element): boolean {
  if (element.getAttribute('role')?.toLowerCase() === 'img') return true
  const tag = element.tagName.toLowerCase()
  if (tag === 'mat-icon' || tag === 'md-icon' || /-icon$/.test(tag)) return true
  return Array.from(element.classList).some(value =>
    /(?:^|[-_])(?:icon|icons|symbol|symbols|glyph|glyphs|ligature)(?:$|[-_])/i
      .test(value.replace(/([a-z0-9])([A-Z])/g, '$1-$2'))
  )
}

function familyNames(style: CSSStyleDeclaration): string[] {
  return style.fontFamily
    .split(',')
    .map(value => value.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function rendered(element: HTMLElement, view: Window): boolean {
  if (
    !element.isConnected ||
    element.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
    element.closest(
      'script,style,noscript,template,[hidden],' +
      '[contenteditable]:not([contenteditable="false"])'
    ) ||
    isPrivateControlContext(element)
  ) return false
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') === 0
    ) return false
  }
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0
}

export function isFontIconCandidate(
  element: Element,
  view: Window
): element is HTMLElement {
  if (!('style' in element) || !rendered(element as HTMLElement, view)) return false
  const htmlElement = element as HTMLElement
  const glyphText = directGlyphText(element) ?? metadataGlyphText(element)
  if (!glyphText) return false
  if (hasExplicitFontIconMetadata(element)) return true
  const style = view.getComputedStyle(element)
  return hasGenericFontIconSemantics(htmlElement) &&
    familyNames(style).some(family => /(?:icon|symbol|glyph)/i.test(family))
}

function normalizedFamily(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

function fontFaceUrls(document: Document, families: string[]): string[] {
  const acceptedFamilies = new Set(families.map(normalizedFamily))
  const urls = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (rule.type !== 5) continue
      const face = rule as CSSFontFaceRule
      const declaredFamily =
        face.style.getPropertyValue('font-family') ||
        face.style.fontFamily ||
        rule.cssText.match(/font-family\s*:\s*([^;]+)/i)?.[1]
      if (!acceptedFamilies.has(normalizedFamily(declaredFamily))) continue
      const source = face.style.getPropertyValue('src') || rule.cssText
      for (const match of source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        const raw = match[2]?.trim()
        if (!raw) continue
        try {
          urls.add(new URL(raw, document.location.href).href)
        } catch {
          // Invalid font URLs are ignored.
        }
      }
    }
  }
  return [...urls]
}

function observedFontUrls(document: Document, view: Window): string[] {
  const urls = new Set<string>()
  const entries = view.performance?.getEntriesByType?.('resource') ?? []
  for (const entry of entries) {
    const resource = entry as PerformanceResourceTiming
    const fontLikeUrl = /(?:font|woff2?|ttf|otf)(?:[/?#._=-]|$)/i.test(entry.name)
    if (!fontLikeUrl && resource.initiatorType !== 'css') continue
    try {
      const url = new URL(entry.name, document.location.href)
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:') {
        urls.add(url.href)
      }
    } catch {
      // Invalid resource entries are ignored.
    }
  }
  return [...urls]
}

async function loadFontUrl(url: string, view: Window): Promise<Uint8Array | null> {
  const cached = resourceCache.get(url)
  if (cached) return cached
  const request = (async () => {
    const fetcher = (view as Window & {
      fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    }).fetch
    if (!fetcher) return null
    return new Promise<Uint8Array | null>(resolve => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout>
      const finish = (value: Uint8Array | null) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(value)
      }
      timeout = setTimeout(
        () => finish(null),
        FONT_RESOURCE_TIMEOUT_MS
      )
      void (async () => {
        try {
          const response = await fetcher.call(view, url, {
          credentials: 'same-origin',
          cache: 'force-cache'
          })
          if (!response.ok) return finish(null)
          const length = Number.parseInt(
            response.headers.get('content-length') ?? '',
            10
          )
          if (Number.isFinite(length) && length > 5_000_000) return finish(null)
          const bytes = new Uint8Array(await response.arrayBuffer())
          finish(bytes.length > 0 && bytes.length <= 5_000_000 ? bytes : null)
        } catch {
          finish(null)
        }
      })()
    })
  })()
  resourceCache.set(url, request)
  return request
}

async function loadDocumentFonts(
  element: HTMLElement,
  families: string[]
): Promise<Uint8Array[]> {
  const document = element.ownerDocument
  const view = document.defaultView
  if (!view) return []
  const urls = [
    ...fontFaceUrls(document, families),
    ...observedFontUrls(document, view)
  ].filter((url, index, values) => values.indexOf(url) === index).slice(0, 12)
  const loaded = await Promise.all(urls.map(url => loadFontUrl(url, view)))
  return loaded.filter((value): value is Uint8Array => value !== null)
}

function isFont(value: Font | FontCollection): value is Font {
  return 'layout' in value && typeof value.layout === 'function'
}

function variationSettings(
  style: CSSStyleDeclaration,
  font: Font
): Record<string, number> {
  const settings: Record<string, number> = {}
  const raw = style.fontVariationSettings
  if (raw && raw !== 'normal') {
    for (const match of raw.matchAll(/["']([A-Za-z0-9]{4})["']\s+(-?\d+(?:\.\d+)?)/g)) {
      const tag = match[1]
      const value = Number.parseFloat(match[2] ?? '')
      const axis = tag ? font.variationAxes[tag] : undefined
      if (tag && axis && Number.isFinite(value)) {
        settings[tag] = Math.min(axis.max, Math.max(axis.min, value))
      }
    }
  }
  const weightAxis = font.variationAxes.wght
  const weight = Number.parseFloat(style.fontWeight)
  if (weightAxis && settings.wght === undefined && Number.isFinite(weight)) {
    settings.wght = Math.min(weightAxis.max, Math.max(weightAxis.min, weight))
  }
  return settings
}

function fontMatchesFamilies(font: Font, families: string[]): boolean {
  const accepted = new Set(families.map(normalizedFamily))
  return [font.familyName, font.fullName, font.postscriptName]
    .some(value => accepted.has(normalizedFamily(value)))
}

type VariablePoint = {
  x: number
  y: number
  onCurve: boolean
  endContour: boolean
  copy: () => VariablePoint
}

type TransformedWoff2Glyph = {
  numberOfContours: number
  points?: VariablePoint[]
}

type TransformedVariableWoff2Font = Font & {
  fvar?: {
    axis?: Array<{
      axisTag: string
      defaultValue: number
    }>
  }
  variationCoords?: number[] | null
  directory?: {
    tables?: Record<string, {
      transformed?: boolean
    }>
  }
  _variationProcessor?: {
    transformPoints: (
      glyphId: number,
      points: VariablePoint[]
    ) => void
  } | null
  _transformedGlyphs?: Record<number, TransformedWoff2Glyph>
  _glyphs?: Record<number, unknown>
}

function variableWoff2Glyph(
  font: Font,
  glyphText: string,
  settings: Record<string, number>
): Glyph | null {
  if (font.type !== 'WOFF2') return null
  const internal = font as TransformedVariableWoff2Font
  const axes = internal.fvar?.axis
  if (
    !axes?.length ||
    !internal.directory?.tables?.glyf?.transformed ||
    !internal.directory.tables.gvar
  ) return null

  internal.variationCoords = axes.map(axis =>
    settings[axis.axisTag.trim()] ?? axis.defaultValue
  )
  const run = internal.layout(glyphText, ['rlig', 'liga'])
  if (run.glyphs.length !== 1) return null
  const glyphId = run.glyphs[0]?.id ?? 0
  if (glyphId === 0) return null

  const data = internal._transformedGlyphs?.[glyphId]
  const processor = internal._variationProcessor
  if (
    !data ||
    data.numberOfContours <= 0 ||
    !data.points?.length ||
    !processor
  ) return null

  const points = data.points.map(point => point.copy())
  const seed = points[0]
  if (!seed) return null
  for (let index = 0; index < 4; index += 1) {
    const phantom = seed.copy()
    phantom.x = 0
    phantom.y = 0
    phantom.onCurve = false
    phantom.endContour = true
    points.push(phantom)
  }
  processor.transformPoints(glyphId, points)
  internal._transformedGlyphs![glyphId] = {
    ...data,
    points: points.slice(0, -4)
  }
  if (internal._glyphs) delete internal._glyphs[glyphId]
  return internal.getGlyph(glyphId, run.glyphs[0]?.codePoints)
}

async function vectorFromFont(
  element: HTMLElement,
  view: Window,
  bytes: Uint8Array,
  glyphText: string,
  families: string[],
  style: CSSStyleDeclaration,
  createFont?: FontIconDependencies['createFont']
): Promise<{ vector: SanitizedUiVector; familyMatched: boolean } | null> {
  try {
    const parsed = createFont
      ? createFont(bytes)
      : (await import('fontkit')).create(bytes as unknown as Buffer)
    if (!isFont(parsed)) return null
    const familyMatched = fontMatchesFamilies(parsed, families)
    const settings = variationSettings(style, parsed)
    let glyph: Glyph | null | undefined
    if (Object.keys(settings).length > 0 && parsed.type === 'WOFF2') {
      glyph = variableWoff2Glyph(parsed, glyphText, settings)
    } else {
      const font = Object.keys(settings).length > 0
        ? parsed.getVariation(settings)
        : parsed
      const run = font.layout(glyphText, ['rlig', 'liga'])
      if (run.glyphs.length !== 1) return null
      glyph = run.glyphs[0]
    }
    if (!glyph || glyph.id === 0) return null
    const pathData = glyph.path.toSVG()
    const bounds = glyph.path.bbox
    if (
      !pathData ||
      pathData.length > 60_000 ||
      !Number.isFinite(bounds.minX) ||
      !Number.isFinite(bounds.minY) ||
      !Number.isFinite(bounds.maxX) ||
      !Number.isFinite(bounds.maxY) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) return null

    const svg = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute(
      'viewBox',
      `${bounds.minX} ${-bounds.maxY} ${bounds.width} ${bounds.height}`
    )
    svg.setAttribute('fill', 'currentColor')
    const group = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('transform', 'scale(1 -1)')
    const path = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', pathData)
    group.appendChild(path)
    svg.appendChild(group)
    const vector = await sanitizeUiVector(svg, view, {
      allowCurrentColorFill: true,
      maximumLength: 65_536
    })
    return vector ? { vector, familyMatched } : null
  } catch {
    return null
  }
}

export async function sanitizeFontIcon(
  element: Element,
  view: Window,
  dependencies: FontIconDependencies = {}
): Promise<SanitizedUiVector | null> {
  if (!isFontIconCandidate(element, view)) return null
  const glyphText = directGlyphText(element) ?? metadataGlyphText(element)
  if (!glyphText) return null
  const style = view.getComputedStyle(element)
  const families = familyNames(style)
  if (families.length === 0) return null
  const resources = await (
    dependencies.loadFontResources ?? loadDocumentFonts
  )(element, families)
  const candidates: Array<{
    vector: SanitizedUiVector
    familyMatched: boolean
  }> = []
  for (const bytes of resources) {
    const candidate = await vectorFromFont(
      element,
      view,
      bytes,
      glyphText,
      families,
      style,
      dependencies.createFont
    )
    if (candidate) candidates.push(candidate)
  }
  const exact = candidates.filter(candidate => candidate.familyMatched)
  const eligible = exact.length > 0 ? exact : candidates
  const unique = new Map(
    eligible.map(candidate => [candidate.vector.vectorSvg, candidate.vector])
  )
  return unique.size === 1 ? [...unique.values()][0]! : null
}
