import type {
  ColorFamily,
  ColorProvenance,
  Colors,
  ColorValue,
  InteractiveColorIntent,
  InteractiveColorState,
  InteractiveColorToken,
  InteractiveColorUsage,
  PrimitiveColorToken,
  SemanticColorGroup,
  SemanticColorToken
} from '../../shared/schema'
import {
  stableInteractiveColorId,
  stablePrimitiveColorId,
  stableSemanticColorId
} from '../../shared/stable-id'
import { isExcludedStyleAssetSurface } from './visual-assets'
import {
  authorContentRootFor,
  isWebsiteOperation
} from './content-payload'

const STANDARD_NEUTRAL_STEPS = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000]
const numericColorToken = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i

type SemanticCandidate = Omit<SemanticColorToken, 'id' | 'primitiveId'>
type InteractiveCandidate = Omit<InteractiveColorToken, 'id' | 'primitiveId'>

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

function colorKey(value: ColorValue): string {
  return `${value.r}|${value.g}|${value.b}|${value.a}`
}

function provenanceRank(value: ColorProvenance): number {
  return value === 'observed' ? 2 : value === 'declared' ? 1 : 0
}

export function strongestColorProvenance(
  left: ColorProvenance,
  right: ColorProvenance
): ColorProvenance {
  return provenanceRank(left) >= provenanceRank(right) ? left : right
}

function mergedConfirmedProvenance(
  left: SemanticCandidate['provenance'],
  right: SemanticCandidate['provenance']
): SemanticCandidate['provenance'] {
  return left === 'observed' || right === 'observed' ? 'observed' : 'declared'
}

function parseHexColor(raw: string): ColorValue | null {
  const value = raw.slice(1)
  if (![3, 4, 6, 8].includes(value.length) || !/^[0-9a-f]+$/i.test(value)) return null
  const expanded = value.length <= 4
    ? value.split('').map(character => character + character).join('')
    : value
  const channel = (start: number) => normalizedNumber(Number.parseInt(expanded.slice(start, start + 2), 16) / 255)
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: expanded.length === 8 ? channel(6) : 1
  }
}

function parseRgbChannel(raw: string, srgb: boolean): number | null {
  const value = raw.trim()
  if (!numericColorToken.test(value)) return null
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return null
  const parsed = value.endsWith('%') ? numeric / 100 : srgb ? numeric : numeric / 255
  if (parsed < 0 || parsed > 1) return null
  return normalizedNumber(parsed)
}

function parseAlpha(raw: string | undefined): number | null {
  if (raw === undefined) return 1
  const value = raw.trim()
  if (!numericColorToken.test(value)) return null
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return null
  const parsed = value.endsWith('%') ? numeric / 100 : numeric
  if (parsed < 0 || parsed > 1) return null
  return normalizedNumber(parsed)
}

function parseOklabLightness(raw: string): number | null {
  const value = raw.trim()
  if (!numericColorToken.test(value)) return null
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return null
  const parsed = value.endsWith('%') ? numeric / 100 : numeric
  if (parsed < 0 || parsed > 1) return null
  return parsed
}

function parseOklabAxis(raw: string): number | null {
  const value = raw.trim()
  if (!numericColorToken.test(value)) return null
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return null
  return value.endsWith('%') ? numeric * 0.004 : numeric
}

function linearSrgbChannel(value: number): number {
  const encoded = value <= 0.0031308
    ? 12.92 * value
    : 1.055 * value ** (1 / 2.4) - 0.055
  return normalizedNumber(Math.min(1, Math.max(0, encoded)))
}

function parseOklabColor(raw: string): ColorValue | null {
  const match = /^oklab\((.*)\)$/i.exec(raw.trim())
  if (!match) return null
  const slashParts = (match[1] ?? '').split('/').map(part => part.trim())
  if (slashParts.length > 2) return null
  const channels = (slashParts[0] ?? '').split(/\s+/).filter(Boolean)
  if (channels.length !== 3) return null
  const lightness = parseOklabLightness(channels[0] ?? '')
  const axisA = parseOklabAxis(channels[1] ?? '')
  const axisB = parseOklabAxis(channels[2] ?? '')
  const alpha = parseAlpha(slashParts[1])
  if (lightness === null || axisA === null || axisB === null || alpha === null) return null

  const lRoot = lightness + 0.3963377774 * axisA + 0.2158037573 * axisB
  const mRoot = lightness - 0.1055613458 * axisA - 0.0638541728 * axisB
  const sRoot = lightness - 0.0894841775 * axisA - 1.291485548 * axisB
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3

  return {
    r: linearSrgbChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearSrgbChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearSrgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha
  }
}

