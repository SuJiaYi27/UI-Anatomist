import {
  isSafeControlSampleTextValue,
  type ColorValue,
  type CompositeChild,
  type CompositeToken,
  type StaticTextRegionChild,
  type TypographyStyle
} from '../../shared/schema'
import {
  stableStaticTextRegionInstanceId,
  stableStaticTextRegionTemplateId
} from '../../shared/stable-id'
import { anonymousControlLogicalId } from './control-identity'
import { authorContentRootFor } from './content-payload'
import {
  privateControlContextEvidence,
  type PrivateContextReason,
  type PrivateControlContextEvidence
} from './control-sample-text'
import { parseCssColor } from './colors'
import { parseBoxShadow } from './shadows'
import { exactControlRadii } from './control-surface'

type RelativeBounds = { x: number; y: number; width: number; height: number }
type EdgeValues = { top: number; right: number; bottom: number; left: number }
type PrivacyScope = 'self' | 'wrapper' | 'inside-parent' | 'parent' | 'outside-parent'
type PrivacyDepthBucket = '0' | '1-2' | '3-4' | '5+'

type StaticTextTrace = {
  nodeId: string
  placement: RelativeBounds
  visible: boolean
  singleLine: boolean
  directRenderedText: boolean
  textLengthBucket: '0' | '1-8' | '9-24' | '25-64' | '65+'
  typographySignature: {
    fontSizePx: number
    fontWeight: number
    lineHeightPx: number
    letterSpacingPx: number
  }
  foreground: ColorValue
  contexts: {
    control: boolean
    contenteditable: boolean
    authorContent: boolean
    privateOrIdentity: boolean
  }
  privacyProvenance: {
    reasons: Record<PrivateContextReason, boolean>
    sources: Partial<Record<PrivateContextReason, {
      scope: PrivacyScope
      depthBucket: PrivacyDepthBucket
    }>>
  }
  strictSafeStaticUiCopyEligible: boolean
  wrapper: {
    bounds: RelativeBounds
    padding: EdgeValues
    background: ColorValue
    borderWidths: EdgeValues
    pseudoPaint: { before: boolean; after: boolean }
    semanticCategory: 'dialog' | 'menu' | 'list' | 'group' | 'none'
    surfaceCategory: 'painted' | 'transparent'
  }
}

type SeparatorTrace = {
  source: 'wrapper-border-bottom' | 'adjacent-border-top' |
    'standalone-element' | 'before' | 'after' | 'none'
  placement: RelativeBounds
  orientation: 'horizontal' | 'vertical'
  thickness: number
  color: ColorValue
  crossesTitleListBoundary: boolean
}

type StaticStructureTrace = {
  kind: 'static-structure-trace-v1'
  candidateId: string
  parent: { width: number; height: number }
  uncoveredTopBand: RelativeBounds
  staticText: StaticTextTrace[]
  separators: SeparatorTrace[]
  occurrences: number
}

export type StaticStructureDiagnosticRecorder = {
  record(element: HTMLElement, token: CompositeToken): void
  finalize(): Promise<void>
}

const transparent: ColorValue = { r: 0, g: 0, b: 0, a: 0 }
const controlSelector = [
  'button', 'input', 'textarea', 'select',
  '[role="button"]', '[role="menuitem"]', '[role="option"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]'
].join(',')

function rounded(value: number): number {
  return Math.round(value * 2) / 2
}

function positivePx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? rounded(parsed) : 0
}

function color(value: string): ColorValue {
  return parseCssColor(value) ?? { ...transparent }
}

function boundsWithin(parent: DOMRect, element: DOMRect): RelativeBounds {
  return {
    x: rounded(element.left - parent.left),
    y: rounded(element.top - parent.top),
    width: rounded(element.width),
    height: rounded(element.height)
  }
}

function containedInBand(bounds: RelativeBounds, band: RelativeBounds): boolean {
  return bounds.x >= -1 && bounds.y >= band.y - 1 &&
    bounds.x + bounds.width <= band.x + band.width + 1 &&
    bounds.y + bounds.height <= band.y + band.height + 1
}

