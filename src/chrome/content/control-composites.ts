import type {
  ColorValue,
  CompositeChild,
  CompositeKind,
  CompositeLayout,
  CompositeState,
  CompositeToken,
  TypographyStyle
} from '../../shared/schema'
import {
  stableCompositeId,
  stableCompositeLogicalId,
  stableCompositeTemplateId,
  type CompositeSignature
} from '../../shared/stable-id'
import { parseCssColor } from './colors'
import { authorContentRootFor } from './content-payload'
import { exactControlRadii } from './control-surface'
import type { ControlObservation } from './controls'
import type { CompositeDiagnosticRecorder } from './composite-diagnostics'
import {
  collectStaticTextRegions,
  type StaticStructureDiagnosticRecorder
} from './static-structure-diagnostics'
import { HOVER_PROBE_ATTRIBUTE } from './hover-state-explorer'
import { parseBoxShadow } from './shadows'
import {
  TRANSIENT_OWNER_ATTRIBUTE,
  TRANSIENT_STRUCTURE_ATTRIBUTE
} from './state-explorer'
import { isExcludedVisualAsset } from './visual-assets'

const transparent: ColorValue = { r: 0, g: 0, b: 0, a: 0 }
const MAX_COMPOSITE_CHILDREN = 128
const MAX_COMPOSITE_NESTING_DEPTH = 3
const blockedContainerSelector = [
  'html', 'body', 'main', 'article', 'nav', 'header', 'footer',
  '[role="main"]', '[role="article"]', '[role="navigation"]',
  '[role="document"]', '[role="feed"]'
].join(',')

export type CompositeCandidate = {
  element: HTMLElement
  kind: CompositeKind
  depth: number
  allowsSingleChild: boolean
}

type BuiltComposite = {
  element: HTMLElement
  token: CompositeToken
  depth: number
  candidate: CompositeCandidate
  directControlInteractions: readonly HTMLElement[]
  directNestedCompositeElements: readonly HTMLElement[]
}

type CompositeMembership = {
  nested: BuiltComposite[]
  controls: ControlObservation[]
}

/**
 * Internal-only structure discovered from the same raw observations used by a
 * rendered-state sample. It is deliberately not a product Composite token:
 * normalized control ids are bound only during the later materialization.
 */
export type ControlCompositePedigree = {
  candidates: readonly CompositeCandidate[]
  entries: readonly ControlCompositePedigreeEntry[]
  directOptionsByObservation: ReadonlyMap<
    ControlObservation,
    readonly ControlObservation[]
  >
  directOptionGroupByObservation: ReadonlyMap<
    ControlObservation,
    HTMLElement
  >
}

export type ControlCompositePedigreeEntry = {
  /** Existing DOM boundary reference used only while this sample is in memory. */
  element: HTMLElement
  candidate: CompositeCandidate
  /** Internal hierarchy depth only; never becomes a product token field. */
  depth: number
  directControlInteractions: readonly HTMLElement[]
  directNestedCompositeElements: readonly HTMLElement[]
}

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

function normalizedHalfPixel(value: number): number {
  return Math.round(value * 2) / 2
}

function px(raw: string | null | undefined): number {
  const value = Number.parseFloat(raw ?? '')
  return Number.isFinite(value) && value > 0 ? normalizedNumber(value) : 0
}

function color(raw: string): ColorValue {
  return parseCssColor(raw) ?? { ...transparent }
}

type CompositeBorderWidths = {
  top: number
  right: number
  bottom: number
  left: number
}

function visibleBorderWidths(style: CSSStyleDeclaration): CompositeBorderWidths {
  const widths = {
    top: px(style.borderTopWidth),
    right: px(style.borderRightWidth),
    bottom: px(style.borderBottomWidth),
    left: px(style.borderLeftWidth)
  }
  const styles = [
    style.borderTopStyle,
    style.borderRightStyle,
    style.borderBottomStyle,
    style.borderLeftStyle
  ]
  return Object.fromEntries(
    (Object.entries(widths) as Array<[keyof CompositeBorderWidths, number]>).map(
      ([side, width], index) => [
        side,
        styles[index] === 'none' || styles[index] === 'hidden' ? 0 : width
      ]
    )
  ) as CompositeBorderWidths
}

function visibleBorderWidth(style: CSSStyleDeclaration): number {
  return normalizedNumber(Math.max(0, ...Object.values(visibleBorderWidths(style))))
}

function visibleBorderColor(
  style: CSSStyleDeclaration,
  widths: CompositeBorderWidths
): ColorValue {
  const sides: Array<[keyof CompositeBorderWidths, string]> = [
    ['top', style.borderTopColor],
    ['right', style.borderRightColor],
    ['bottom', style.borderBottomColor],
    ['left', style.borderLeftColor]
  ]
  for (const [side, raw] of sides) {
    if (widths[side] <= 0) continue
    const parsed = color(raw)
    if (parsed.a > 0) return parsed
  }
  return { ...transparent }
}