function parseFunctionalColor(raw: string): ColorValue | null {
  const match = /^(rgba?|color)\((.*)\)$/i.exec(raw.trim())
  if (!match) return null
  const functionName = match[1]?.toLowerCase()
  let content = match[2]?.trim()
  if (!functionName || content === undefined) return null
  const srgb = functionName === 'color'
  if (srgb) {
    if (!/^srgb\s+/i.test(content)) return null
    content = content.replace(/^srgb\s+/i, '')
  }
  const slashParts = content.split('/').map(part => part.trim())
  if (slashParts.length > 2) return null
  const beforeSlash = slashParts[0] ?? ''
  const commaSyntax = beforeSlash.includes(',')
  if (commaSyntax && (srgb || slashParts[1] !== undefined)) return null
  const channels = commaSyntax
    ? beforeSlash.split(',').map(part => part.trim())
    : beforeSlash.split(/\s+/).filter(Boolean)
  if (channels.some(channel => !channel)) return null
  const alphaPart = commaSyntax && channels.length === 4 ? channels.pop() : slashParts[1]
  if (channels.length !== 3) return null
  const [r, g, b] = channels.map(channel => parseRgbChannel(channel, srgb))
  const a = parseAlpha(alphaPart)
  if (r === null || r === undefined || g === null || g === undefined ||
      b === null || b === undefined || a === null) return null
  return { r, g, b, a }
}

export function parseCssColor(raw: string): ColorValue | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (value === 'black') return { r: 0, g: 0, b: 0, a: 1 }
  if (value === 'white') return { r: 1, g: 1, b: 1, a: 1 }
  if (value.startsWith('#')) return parseHexColor(value)
  if (value.startsWith('oklab(')) return parseOklabColor(value)
  return parseFunctionalColor(value)
}

function hueFor(value: ColorValue): number | null {
  const maximum = Math.max(value.r, value.g, value.b)
  const minimum = Math.min(value.r, value.g, value.b)
  const delta = maximum - minimum
  if (delta <= 0.08) return null
  let hue = 0
  if (maximum === value.r) hue = 60 * (((value.g - value.b) / delta) % 6)
  else if (maximum === value.g) hue = 60 * (((value.b - value.r) / delta) + 2)
  else hue = 60 * (((value.r - value.g) / delta) + 4)
  return (hue + 360) % 360
}

export function colorFamily(value: ColorValue): ColorFamily {
  const hue = hueFor(value)
  if (hue === null) return 'neutral'
  if (hue < 15 || hue >= 345) return 'red'
  if (hue < 45) return 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 165) return 'green'
  if (hue < 200) return 'cyan'
  if (hue < 255) return 'blue'
  if (hue < 315) return 'purple'
  if (hue < 345) return 'pink'
  return 'other'
}

function relativeLuminance(value: ColorValue): number {
  const linear = (channel: number) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(value.r) + 0.7152 * linear(value.g) + 0.0722 * linear(value.b)
}

function colorHex(value: ColorValue): string {
  const byte = (channel: number) => Math.round(channel * 255).toString(16).padStart(2, '0')
  return `${byte(value.r)}${byte(value.g)}${byte(value.b)}`
}

function colorPrecisionSuffix(value: ColorValue): string {
  const byteExact = [value.r, value.g, value.b].every(channel =>
    normalizedNumber(Math.round(channel * 255) / 255) === channel
  )
  const percentAlphaExact = normalizedNumber(Math.round(value.a * 100) / 100) === value.a
  if (byteExact && percentAlphaExact) return ''
  const slug = (channel: number) => `${channel}`.replace('-', 'm').replace('.', 'p')
  return `-v${[value.r, value.g, value.b, value.a].map(slug).join('-')}`
}