function visible(element: HTMLElement, view: Window): boolean {
  if (!element.isConnected || element.matches('[hidden],[aria-hidden="true"]')) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' || style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') === 0
    ) return false
  }
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0
}

function borderWidths(style: CSSStyleDeclaration): EdgeValues {
  const sides: Array<[keyof EdgeValues, string, string]> = [
    ['top', style.borderTopWidth, style.borderTopStyle],
    ['right', style.borderRightWidth, style.borderRightStyle],
    ['bottom', style.borderBottomWidth, style.borderBottomStyle],
    ['left', style.borderLeftWidth, style.borderLeftStyle]
  ]
  return Object.fromEntries(sides.map(([side, width, kind]) => [
    side, kind === 'none' || kind === 'hidden' ? 0 : positivePx(width)
  ])) as EdgeValues
}

function hasPaint(style: CSSStyleDeclaration): boolean {
  return color(style.backgroundColor).a > 0.05 ||
    Object.values(borderWidths(style)).some(value => value > 0) ||
    (positivePx(style.outlineWidth) > 0 && style.outlineStyle !== 'none') ||
    parseBoxShadow(style.boxShadow).some(layer => layer.color.a > 0.05)
}

function pseudoPaint(
  element: HTMLElement,
  view: Window,
  pseudo: '::before' | '::after'
): boolean {
  if (view.navigator.userAgent.toLowerCase().includes('jsdom')) return false
  try {
    const style = view.getComputedStyle(element, pseudo)
    return style.content !== 'none' && style.content !== 'normal' && hasPaint(style)
  } catch {
    return false
  }
}

function directText(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter((node): node is Text => node.nodeType === node.TEXT_NODE)
    .map(node => node.data.trim())
    .filter(Boolean)
    .join(' ')
}

function textLengthBucket(value: string): StaticTextTrace['textLengthBucket'] {
  if (value.length === 0) return '0'
  if (value.length <= 8) return '1-8'
  if (value.length <= 24) return '9-24'
  if (value.length <= 64) return '25-64'
  return '65+'
}

function semanticCategory(element: HTMLElement): StaticTextTrace['wrapper']['semanticCategory'] {
  const role = element.getAttribute('role')?.trim().toLowerCase()
  if (role === 'dialog' || role === 'alertdialog') return 'dialog'
  if (role === 'menu') return 'menu'
  if (role === 'list' || role === 'listbox') return 'list'
  if (role === 'group') return 'group'
  return 'none'
}

function nearestBoundedWrapper(
  element: HTMLElement,
  parent: HTMLElement,
  parentBounds: DOMRect,
  view: Window
): HTMLElement {
  for (
    let current = element.parentElement;
    current && current !== parent;
    current = current.parentElement
  ) {
    if (!visible(current, view)) continue
    const bounds = current.getBoundingClientRect()
    if (
      bounds.width > 0 && bounds.height > 0 &&
      bounds.left >= parentBounds.left - 1 && bounds.top >= parentBounds.top - 1 &&
      bounds.right <= parentBounds.right + 1 && bounds.bottom <= parentBounds.bottom + 1
    ) return current
  }
  return parent
}

function staticTextCandidates(
  parent: HTMLElement,
  parentBounds: DOMRect,
  band: RelativeBounds,
  view: Window
): Array<{ element: HTMLElement; text: string; placement: RelativeBounds }> {
  const candidates: Array<{ element: HTMLElement; text: string; placement: RelativeBounds }> = []
  const walker = parent.ownerDocument.createTreeWalker(parent, 1)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== 1) continue
    const element = node as HTMLElement
    const text = directText(element)
    if (!text || !visible(element, view)) continue
    const placement = boundsWithin(parentBounds, element.getBoundingClientRect())
    if (!containedInBand(placement, band)) continue
    candidates.push({ element, text, placement })
  }
  return candidates
}