function isVisible(element: HTMLElement, view: Window): boolean {
  if (!element.isConnected || element.matches('[hidden],[aria-hidden="true"]')) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
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

function hasPaintedSurface(style: CSSStyleDeclaration): boolean {
  const outlineWidth = px(style.outlineWidth)
  return color(style.backgroundColor).a > 0.05 ||
    visibleBorderWidth(style) > 0 ||
    (
      outlineWidth > 0 &&
      style.outlineStyle !== 'none' &&
      style.outlineStyle !== 'hidden' &&
      color(style.outlineColor).a > 0.05
    ) ||
    parseBoxShadow(style.boxShadow).some(layer => layer.color.a > 0.05)
}

function semanticKind(element: HTMLElement): CompositeKind | null {
  const role = element.getAttribute('role')?.trim().toLowerCase()
  if (role === 'menu') return 'menu'
  if (role === 'list' || role === 'listbox' || ['ul', 'ol'].includes(element.tagName.toLowerCase())) {
    return 'list'
  }
  if (role === 'toolbar') return 'toolbar'
  if (role === 'dialog' || role === 'alertdialog') return 'popover'
  if (role === 'group' || role === 'tablist') return 'control-group'
  if (role === 'navigation' || element.tagName.toLowerCase() === 'nav') return 'panel'
  if (['aside', 'section'].includes(element.tagName.toLowerCase())) return 'panel'
  return null
}

function hasShallowMenuStructure(element: HTMLElement): boolean {
  let frontier = Array.from(element.children).filter(
    (child): child is HTMLElement => child instanceof element.ownerDocument.defaultView!.HTMLElement
  )
  for (let depth = 0; depth < 2; depth += 1) {
    const next: HTMLElement[] = []
    for (const child of frontier) {
      const kind = semanticKind(child)
      if (kind === 'menu' || kind === 'list') return true
      next.push(...Array.from(child.children).filter(
        (nested): nested is HTMLElement => nested instanceof element.ownerDocument.defaultView!.HTMLElement
      ))
    }
    frontier = next
  }
  return false
}

function inferredKind(
  element: HTMLElement,
  style: CSSStyleDeclaration
): CompositeKind | null {
  const semantic = semanticKind(element)
  if (semantic) return semantic
  if (hasPaintedSurface(style)) {
    if (style.display === 'flex' || style.display === 'inline-flex' || style.display === 'grid') {
      return 'control-group'
    }
    if (
      (style.position === 'absolute' || style.position === 'fixed') &&
      hasShallowMenuStructure(element)
    ) {
      return 'popover'
    }
  }
  return null
}

function isPageScale(element: HTMLElement, view: Window): boolean {
  const bounds = element.getBoundingClientRect()
  return bounds.width >= Math.max(720, view.innerWidth * 0.88) &&
    bounds.height >= Math.max(480, view.innerHeight * 0.72)
}

function hasUnboundedAxis(element: HTMLElement, view: Window): boolean {
  const bounds = element.getBoundingClientRect()
  return bounds.width > Math.max(4096, Math.max(1, view.innerWidth) * 4) ||
    bounds.height > Math.max(4096, Math.max(1, view.innerHeight) * 4)
}

function containsNativeFileTarget(element: HTMLElement): boolean {
  if (element.matches('input[type="file"],label')) {
    if (element.matches('input[type="file"]') || element.querySelector('input[type="file"]')) {
      return true
    }
    const targetId = element.getAttribute('for')
    if (targetId) {
      const target = element.ownerDocument.getElementById(targetId)
      if (target?.matches('input[type="file"]')) return true
    }
  }
  return element.querySelector('input[type="file"]') !== null
}

function elementDepth(element: Element): number {
  let depth = 0
  for (let current = element.parentElement; current; current = current.parentElement) depth += 1
  return depth
}

function containmentElement(observation: ControlObservation): HTMLElement {
  return observation.ownership.compositeAnchor
}

function placementElement(observation: ControlObservation): HTMLElement {
  return observation.ownership.layout
}

function containedObservations(
  container: HTMLElement,
  observations: ControlObservation[]
): ControlObservation[] {
  return observations.filter(observation => {
    const owner = containmentElement(observation)
    return owner !== container && container.contains(owner)
  })
}

function topLevelObservations(
  container: HTMLElement,
  observations: ControlObservation[]
): ControlObservation[] {
  const contained = containedObservations(container, observations)
  return contained.filter(observation => !contained.some(other =>
    other !== observation &&
    containmentElement(other) !== containmentElement(observation) &&
    containmentElement(other).contains(containmentElement(observation))
  ))
}

function hasDiagnosticTransientEvidence(
  element: HTMLElement,
  observations: ControlObservation[]
): boolean {
  if (
    element.getAttribute(TRANSIENT_STRUCTURE_ATTRIBUTE) === 'true' ||
    element.hasAttribute(TRANSIENT_OWNER_ATTRIBUTE)
  ) return true
  const owned = topLevelObservations(element, observations)
  if (owned.length === 0) return false
  return Array.from(element.querySelectorAll<HTMLElement>([
    `[${TRANSIENT_STRUCTURE_ATTRIBUTE}="true"]`,
    `[${TRANSIENT_OWNER_ATTRIBUTE}]`
  ].join(','))).some(transient =>
    owned.every(observation => transient.contains(containmentElement(observation)))
  )
}

function declaredPadding(style: CSSStyleDeclaration): CompositeToken['geometry']['padding'] {
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft)
  }
}