function endpointStep(value: ColorValue): number | null {
  if (value.r === 1 && value.g === 1 && value.b === 1) return 0
  if (value.r === 0 && value.g === 0 && value.b === 0) return 1000
  return null
}

function colorLabel(value: ColorValue): string {
  const base = colorHex(value)
  const alpha = value.a === 1 ? '' : `-a${Math.round(value.a * 100)}`
  return `${base}${alpha}${colorPrecisionSuffix(value)}`
}

function primitiveName(value: ColorValue, family: ColorFamily, step: number | null): string {
  const base = step === null ? `${family}-${colorHex(value)}` : `${family}-${step}`
  const alpha = value.a === 1 ? '' : `-a${Math.round(value.a * 100)}`
  return `${base}${alpha}${colorPrecisionSuffix(value)}`
}

function colorDistance(left: ColorValue, right: ColorValue): number {
  return Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b),
    Math.abs(left.a - right.a)
  )
}

export async function inferNeutralRamp(source: PrimitiveColorToken[]): Promise<PrimitiveColorToken[]> {
  const anchors = source
    .filter(token => token.family === 'neutral' && token.value.a === 1)
    .sort((left, right) => relativeLuminance(right.value) - relativeLuminance(left.value))
  const light = anchors[0]
  const dark = anchors[anchors.length - 1]
  if (!light || !dark) return source
  const lightLuminance = relativeLuminance(light.value)
  const darkLuminance = relativeLuminance(dark.value)
  if (lightLuminance < 0.85 || darkLuminance > 0.15 || lightLuminance - darkLuminance < 0.7) {
    return source
  }

  const inferred: PrimitiveColorToken[] = []
  for (const step of STANDARD_NEUTRAL_STEPS) {
    const fraction = step / 1000
    const value: ColorValue = {
      r: normalizedNumber(light.value.r + (dark.value.r - light.value.r) * fraction),
      g: normalizedNumber(light.value.g + (dark.value.g - light.value.g) * fraction),
      b: normalizedNumber(light.value.b + (dark.value.b - light.value.b) * fraction),
      a: 1
    }
    if (source.some(token => colorDistance(token.value, value) <= 0.006)) continue
    inferred.push({
      id: await stablePrimitiveColorId(value),
      name: `neutral-${step}`,
      value,
      family: 'neutral',
      step,
      provenance: 'inferred',
      occurrences: 0
    })
  }
  return [...source, ...inferred]
}

function isVisible(element: Element, view: Window): boolean {
  if (!element.isConnected || element.closest(
    'script,style,noscript,template,[hidden],[aria-hidden="true"],[data-smart-scan-overlay="true"]'
  )) return false
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' || style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') === 0
    ) return false
  }
  return true
}

function statusElement(element: Element): boolean {
  return element.matches('[role="alert"],[role="status"],[aria-invalid="true"]') ||
    Boolean(element.closest('[role="alert"],[role="status"],[aria-invalid="true"]'))
}

function semanticGroup(element: Element, usage: InteractiveColorUsage): SemanticColorGroup {
  if (statusElement(element)) return 'status'
  if (element.matches('a[href]') || element.closest('a[href]')) return 'link'
  if (element.matches('pre,code,kbd,samp') || element.closest('pre,code,kbd,samp')) return 'content'
  if (usage === 'background') return 'background'
  if (usage === 'border') return 'border'
  if (usage === 'foreground') return 'text'
  return 'misc'
}

function stateFor(element: Element): InteractiveColorState {
  if (element.matches(':disabled,[aria-disabled="true"]')) return 'disabled'
  if (element.matches(':checked,[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"]')) {
    return 'selected'
  }
  return 'default'
}

function intentForElement(element: Element): InteractiveColorIntent {
  if (statusElement(element)) return 'danger'
  return 'primary'
}

function isInteractive(element: Element): boolean {
  return element.matches([
    'button', 'input', 'textarea', 'select', 'a[href]',
    '[role="button"]', '[role="tab"]', '[role="option"]', '[role="checkbox"]',
    '[role="radio"]', '[role="switch"]'
  ].join(','))
}