function strictStaticEligible(
  text: string,
  contexts: StaticTextTrace['contexts'],
  singleLine: boolean,
  localPrivacyBlocked: boolean
): boolean {
  return text.length > 0 && text.length <= 32 && isSafeControlSampleTextValue(text) && singleLine &&
    !contexts.control && !contexts.contenteditable &&
    !contexts.authorContent && !localPrivacyBlocked
}

export function staticPrivacyBlockedWithinParent(
  evidence: PrivateControlContextEvidence,
  parent: HTMLElement
): boolean {
  if (evidence.reasons.exception) return true
  for (const reason of Object.keys(evidence.reasons) as PrivateContextReason[]) {
    if (!evidence.reasons[reason]) continue
    const matches = evidence.matches[reason]
    if (!matches || matches.length === 0) return true
    if (matches.some(match => match === parent || parent.contains(match))) return true
  }
  return false
}

function privacyScope(
  source: Element,
  candidate: HTMLElement,
  wrapper: HTMLElement,
  parent: HTMLElement
): PrivacyScope {
  if (source === candidate) return 'self'
  if (source === wrapper) return 'wrapper'
  if (source === parent) return 'parent'
  if (parent.contains(source)) return 'inside-parent'
  return 'outside-parent'
}

function privacyDepthBucket(source: Element, candidate: HTMLElement): PrivacyDepthBucket {
  let depth = 0
  for (let current: Element | null = candidate; current; current = current.parentElement) {
    if (current !== candidate) depth += 1
    if (current === source) {
      if (depth === 0) return '0'
      if (depth <= 2) return '1-2'
      if (depth <= 4) return '3-4'
      return '5+'
    }
  }
  return '5+'
}

function privacyProvenance(
  evidence: PrivateControlContextEvidence,
  candidate: HTMLElement,
  wrapper: HTMLElement,
  parent: HTMLElement
): StaticTextTrace['privacyProvenance'] {
  const sources: StaticTextTrace['privacyProvenance']['sources'] = {}
  const rank: Record<PrivacyScope, number> = {
    self: 0,
    wrapper: 1,
    'inside-parent': 2,
    parent: 3,
    'outside-parent': 4
  }
  for (const reason of Object.keys(evidence.reasons) as PrivateContextReason[]) {
    const matches = evidence.matches[reason] ?? []
    if (!evidence.reasons[reason] || matches.length === 0) continue
    const scoped = matches.map(source => ({
      scope: privacyScope(source, candidate, wrapper, parent),
      depthBucket: privacyDepthBucket(source, candidate)
    }))
    scoped.sort((left, right) => rank[left.scope] - rank[right.scope])
    sources[reason] = scoped[0]!
  }
  return { reasons: evidence.reasons, sources }
}

async function traceStaticText(
  parent: HTMLElement,
  parentBounds: DOMRect,
  band: RelativeBounds,
  view: Window
): Promise<StaticTextTrace[]> {
  return Promise.all(staticTextCandidates(parent, parentBounds, band, view).map(async candidate => {
    const style = view.getComputedStyle(candidate.element)
    const lineHeight = positivePx(style.lineHeight) || positivePx(style.fontSize)
    const singleLine = lineHeight > 0 && candidate.placement.height <= lineHeight * 1.5
    const wrapper = nearestBoundedWrapper(candidate.element, parent, parentBounds, view)
    const privacyEvidence = privateControlContextEvidence(candidate.element)
    const localPrivacyBlocked = staticPrivacyBlockedWithinParent(privacyEvidence, parent)
    const contexts = {
      control: candidate.element.closest(controlSelector) !== null,
      contenteditable: candidate.element.closest('[contenteditable]:not([contenteditable="false"])') !== null,
      authorContent: authorContentRootFor(candidate.element) !== null,
      privateOrIdentity: privacyEvidence.blocked
    }
    const wrapperStyle = view.getComputedStyle(wrapper)
    return {
      nodeId: await anonymousControlLogicalId(parent.ownerDocument, candidate.element),
      placement: candidate.placement,
      visible: true,
      singleLine,
      directRenderedText: true,
      textLengthBucket: textLengthBucket(candidate.text),
      typographySignature: {
        fontSizePx: positivePx(style.fontSize),
        fontWeight: Number.parseFloat(style.fontWeight) || 0,
        lineHeightPx: lineHeight,
        letterSpacingPx: Number.parseFloat(style.letterSpacing) || 0
      },
      foreground: color(style.color),
      contexts,
      privacyProvenance: privacyProvenance(
        privacyEvidence, candidate.element, wrapper, parent
      ),
      strictSafeStaticUiCopyEligible: strictStaticEligible(
        candidate.text, contexts, singleLine, localPrivacyBlocked
      ),
      wrapper: {
        bounds: boundsWithin(parentBounds, wrapper.getBoundingClientRect()),
        padding: {
          top: positivePx(wrapperStyle.paddingTop),
          right: positivePx(wrapperStyle.paddingRight),
          bottom: positivePx(wrapperStyle.paddingBottom),
          left: positivePx(wrapperStyle.paddingLeft)
        },
        background: color(wrapperStyle.backgroundColor),
        borderWidths: borderWidths(wrapperStyle),
        pseudoPaint: {
          before: pseudoPaint(wrapper, view, '::before'),
          after: pseudoPaint(wrapper, view, '::after')
        },
        semanticCategory: semanticCategory(wrapper),
        surfaceCategory: hasPaint(wrapperStyle) ? 'painted' : 'transparent'
      }
    }
  }))
}