function isStructuralSingleChildWrapper(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  childElement: HTMLElement
): boolean {
  const padding = declaredPadding(style)
  if (
    padding.left + padding.right <= 0 ||
    padding.top + padding.bottom <= 0
  ) return false
  if (!semanticKind(element) && !hasPaintedSurface(style)) return false

  const container = element.getBoundingClientRect()
  const child = childElement.getBoundingClientRect()
  if (
    child.width <= 0 ||
    child.height <= 0 ||
    child.left < container.left - 1 ||
    child.top < container.top - 1 ||
    child.right > container.right + 1 ||
    child.bottom > container.bottom + 1
  ) return false

  const observed = {
    top: child.top - container.top,
    right: container.right - child.right,
    bottom: container.bottom - child.bottom,
    left: child.left - container.left
  }
  const matches = (side: keyof typeof padding): boolean =>
    Math.abs(observed[side] - padding[side]) <= 2
  return matches('top') && matches('right') && matches('bottom') && matches('left')
}

function isStructuralSingleControlWrapper(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  observation: ControlObservation
): boolean {
  return isStructuralSingleChildWrapper(
    element,
    style,
    containmentElement(observation)
  )
}

function addsPaintedShellEvidence(
  shell: CSSStyleDeclaration,
  child: CSSStyleDeclaration
): boolean {
  const shellBackground = color(shell.backgroundColor)
  const childBackground = color(child.backgroundColor)
  const differentBackground = shellBackground.a > 0.05 && (
    childBackground.a <= 0.05 ||
    Math.abs(shellBackground.r - childBackground.r) > 0.01 ||
    Math.abs(shellBackground.g - childBackground.g) > 0.01 ||
    Math.abs(shellBackground.b - childBackground.b) > 0.01 ||
    Math.abs(shellBackground.a - childBackground.a) > 0.01
  )
  const shellOutline = px(shell.outlineWidth) > 0 &&
    shell.outlineStyle !== 'none' &&
    shell.outlineStyle !== 'hidden' &&
    color(shell.outlineColor).a > 0.05
  const childOutline = px(child.outlineWidth) > 0 &&
    child.outlineStyle !== 'none' &&
    child.outlineStyle !== 'hidden' &&
    color(child.outlineColor).a > 0.05
  return differentBackground ||
    visibleBorderWidth(shell) > visibleBorderWidth(child) + 0.1 ||
    (shellOutline && !childOutline) ||
    parseBoxShadow(shell.boxShadow).some(layer => layer.color.a > 0.05) &&
      !parseBoxShadow(child.boxShadow).some(layer => layer.color.a > 0.05)
}

function isEdgeToEdgePaintedNestedCompositeShell(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  childElement: HTMLElement,
  view: Window
): boolean {
  if (!hasPaintedSurface(style)) return false
  const childStyle = view.getComputedStyle(childElement)
  if (!addsPaintedShellEvidence(style, childStyle)) return false
  const padding = declaredPadding(style)
  const container = element.getBoundingClientRect()
  const child = childElement.getBoundingClientRect()
  if (
    child.width <= 0 ||
    child.height <= 0 ||
    child.left < container.left - 1 ||
    child.top < container.top - 1 ||
    child.right > container.right + 1 ||
    child.bottom > container.bottom + 1
  ) return false
  const observed = {
    top: child.top - container.top,
    right: container.right - child.right,
    bottom: container.bottom - child.bottom,
    left: child.left - container.left
  }
  return (Object.keys(padding) as Array<keyof typeof padding>).every(side =>
    Math.abs(observed[side] - padding[side]) <= 2
  )
}

function hasPotentialEdgeToEdgeNestedComposite(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  observation: ControlObservation,
  view: Window
): boolean {
  let current = containmentElement(observation).parentElement
  while (current && current !== element) {
    const currentStyle = view.getComputedStyle(current)
    if (
      inferredKind(current, currentStyle) &&
      isEdgeToEdgePaintedNestedCompositeShell(element, style, current, view)
    ) return true
    current = current.parentElement
  }
  return false
}

function candidateContainers(
  document: Document,
  observations: ControlObservation[],
  diagnostics?: CompositeDiagnosticRecorder
): CompositeCandidate[] {
  const view = document.defaultView
  if (!view) return []
  const elements = new Set<HTMLElement>(
    document.querySelectorAll<HTMLElement>(
      [
        `[${TRANSIENT_STRUCTURE_ATTRIBUTE}="true"]`,
        `[${TRANSIENT_OWNER_ATTRIBUTE}]`
      ].join(',')
    )
  )
  for (const observation of observations) {
    let current = containmentElement(observation).parentElement
    for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
      elements.add(current)
    }
  }
  return [...elements].flatMap(element => {
    const transientStructure = element.getAttribute(
      TRANSIENT_STRUCTURE_ATTRIBUTE
    ) === 'true'
    const transientOwner = element.hasAttribute(TRANSIENT_OWNER_ATTRIBUTE)
    const transientEvidence = transientStructure || transientOwner
    const owned = topLevelObservations(element, observations)
    const diagnosticTransientEvidence = hasDiagnosticTransientEvidence(element, observations)
    const reject = (reason: Parameters<CompositeDiagnosticRecorder['record']>[2]) => {
      if (diagnosticTransientEvidence) diagnostics?.record(element, owned, reason)
      return []
    }
    if (element.matches(blockedContainerSelector) && !transientEvidence) {
      return reject('blocked-container')
    }
    if (!isVisible(element, view)) return reject('not-visible')
    if (isPageScale(element, view)) return reject('page-scale')
    if (hasUnboundedAxis(element, view)) return reject('unbounded-axis')
    if (isExcludedVisualAsset(element)) return reject('excluded-visual-asset')
    if (authorContentRootFor(element) === element) return reject('author-content-root')
    if (containsNativeFileTarget(element) && !transientEvidence) {
      return reject('native-file-target')
    }
    const style = view.getComputedStyle(element)
    const semantic = semanticKind(element)
    if (!semantic && !hasPaintedSurface(style)) {
      return reject('no-semantic-or-surface')
    }
    const allowsSingleChild = owned.length === 1 &&
      isStructuralSingleControlWrapper(element, style, owned[0]!)
    const mayWrapNestedComposite = owned.length === 1 &&
      hasPotentialEdgeToEdgeNestedComposite(element, style, owned[0]!, view)
    const kind = inferredKind(element, style) ??
      (allowsSingleChild ? 'control-group' : null)
    if (!kind) return reject('insufficient-owned-children')
    if (!allowsSingleChild && !mayWrapNestedComposite && owned.length < 2) {
      return reject('insufficient-owned-children')
    }
    if (owned.length > MAX_COMPOSITE_CHILDREN) {
      return reject('too-many-owned-children')
    }
    return [{ element, kind, depth: elementDepth(element), allowsSingleChild }]
  }).sort((left, right) => right.depth - left.depth)
}