function directColorValues(
  element: Element,
  usage: InteractiveColorUsage
): string[] {
  const style = (element as Element & {
    style?: CSSStyleDeclaration
  }).style
  const values: string[] = []
  if (style) {
    if (usage === 'foreground') values.push(style.color)
    if (usage === 'background') values.push(style.backgroundColor)
    if (usage === 'border') {
      values.push(
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor
      )
    }
    if (usage === 'outline') {
      values.push(style.outlineColor, style.textDecorationColor)
    }
    for (let index = 0; index < style.length; index += 1) {
      values.push(style.getPropertyValue(style.item(index)))
    }
  }
  if (usage === 'foreground') values.push(element.getAttribute('color') ?? '')
  if (usage === 'background') values.push(element.getAttribute('bgcolor') ?? '')
  if (usage === 'border') values.push(element.getAttribute('bordercolor') ?? '')
  return values.filter(Boolean)
}

function hasDirectColorValue(
  element: Element,
  usage: InteractiveColorUsage,
  value: ColorValue
): boolean {
  const key = colorKey(value)
  return directColorValues(element, usage).some(raw => {
    const parsed = parseCssColor(raw)
    return parsed ? colorKey(parsed) === key : false
  })
}

function hasDirectText(element: Element): boolean {
  return Array.from(element.childNodes).some(node =>
    node.nodeType === 3 && Boolean(node.textContent?.trim())
  )
}

function isDirectAuthorTextColor(
  element: Element,
  usage: InteractiveColorUsage,
  value: ColorValue
): boolean {
  const contentRoot = authorContentRootFor(element)
  if (!contentRoot || isWebsiteOperation(element)) return false
  for (
    let current: Element | null = element;
    current && current !== contentRoot;
    current = current.parentElement
  ) {
    if (
      hasDirectText(current) &&
      hasDirectColorValue(current, usage, value)
    ) return true
  }
  return false
}

function isCompactInlineDataColor(
  element: Element,
  usage: InteractiveColorUsage,
  value: ColorValue
): boolean {
  if (
    isWebsiteOperation(element) ||
    element.matches('[role="status"],[role="alert"],[aria-live]') ||
    hasDirectText(element) ||
    element.children.length > 0 ||
    !hasDirectColorValue(element, usage, value)
  ) return false
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0 &&
    bounds.width <= 24 && bounds.height <= 24
}