function sameBounds(left: RelativeBounds, right: RelativeBounds): boolean {
  return Math.abs(left.x - right.x) <= 1 &&
    Math.abs(left.y - right.y) <= 1 &&
    Math.abs(left.width - right.width) <= 1 &&
    Math.abs(left.height - right.height) <= 1
}

function sameNumber(left: number | null, right: number): boolean {
  return left !== null && Math.abs(left - right) <= 0.5
}

function fontFamilies(raw: string): string[] {
  return raw.split(',')
    .map(value => value.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean)
}

function typographyFor(
  style: CSSStyleDeclaration,
  typography: TypographyStyle[]
): TypographyStyle | undefined {
  const lineHeight = positivePx(style.lineHeight) || positivePx(style.fontSize)
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0
  const families = fontFamilies(style.fontFamily)
  const fontStyle = style.fontStyle === 'italic' || style.fontStyle === 'oblique'
    ? style.fontStyle
    : 'normal'
  return typography.find(token =>
    token.fontStyle === fontStyle &&
    sameNumber(token.fontSizePx, positivePx(style.fontSize)) &&
    token.fontWeight === (Number.parseFloat(style.fontWeight) || 0) &&
    sameNumber(token.lineHeightPx, lineHeight) &&
    Math.abs(token.letterSpacingPx - letterSpacing) <= 0.5 &&
    token.fontFamilyStack.map(value => value.toLowerCase()).join('|') === families.join('|')
  )
}

function appearanceFor(style: CSSStyleDeclaration, borders: EdgeValues) {
  const border = borders.top > 0 ? color(style.borderTopColor) :
    borders.right > 0 ? color(style.borderRightColor) :
      borders.bottom > 0 ? color(style.borderBottomColor) :
        borders.left > 0 ? color(style.borderLeftColor) : { ...transparent }
  const outlineWidth = positivePx(style.outlineWidth)
  const outlineVisible = outlineWidth > 0 &&
    style.outlineStyle !== 'none' && style.outlineStyle !== 'hidden'
  return {
    background: color(style.backgroundColor),
    foreground: color(style.color),
    border,
    outline: outlineVisible ? color(style.outlineColor) : { ...transparent },
    outlineWidth: outlineVisible ? outlineWidth : 0,
    outlineOffset: outlineVisible ? Number.parseFloat(style.outlineOffset) || 0 : 0,
    shadows: parseBoxShadow(style.boxShadow)
  }
}

/**
 * Produces the one already-observed Header region only when the current Composite
 * has a real uncovered top band, a bounded wrapper, and that wrapper's own bottom
 * border. The same trace helpers remain the sole source of static evidence.
 */