function explicitCompositeState(element: HTMLElement): CompositeState {
  if (element.getAttribute('aria-disabled') === 'true') return 'disabled'
  if (element.getAttribute('aria-expanded') === 'true') return 'expanded'
  if (
    element.getAttribute('aria-selected') === 'true' ||
    element.getAttribute('aria-checked') === 'true'
  ) return 'selected'
  if (element.hasAttribute(HOVER_PROBE_ATTRIBUTE)) return 'hover'
  return 'default'
}

function compositeState(element: HTMLElement): CompositeState {
  return explicitCompositeState(element)
}

function mapAlign(
  value: string,
  stretchesByDefault: boolean
): CompositeLayout['align'] {
  if (value === 'center') return 'center'
  if (value === 'flex-end' || value === 'end') return 'end'
  if (value === 'stretch' || (value === 'normal' && stretchesByDefault)) return 'stretch'
  return 'start'
}

function mapJustify(value: string): CompositeLayout['justify'] {
  if (value === 'center') return 'center'
  if (value === 'flex-end' || value === 'end') return 'end'
  if (value === 'space-between') return 'space-between'
  return 'start'
}

function measuredSingleAxisDirection(
  elements: HTMLElement[]
): CompositeLayout['direction'] | null {
  const rects = elements
    .map(element => element.getBoundingClientRect())
    .filter(rect => rect.width > 0 && rect.height > 0)
  if (rects.length < 2) return null
  const centers = rects.map(rect => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  }))
  const monotonicX = centers.slice(1).every((center, index) =>
    center.x > centers[index]!.x + 1
  )
  const monotonicY = centers.slice(1).every((center, index) =>
    center.y > centers[index]!.y + 1
  )
  const xValues = centers.map(center => center.x)
  const yValues = centers.map(center => center.y)
  const xSpread = Math.max(...xValues) - Math.min(...xValues)
  const ySpread = Math.max(...yValues) - Math.min(...yValues)
  const crossAxisXTolerance = Math.max(2, Math.min(...rects.map(rect => rect.width)) / 2)
  const crossAxisYTolerance = Math.max(2, Math.min(...rects.map(rect => rect.height)) / 2)
  if (monotonicY && xSpread <= crossAxisXTolerance) return 'vertical'
  if (monotonicX && ySpread <= crossAxisYTolerance) return 'horizontal'
  return null
}

function compositeLayout(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  childElements: HTMLElement[]
): CompositeLayout {
  const role = element.getAttribute('role')?.trim().toLowerCase()
  const verticalRole = role === 'menu' || role === 'list' || role === 'listbox' ||
    role === 'dialog' || role === 'alertdialog'
  const flexLayout = style.display === 'flex' || style.display === 'inline-flex'
  const declaredDirection = style.display === 'grid'
    ? style.gridAutoFlow.startsWith('column') ? 'horizontal' : 'vertical'
    : flexLayout
      ? style.flexDirection.startsWith('column') ? 'vertical' : 'horizontal'
      : verticalRole ? 'vertical' : 'horizontal'
  const direction = measuredSingleAxisDirection(childElements) ?? declaredDirection
  const bounds = element.getBoundingClientRect()
  const parentBounds = element.parentElement?.getBoundingClientRect()
  const fillsParent = Boolean(
    parentBounds && parentBounds.width > 0 && bounds.width >= parentBounds.width * 0.9
  )
  return {
    direction,
    align: mapAlign(style.alignItems, flexLayout || style.display === 'grid'),
    justify: mapJustify(style.justifyContent),
    wrap: style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse',
    widthBehavior: style.width.includes('%') || fillsParent ? 'fill' : 'hug',
    clipsContent: (
      ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX) ||
      ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY) ||
      element.scrollWidth > element.clientWidth + 1 ||
      element.scrollHeight > element.clientHeight + 1
    )
  }
}

function hasSubstantiveSurface(
  appearance: CompositeToken['appearance'],
  borderWidth: number
): boolean {
  return appearance.background.a > 0.05 ||
    (borderWidth > 0 && appearance.border.a > 0.05) ||
    (appearance.outlineWidth > 0 && appearance.outline.a > 0.05) ||
    appearance.shadows.some(shadow => shadow.color.a > 0.05)
}