export async function collectColors(document: Document): Promise<Colors> {
  const view = document.defaultView
  if (!view) return { primitives: [], semantic: [], interactive: [] }

  const primitives = new Map<string, {
    value: ColorValue
    provenance: ColorProvenance
    occurrences: number
  }>()
  const semanticCandidates = new Map<string, SemanticCandidate>()
  const interactiveCandidates = new Map<string, InteractiveCandidate>()

  const recordPrimitive = (value: ColorValue, provenance: ColorProvenance, occurrences = 1) => {
    if (value.a === 0) return
    const key = colorKey(value)
    const previous = primitives.get(key)
    primitives.set(key, {
      value,
      provenance: previous ? strongestColorProvenance(previous.provenance, provenance) : provenance,
      occurrences: (previous?.occurrences ?? 0) + occurrences
    })
  }

  const recordSemantic = (candidate: SemanticCandidate) => {
    if (candidate.value.a === 0) return
    recordPrimitive(candidate.value, candidate.provenance, candidate.occurrences)
    const key = `${candidate.name}|${candidate.group}|${colorKey(candidate.value)}`
    const previous = semanticCandidates.get(key)
    semanticCandidates.set(key, previous ? {
      ...previous,
      provenance: mergedConfirmedProvenance(previous.provenance, candidate.provenance),
      occurrences: previous.occurrences + candidate.occurrences
    } : candidate)
  }

  const recordInteractive = (candidate: InteractiveCandidate) => {
    if (candidate.value.a === 0) return
    recordPrimitive(candidate.value, candidate.provenance, candidate.occurrences)
    const key = `${candidate.intent}|${candidate.state}|${candidate.usage}|${colorKey(candidate.value)}`
    const previous = interactiveCandidates.get(key)
    interactiveCandidates.set(key, previous ? {
      ...previous,
      provenance: mergedConfirmedProvenance(previous.provenance, candidate.provenance),
      occurrences: previous.occurrences + candidate.occurrences
    } : candidate)
  }

  const usageValues = (style: CSSStyleDeclaration): Array<{
    usage: InteractiveColorUsage
    values: string[]
  }> => {
    const borderValues = [
      [style.borderTopStyle, style.borderTopWidth, style.borderTopColor],
      [style.borderRightStyle, style.borderRightWidth, style.borderRightColor],
      [style.borderBottomStyle, style.borderBottomWidth, style.borderBottomColor],
      [style.borderLeftStyle, style.borderLeftWidth, style.borderLeftColor]
    ].filter(([borderStyle, width]) =>
      borderStyle !== 'none' && borderStyle !== 'hidden' && Number.parseFloat(width ?? '0') > 0
    ).map(([, , color]) => color ?? '')
    const outlineVisible = style.outlineStyle !== 'none' &&
      Number.parseFloat(style.outlineWidth || '0') > 0
    const decorationVisible = Boolean(style.textDecorationLine && style.textDecorationLine !== 'none')
    return [{ usage: 'foreground', values: [style.color] }, {
      usage: 'background', values: [style.backgroundColor]
    }, {
      usage: 'border', values: [...new Set(borderValues)]
    }, {
      usage: 'outline', values: [
        outlineVisible ? style.outlineColor : '',
        decorationVisible ? style.textDecorationColor : ''
      ]
    }]
  }

  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (!isVisible(element, view) || isExcludedStyleAssetSurface(element)) continue
    const style = view.getComputedStyle(element)
    for (const { usage, values } of usageValues(style)) {
      for (const raw of values) {
        const value = parseCssColor(raw)
        if (!value || value.a === 0) continue
        if (
          isDirectAuthorTextColor(element, usage, value) ||
          isCompactInlineDataColor(element, usage, value)
        ) continue
        const group = semanticGroup(element, usage)
        recordSemantic({
          name: `${group}-${colorLabel(value)}`,
          group,
          value,
          provenance: 'observed',
          occurrences: 1
        })
        if (isInteractive(element)) {
          const intent = intentForElement(element)
          const state = stateFor(element)
          recordInteractive({
            name: `${intent}-${state}-${usage}`,
            intent,
            state,
            usage,
            value,
            provenance: 'observed',
            occurrences: 1
          })
        }
      }
    }
  }

  const primitiveTokens = await Promise.all([...primitives.values()].map(async item => {
    const family = colorFamily(item.value)
    const step = family === 'neutral' ? endpointStep(item.value) : null
    return {
      id: await stablePrimitiveColorId(item.value),
      name: primitiveName(item.value, family, step),
      value: item.value,
      family,
      step,
      provenance: item.provenance,
      occurrences: item.occurrences
    } satisfies PrimitiveColorToken
  }))
  const primitiveByValue = new Map(primitiveTokens.map(token => [colorKey(token.value), token]))

  const semantic = await Promise.all([...semanticCandidates.values()].map(async candidate => {
    const primitive = primitiveByValue.get(colorKey(candidate.value))
    if (!primitive) throw new Error('Semantic color is missing its primitive')
    return {
      ...candidate,
      id: await stableSemanticColorId(candidate),
      primitiveId: primitive.id
    } satisfies SemanticColorToken
  }))

  const interactive = await Promise.all([...interactiveCandidates.values()].map(async candidate => {
    const primitive = primitiveByValue.get(colorKey(candidate.value))
    if (!primitive) throw new Error('Interactive color is missing its primitive')
    return {
      ...candidate,
      id: await stableInteractiveColorId(candidate),
      primitiveId: primitive.id
    } satisfies InteractiveColorToken
  }))

  return {
    primitives: primitiveTokens.sort((left, right) =>
      left.family.localeCompare(right.family) || relativeLuminance(right.value) - relativeLuminance(left.value)
    ),
    semantic: semantic.sort((left, right) =>
      left.group.localeCompare(right.group) || left.name.localeCompare(right.name)
    ),
    interactive: interactive.sort((left, right) =>
      left.intent.localeCompare(right.intent) || left.state.localeCompare(right.state) ||
      left.usage.localeCompare(right.usage)
    )
  }
}