export async function collectStaticTextRegions(
  parent: HTMLElement,
  children: CompositeChild[],
  typography: TypographyStyle[]
): Promise<StaticTextRegionChild[]> {
  const view = parent.ownerDocument.defaultView
  if (!view) return []
  const placements = children
    .map(child => child.placement)
    .filter((placement): placement is RelativeBounds => placement !== undefined)
  const nestedCompositeCount = children.filter(child =>
    child.kind === 'composite' && child.placement !== undefined
  ).length
  const top = placements.length > 0 ? Math.min(...placements.map(placement => placement.y)) : 0
  if (nestedCompositeCount < 2 || top <= 0) return []

  const parentBounds = parent.getBoundingClientRect()
  const band = { x: 0, y: 0, width: rounded(parentBounds.width), height: rounded(top) }
  const matches = staticTextCandidates(parent, parentBounds, band, view).map(candidate => {
    const wrapper = nearestBoundedWrapper(candidate.element, parent, parentBounds, view)
    const wrapperBounds = boundsWithin(parentBounds, wrapper.getBoundingClientRect())
    const wrapperStyle = view.getComputedStyle(wrapper)
    const borders = borderWidths(wrapperStyle)
    return { candidate, wrapper, wrapperBounds, wrapperStyle, borders }
  }).filter(match =>
    sameBounds(match.wrapperBounds, band) && match.borders.bottom > 0
  )
  const wrappers = new Map<HTMLElement, typeof matches[number]>()
  for (const match of matches) {
    if (wrappers.has(match.wrapper)) return []
    wrappers.set(match.wrapper, match)
  }
  if (wrappers.size !== 1) return []

  const match = [...wrappers.values()][0]!
  const style = view.getComputedStyle(match.candidate.element)
  const lineHeight = positivePx(style.lineHeight) || positivePx(style.fontSize)
  const singleLine = lineHeight > 0 && match.candidate.placement.height <= lineHeight * 1.5
  const privacyEvidence = privateControlContextEvidence(match.candidate.element)
  const contexts = {
    control: match.candidate.element.closest(controlSelector) !== null,
    contenteditable: match.candidate.element.closest('[contenteditable]:not([contenteditable="false"])') !== null,
    authorContent: authorContentRootFor(match.candidate.element) !== null,
    privateOrIdentity: privacyEvidence.blocked
  }
  const safeCopy = strictStaticEligible(
    match.candidate.text,
    contexts,
    singleLine,
    staticPrivacyBlockedWithinParent(privacyEvidence, parent)
  )
  const typographyToken = safeCopy ? typographyFor(style, typography) : undefined
  const radii = exactControlRadii(
    match.wrapperStyle,
    match.wrapperBounds.width,
    match.wrapperBounds.height
  )
  const geometry = {
    width: match.wrapperBounds.width,
    height: match.wrapperBounds.height,
    padding: {
      top: positivePx(match.wrapperStyle.paddingTop),
      right: positivePx(match.wrapperStyle.paddingRight),
      bottom: positivePx(match.wrapperStyle.paddingBottom),
      left: positivePx(match.wrapperStyle.paddingLeft)
    },
    gap: positivePx(match.wrapperStyle.gap || match.wrapperStyle.rowGap || match.wrapperStyle.columnGap),
    radius: Math.max(radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft),
    borderWidth: Math.max(...Object.values(match.borders)),
    borderWidths: match.borders
  }
  const appearance = appearanceFor(match.wrapperStyle, match.borders)
  const templateId = await stableStaticTextRegionTemplateId({ geometry, appearance })
  const text = typographyToken
    ? {
        source: 'visible-static-ui' as const,
        value: match.candidate.text.trim(),
        placement: match.candidate.placement,
        typographyId: typographyToken.id,
        foreground: color(style.color)
      }
    : undefined
  const instanceId = await stableStaticTextRegionInstanceId({
    templateId,
    value: text?.value ?? null
  })
  return [{
    kind: 'static-text-region',
    templateId,
    instanceId,
    placement: match.wrapperBounds,
    geometry,
    appearance,
    ...(text ? { text } : {})
  }]
}