function isLightweightTextControl(observation: ControlObservation): boolean {
  const token = observation.token
  return token.content.kind === 'text-only' &&
    token.slots.leading === null &&
    token.slots.trailing === null &&
    token.geometry.borderWidth === 0 &&
    !hasSubstantiveSurface(token.appearance, token.geometry.borderWidth)
}

function isBareWideRepeatedList(
  candidate: CompositeCandidate,
  items: Array<{
    kind: 'composite' | 'control'
    observation?: ControlObservation
  }>,
  geometry: CompositeToken['geometry'],
  appearance: CompositeToken['appearance'],
  layout: CompositeLayout
): boolean {
  if (
    candidate.kind !== 'list' ||
    layout.widthBehavior !== 'fill' ||
    geometry.height <= 0 ||
    geometry.width / geometry.height < 8 ||
    layout.clipsContent ||
    hasSubstantiveSurface(appearance, geometry.borderWidth)
  ) return false
  const padding = Object.values(geometry.padding)
  if (Math.max(...padding) > 8) {
    return false
  }
  const controls = items.flatMap(item =>
    item.kind === 'control' && item.observation ? [item.observation] : []
  )
  if (controls.length !== items.length || controls.length < 2) return false
  if (!controls.every(isLightweightTextControl)) return false
  return new Set(controls.map(observation =>
    observation.token.templateId ?? observation.token.groupId
  )).size === 1
}

function structuralSegment(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute('role')?.trim().toLowerCase()
  const semantic = role ? `${tag}[role=${role}]` : tag
  const peers = element.parentElement
    ? Array.from(element.parentElement.children).filter(peer =>
        peer.tagName.toLowerCase() === tag &&
        peer.getAttribute('role')?.trim().toLowerCase() === role
      )
    : [element]
  return `${semantic}:${Math.max(0, peers.indexOf(element))}`
}

function structuralLocator(element: HTMLElement): string {
  const transientOwner = element.closest<HTMLElement>(
    `[${TRANSIENT_OWNER_ATTRIBUTE}]`
  )
  const ownerId = transientOwner?.getAttribute(TRANSIENT_OWNER_ATTRIBUTE)?.trim()
  const hasOpaqueOwner = /^sha256:[a-f0-9]{64}$/i.test(ownerId ?? '')
  const segments: string[] = []
  let current: Element | null = element
  for (let depth = 0; current && depth < 6; depth += 1) {
    segments.push(structuralSegment(current))
    if (
      current === element.ownerDocument.body ||
      (hasOpaqueOwner && current === transientOwner)
    ) break
    current = current.parentElement
  }
  const relative = segments.reverse().join('>')
  return hasOpaqueOwner ? `transient:${ownerId}>${relative}` : relative
}

function compareDomOrder(
  left: { element: HTMLElement },
  right: { element: HTMLElement }
): number {
  if (left.element === right.element) return 0
  const position = left.element.compareDocumentPosition(right.element)
  const view = left.element.ownerDocument.defaultView
  const following = view?.Node.DOCUMENT_POSITION_FOLLOWING ?? 4
  const preceding = view?.Node.DOCUMENT_POSITION_PRECEDING ?? 2
  if (position & following) return -1
  if (position & preceding) return 1
  const leftBounds = left.element.getBoundingClientRect()
  const rightBounds = right.element.getBoundingClientRect()
  return leftBounds.top - rightBounds.top || leftBounds.left - rightBounds.left
}

function directNestedComposites<T extends { element: HTMLElement }>(
  container: HTMLElement,
  built: readonly T[]
): T[] {
  const contained = built.filter(entry =>
    entry.element !== container && container.contains(entry.element)
  )
  return contained.filter(entry => !contained.some(other =>
    other !== entry && other.element.contains(entry.element)
  ))
}

function directControlObservations(
  container: HTMLElement,
  observations: ControlObservation[],
  nested: readonly { element: HTMLElement }[]
): ControlObservation[] {
  return topLevelObservations(container, observations).filter(observation =>
    !nested.some(entry => entry.element.contains(containmentElement(observation)))
  )
}

/**
 * Applies the existing non-product Composite acceptance facts before control
 * state normalization. The returned entry intentionally carries only DOM
 * structure: no product children, static regions, appearance, geometry, or
 * stable Composite identity is materialized at this stage.
 */