function separatorTrace(
  element: HTMLElement,
  parentBounds: DOMRect,
  band: RelativeBounds,
  style: CSSStyleDeclaration,
  source: SeparatorTrace['source'],
  thickness: number,
  colorValue: ColorValue
): SeparatorTrace | null {
  const placement = boundsWithin(parentBounds, element.getBoundingClientRect())
  const boundary = band.y + band.height
  const crossesTitleListBoundary = Math.abs(placement.y + placement.height - boundary) <= 2 ||
    Math.abs(placement.y - boundary) <= 2
  if (!crossesTitleListBoundary || thickness <= 0) return null
  return {
    source,
    placement: {
      ...placement,
      y: source === 'wrapper-border-bottom' ? rounded(boundary - thickness) : placement.y,
      height: source === 'wrapper-border-bottom' ? thickness : placement.height
    },
    orientation: 'horizontal',
    thickness,
    color: colorValue,
    crossesTitleListBoundary
  }
}

function separators(
  parent: HTMLElement,
  parentBounds: DOMRect,
  band: RelativeBounds,
  view: Window
): SeparatorTrace[] {
  const rows: SeparatorTrace[] = []
  const elements = Array.from(parent.querySelectorAll<HTMLElement>('*'))
  for (const element of elements) {
    if (!visible(element, view)) continue
    const style = view.getComputedStyle(element)
    const border = positivePx(style.borderBottomWidth)
    const borderTrace = separatorTrace(
      element, parentBounds, band, style, 'wrapper-border-bottom', border, color(style.borderBottomColor)
    )
    if (borderTrace) rows.push(borderTrace)

    const bounds = boundsWithin(parentBounds, element.getBoundingClientRect())
    const boundary = band.y + band.height
    if (
      bounds.width >= band.width - 2 && bounds.height > 0 && bounds.height <= 4 &&
      Math.abs(bounds.y - boundary) <= 2
    ) rows.push({
      source: 'standalone-element', placement: bounds, orientation: 'horizontal',
      thickness: bounds.height, color: color(style.backgroundColor),
      crossesTitleListBoundary: true
    })
  }
  return rows.length > 0 ? rows : [{
    source: 'none', placement: { x: 0, y: band.y + band.height, width: band.width, height: 0 },
    orientation: 'horizontal', thickness: 0, color: { ...transparent }, crossesTitleListBoundary: false
  }]
}

export function createStaticStructureDiagnosticRecorder(): StaticStructureDiagnosticRecorder {
  const pending: Array<Promise<Omit<StaticStructureTrace, 'occurrences'> | null>> = []
  return {
    record(element, token) {
      const view = element.ownerDocument.defaultView
      const placements = token.children
        .map(child => child.placement)
        .filter((placement): placement is RelativeBounds => placement !== undefined)
      const nestedCompositeCount = token.children.filter(child =>
        child.kind === 'composite' && child.placement !== undefined
      ).length
      const top = placements.length > 0 ? Math.min(...placements.map(placement => placement.y)) : 0
      if (
        !view || nestedCompositeCount < 2 || top <= 0 || top >= token.geometry.height
      ) return
      const parentBounds = element.getBoundingClientRect()
      const band = { x: 0, y: 0, width: rounded(parentBounds.width), height: rounded(top) }
      pending.push(traceStaticText(element, parentBounds, band, view)
        .then(staticText => ({
          kind: 'static-structure-trace-v1' as const,
          candidateId: token.logicalCompositeId,
          parent: { width: rounded(parentBounds.width), height: rounded(parentBounds.height) },
          uncoveredTopBand: band,
          staticText,
          separators: separators(element, parentBounds, band, view)
        }))
        .catch(() => null))
    },
    async finalize() {
      const rows = new Map<string, StaticStructureTrace>()
      for (const incoming of await Promise.all(pending)) {
        if (!incoming) continue
        const key = JSON.stringify(incoming)
        const existing = rows.get(key)
        rows.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...incoming, occurrences: 1 })
      }
      for (const row of [...rows.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )) console.info(JSON.stringify(row))
    }
  }
}