function discoverCompositePedigreeEntry(
  document: Document,
  candidate: CompositeCandidate,
  observations: ControlObservation[],
  built: readonly ControlCompositePedigreeEntry[]
): ControlCompositePedigreeEntry | null {
  const view = document.defaultView
  if (!view) return null
  const nested = directNestedComposites(candidate.element, built)
  const controls = directControlObservations(candidate.element, observations, nested)
  const items = [
    ...nested.map(entry => ({
      kind: 'composite' as const,
      element: entry.candidate.element,
      composite: entry
    })),
    ...controls.map(observation => ({
      kind: 'control' as const,
      element: placementElement(observation),
      observation
    }))
  ].sort(compareDomOrder)
  const style = view.getComputedStyle(candidate.element)
  const allowsNestedShell = items.length === 1 &&
    nested.length === 1 &&
    controls.length === 0 &&
    (
      isStructuralSingleChildWrapper(
        candidate.element,
        style,
        nested[0]!.candidate.element
      ) ||
      isEdgeToEdgePaintedNestedCompositeShell(
        candidate.element,
        style,
        nested[0]!.candidate.element,
        view
      )
    )
  if (
    (
      items.length < 2 &&
      !(candidate.allowsSingleChild && items.length === 1) &&
      !allowsNestedShell
    ) ||
    items.length > MAX_COMPOSITE_CHILDREN
  ) return null
  const nestedDepth = nested.length > 0 ? 1 + Math.max(...nested.map(entry => entry.depth)) : 1
  if (nestedDepth > MAX_COMPOSITE_NESTING_DEPTH) return null

  // The existing wide repeated-list rejection is an acceptance fact, not a
  // product token. Calculate it locally and discard the presentation values.
  const bounds = candidate.element.getBoundingClientRect()
  const borderWidths = visibleBorderWidths(style)
  const borderWidth = normalizedNumber(Math.max(0, ...Object.values(borderWidths)))
  const outlineWidth = px(style.outlineWidth)
  const outlineVisible = outlineWidth > 0 &&
    style.outlineStyle !== 'none' && style.outlineStyle !== 'hidden'
  const appearance = {
    background: color(style.backgroundColor),
    foreground: color(style.color),
    border: borderWidth > 0 ? visibleBorderColor(style, borderWidths) : { ...transparent },
    outline: outlineVisible ? color(style.outlineColor) : { ...transparent },
    outlineWidth: outlineVisible ? outlineWidth : 0,
    outlineOffset: outlineVisible
      ? normalizedNumber(Number.parseFloat(style.outlineOffset) || 0)
      : 0,
    shadows: parseBoxShadow(style.boxShadow)
  }
  const radii = exactControlRadii(style, bounds.width, bounds.height)
  const declared = declaredPadding(style)
  const borderValues = Object.values(borderWidths)
  const hasAsymmetricBorders = borderValues.some(width => width !== borderValues[0])
  const geometry = {
    width: normalizedNumber(bounds.width),
    height: normalizedNumber(bounds.height),
    padding: geometricPadding(bounds, items, declared),
    gap: px(style.gap || style.rowGap || style.columnGap),
    radius: Math.max(
      radii.topLeft,
      radii.topRight,
      radii.bottomRight,
      radii.bottomLeft
    ),
    borderWidth,
    ...(hasAsymmetricBorders ? { borderWidths } : {})
  }
  const layout = compositeLayout(
    candidate.element,
    style,
    items.map(item => item.element)
  )
  if (isBareWideRepeatedList(candidate, items, geometry, appearance, layout)) return null

  return {
    element: candidate.element,
    candidate,
    depth: nestedDepth,
    // Preserve the membership source in the exact canonical child order used
    // later by the product materializer. This remains internal-only: no
    // Composite token, ID, or static product region is created here.
    directControlInteractions: items.flatMap(item =>
      item.kind === 'control' ? [item.observation.ownership.interaction] : []
    ),
    directNestedCompositeElements: items.flatMap(item =>
      item.kind === 'composite' ? [item.composite.candidate.element] : []
    )
  }
}

function geometricPadding(
  container: DOMRect,
  items: Array<{ element: HTMLElement }>,
  declared: CompositeToken['geometry']['padding']
): CompositeToken['geometry']['padding'] {
  const bounds = items.map(item => item.element.getBoundingClientRect()).filter(rect =>
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > container.left &&
    rect.left < container.right &&
    rect.bottom > container.top &&
    rect.top < container.bottom
  )
  if (bounds.length < 2) return declared
  const inferred = {
    top: Math.min(...bounds.map(rect => Math.max(0, rect.top - container.top))),
    right: Math.min(...bounds.map(rect => Math.max(0, container.right - rect.right))),
    bottom: Math.min(...bounds.map(rect => Math.max(0, container.bottom - rect.bottom))),
    left: Math.min(...bounds.map(rect => Math.max(0, rect.left - container.left)))
  }
  const resolve = (side: keyof typeof declared, axis: number): number => {
    if (declared[side] > 0) return declared[side]
    const value = inferred[side]
    if (value < 0.5 || value > Math.min(256, axis / 2)) return 0
    return normalizedNumber(value)
  }
  return {
    top: resolve('top', container.height),
    right: resolve('right', container.width),
    bottom: resolve('bottom', container.height),
    left: resolve('left', container.width)
  }
}

function childPlacement(
  container: DOMRect,
  element: HTMLElement
): { x: number; y: number; width: number; height: number } | undefined {
  const bounds = element.getBoundingClientRect()
  if (
    ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) return undefined
  const rawX = bounds.left - container.left
  const rawY = bounds.top - container.top
  if (
    rawX < -2 ||
    rawY < -2 ||
    rawX + bounds.width > container.width + 2 ||
    rawY + bounds.height > container.height + 2
  ) return undefined
  return {
    x: normalizedHalfPixel(Math.max(0, rawX)),
    y: normalizedHalfPixel(Math.max(0, rawY)),
    width: normalizedHalfPixel(bounds.width),
    height: normalizedHalfPixel(bounds.height)
  }
}

async function buildComposite(
  document: Document,
  candidate: CompositeCandidate,
  observations: ControlObservation[],
  built: BuiltComposite[],
  typography: TypographyStyle[],
  membership?: CompositeMembership
): Promise<BuiltComposite | null> {
  const view = document.defaultView
  if (!view) return null
  const nested = membership?.nested ?? directNestedComposites(candidate.element, built)
  const controls = membership?.controls ?? directControlObservations(candidate.element, observations, nested)
  const items = [
    ...nested.map(entry => ({ kind: 'composite' as const, element: entry.element, entry })),
    ...controls.map(observation => ({
      kind: 'control' as const,
      element: placementElement(observation),
      observation
    }))
  ].sort(compareDomOrder)
  const bounds = candidate.element.getBoundingClientRect()
  const baseChildren: CompositeChild[] = items.map(item => {
    const placement = childPlacement(bounds, item.element)
    return item.kind === 'composite'
      ? {
          kind: 'composite' as const,
          compositeId: item.entry.token.id,
          ...(placement ? { placement } : {})
        }
      : {
          kind: 'control' as const,
          controlId: item.observation.token.id,
          instanceId: item.observation.token.instanceId ?? item.observation.token.id,
          state: item.observation.token.state,
          ...(placement ? { placement } : {})
        }
  })
  const staticRegions = await collectStaticTextRegions(
    candidate.element,
    baseChildren,
    typography
  )
  // Child order is the canonical DOM/instance order. Placement is viewport
  // evidence only; sorting by it would rotate a clipped list as the viewport
  // changes and break exact instance bindings. Static regions are collected
  // in their own canonical order and remain before the content children.
  const children = [...staticRegions, ...baseChildren]
  const style = view.getComputedStyle(candidate.element)
  const allowsNestedShell = items.length === 1 &&
    nested.length === 1 &&
    controls.length === 0 &&
    (
      isStructuralSingleChildWrapper(
        candidate.element,
        style,
        nested[0]!.element
      ) ||
      isEdgeToEdgePaintedNestedCompositeShell(
        candidate.element,
        style,
        nested[0]!.element,
        view
      )
    )
  if (
    (
      items.length < 2 &&
      !(candidate.allowsSingleChild && items.length === 1) &&
      !allowsNestedShell
    ) ||
    items.length > MAX_COMPOSITE_CHILDREN
  ) return null
  const nestedDepth = nested.length > 0 ? 1 + Math.max(...nested.map(entry => entry.depth)) : 1
  if (nestedDepth > MAX_COMPOSITE_NESTING_DEPTH) return null

  const radii = exactControlRadii(style, bounds.width, bounds.height)
  const borderWidths = visibleBorderWidths(style)
  const borderWidth = normalizedNumber(Math.max(0, ...Object.values(borderWidths)))
  const outlineWidth = px(style.outlineWidth)
  const outlineVisible = outlineWidth > 0 &&
    style.outlineStyle !== 'none' && style.outlineStyle !== 'hidden'
  const state = compositeState(candidate.element)
  const layout = compositeLayout(
    candidate.element,
    style,
    items.map(item => item.element)
  )
  const appearance = {
    background: color(style.backgroundColor),
    foreground: color(style.color),
    border: borderWidth > 0 ? visibleBorderColor(style, borderWidths) : { ...transparent },
    outline: outlineVisible ? color(style.outlineColor) : { ...transparent },
    outlineWidth: outlineVisible ? outlineWidth : 0,
    outlineOffset: outlineVisible
      ? normalizedNumber(Number.parseFloat(style.outlineOffset) || 0)
      : 0,
    shadows: parseBoxShadow(style.boxShadow)
  }
  const declared = declaredPadding(style)
  const borderValues = Object.values(borderWidths)
  const hasAsymmetricBorders = borderValues.some(width => width !== borderValues[0])
  const geometry = {
    width: normalizedNumber(bounds.width),
    height: normalizedNumber(bounds.height),
    padding: {
      ...geometricPadding(bounds, items, declared),
      ...(staticRegions.length > 0 ? { top: 0 } : {})
    },
    gap: px(style.gap || style.rowGap || style.columnGap),
    radius: Math.max(
      radii.topLeft,
      radii.topRight,
      radii.bottomRight,
      radii.bottomLeft
    ),
    borderWidth,
    ...(hasAsymmetricBorders ? { borderWidths } : {})
  }
  if (isBareWideRepeatedList(candidate, items, geometry, appearance, layout)) {
    return null
  }
  const childTemplateIds = children.map(child => child.kind === 'composite'
    ? built.find(entry => entry.token.id === child.compositeId)?.token.templateId ?? child.compositeId
    : child.kind === 'control'
      ? observations.find(observation =>
        observation.token.id === child.controlId &&
        (observation.token.instanceId ?? observation.token.id) === child.instanceId &&
        observation.token.state === child.state
      )?.token.templateId ?? child.controlId
      : child.templateId
  )
  const logicalCompositeId = await stableCompositeLogicalId({
    pageScope: `${document.location.origin}${document.location.pathname}`,
    structuralLocator: structuralLocator(candidate.element)
  })
  const signature: CompositeSignature = {
    kind: candidate.kind,
    state,
    logicalCompositeId,
    geometry,
    appearance,
    layout,
    childTemplateIds,
    childInstanceIds: children.map(child => child.kind === 'composite'
      ? child.compositeId
      : child.kind === 'control'
        ? `${child.controlId}|${child.instanceId}`
        : `${child.templateId}|${child.instanceId}`
    ),
    childPlacements: children.map(child => child.placement ?? null),
    ...(staticRegions.length > 0
      ? {
          staticTextRegions: staticRegions.map(region => ({
            templateId: region.templateId,
            instanceId: region.instanceId,
            placement: region.placement
          }))
        }
      : {})
  }
  const templateId = await stableCompositeTemplateId(signature)
  const id = await stableCompositeId(signature)
  return {
    element: candidate.element,
    depth: nestedDepth,
    candidate,
    directControlInteractions: controls.map(observation => observation.ownership.interaction),
    directNestedCompositeElements: nested.map(entry => entry.element),
    token: {
      id,
      templateId,
      logicalCompositeId,
      name: `${candidate.kind}-${layout.direction}`,
      kind: candidate.kind,
      state,
      geometry,
      appearance,
      layout,
      children,
      occurrences: 1,
      stateOccurrences: 1
    }
  }
}

function membershipFromPedigreeEntry(
  entry: ControlCompositePedigreeEntry,
  observations: readonly ControlObservation[],
  built: readonly BuiltComposite[]
): CompositeMembership | null {
  const observationsByInteraction = new Map(
    observations.map(observation => [observation.ownership.interaction, observation] as const)
  )
  const builtByElement = new Map(
    built.map(composite => [composite.element, composite] as const)
  )
  const controls = entry.directControlInteractions
    .map(interaction => observationsByInteraction.get(interaction))
    .filter((observation): observation is ControlObservation => observation !== undefined)
  const nested = entry.directNestedCompositeElements
    .map(element => builtByElement.get(element))
    .filter((composite): composite is BuiltComposite => composite !== undefined)

  return controls.length === entry.directControlInteractions.length &&
    nested.length === entry.directNestedCompositeElements.length
    ? { controls, nested }
    : null
}

/**
 * Discovers the existing Composite hierarchy before state normalization. This
 * structure remains in memory only: final product Composite tokens are still
 * materialized after normalized Control state and reuse these same entries.
 */
export async function collectControlCompositePedigree(
  document: Document,
  observations: readonly ControlObservation[],
  options: { diagnostics?: CompositeDiagnosticRecorder } = {}
): Promise<ControlCompositePedigree> {
  const entries: ControlCompositePedigreeEntry[] = []
  const candidates = candidateContainers(document, [...observations], options.diagnostics)
  for (const candidate of candidates) {
    const entry = discoverCompositePedigreeEntry(
      document,
      candidate,
      [...observations],
      entries
    )
    if (entry) {
      entries.push(entry)
    } else if (hasDiagnosticTransientEvidence(candidate.element, [...observations])) {
      // This rejection belongs to the same structural discovery pass. It does
      // not trigger a later product-materialization rediscovery.
      options.diagnostics?.record(
        candidate.element,
        topLevelObservations(candidate.element, [...observations]),
        'build-rejected'
      )
    }
  }

  const optionMembership = new Map<
    ControlObservation,
    { directOptions: readonly ControlObservation[]; group: HTMLElement } | null
  >()
  for (const entry of entries) {
    if (entry.candidate.kind !== 'list') continue
    const directOptions = entry.directControlInteractions
      .map(interaction => observations.find(observation => observation.ownership.interaction === interaction))
      .filter((observation): observation is ControlObservation => observation !== undefined)
    for (const observation of directOptions) {
      // An overlapping List assignment is deliberately unknown. State
      // inference must not guess which local baseline owns that observation.
      if (optionMembership.has(observation)) {
        optionMembership.set(observation, null)
      } else {
        optionMembership.set(observation, {
          directOptions,
          group: entry.candidate.element
        })
      }
    }
  }

  const directOptionsByObservation = new Map<
    ControlObservation,
    readonly ControlObservation[]
  >(
    [...optionMembership]
      .filter((entry): entry is [ControlObservation, { directOptions: readonly ControlObservation[]; group: HTMLElement }] => entry[1] !== null)
      .map(([observation, membership]) => [observation, membership.directOptions])
  )
  const directOptionGroupByObservation = new Map<ControlObservation, HTMLElement>(
    [...optionMembership]
      .filter((entry): entry is [ControlObservation, { directOptions: readonly ControlObservation[]; group: HTMLElement }] => entry[1] !== null)
      .map(([observation, membership]) => [observation, membership.group])
  )

  return {
    candidates,
    entries,
    directOptionsByObservation,
    directOptionGroupByObservation
  }
}

export async function collectControlComposites(
  document: Document,
  observations: ControlObservation[],
  options: {
    diagnostics?: CompositeDiagnosticRecorder
    staticDiagnostics?: StaticStructureDiagnosticRecorder
    typography?: TypographyStyle[]
    pedigree?: ControlCompositePedigree
  } = {}
): Promise<CompositeToken[]> {
  const built: BuiltComposite[] = []
  const entries = options.pedigree?.entries
  const candidates = entries
    ? entries.map(entry => entry.candidate)
    : candidateContainers(document, observations, options.diagnostics)
  for (const candidate of candidates) {
    const pedigreeEntry = entries?.find(entry => entry.candidate === candidate)
    const membership = pedigreeEntry
      ? membershipFromPedigreeEntry(pedigreeEntry, observations, built)
      : undefined
    if (entries && !membership) {
      // A supplied pedigree is the only structural source for this sample.
      // Missing or unbindable entries fail closed instead of being rediscovered.
      continue
    }
    const composite = await buildComposite(
      document,
      candidate,
      observations,
      built,
      options.typography ?? [],
      membership ?? undefined
    )
    if (composite) {
      built.push(composite)
      options.staticDiagnostics?.record(composite.element, composite.token)
    }
    else if (
      hasDiagnosticTransientEvidence(candidate.element, observations)
    ) {
      options.diagnostics?.record(
        candidate.element,
        topLevelObservations(candidate.element, observations),
        'build-rejected'
      )
    }
  }
  return built.map(entry => entry.token)
}
