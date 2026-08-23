import type {
  ColorValue,
  ControlFamily,
  ControlContent,
  ControlIntent,
  ControlSize,
  ControlState,
  ControlToken,
  ControlTypography
} from '../../shared/schema'
import {
  stableControlId,
  type ControlSignature
} from '../../shared/stable-id'
import { parseCssColor } from './colors'
import { parseBoxShadow } from './shadows'
import { isExcludedVisualAsset } from './visual-assets'
import {
  allowsControlSampleContext,
  chooseControlCopy,
  controlSampleCandidate,
  hasLikelyPrivateControlCopy,
  isLikelyPrivateControlCopy,
  isPrivateControlContext,
  mergeControlSampleEvidence,
  type ControlSampleEvidence
} from './control-sample-text'
import {
  analyzeControlAnatomy,
  analyzeControlGraphicSlot,
  controlAnatomyTrace,
  CONTROL_GRAPHIC_SELECTOR
} from './control-anatomy'
import type { ControlAnatomyMergeTrace } from './control-anatomy'
import type { SlotSourceElements, SlotProvenanceByPosition } from './slot-provenance'
import { attachSlotProvenance } from './slot-provenance'
import {
  isRenderedVisualElement,
  isRenderedVisualTextContainer,
  renderedRectIntersectsRoot
} from './rendered-visual'
import { exactControlRadii } from './control-surface'
import { HOVER_TARGET_ATTRIBUTE } from './hover-state-explorer'
import { controlIdentities } from './control-identity'
import { TRANSIENT_STRUCTURE_ATTRIBUTE } from './state-explorer'
import type {
  ControlDiagnosticRecorder,
  ControlOwnershipTrace
} from './control-diagnostics'
import {
  buildStateProvenanceTrace,
  findProvenanceScopeRoot,
  type StateProvenanceRow
} from './control-state-provenance'
import {
  selectControlOwnership,
  type ControlOwnership,
  type ControlOwnershipEvidence
} from './control-ownership'

const CONTROL_SELECTOR = [
  'button', 'input', 'textarea', 'select',
  '[role="button"]', '[role="combobox"]',
  '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[role="menuitem"]', '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]', '[role="tab"]'
].join(',')

const transparent: ColorValue = { r: 0, g: 0, b: 0, a: 0 }

export type CollectedControlToken = ControlToken & {
  content: ControlContent
  sampleTextEvidence?: ControlSampleEvidence[]
}

export type ControlObservation = {
  token: CollectedControlToken
  ownership: ControlOwnership
  /** Internal only; never serialized into the product token or JSON. */
  slotSources?: SlotSourceElements
  /** Internal same-sample source-to-owner classification. */
  slotProvenance?: SlotProvenanceByPosition
}

export type CollectedControls = {
  controls: CollectedControlToken[]
  observations: ControlObservation[]
}

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

function px(raw: string | null | undefined): number {
  const value = Number.parseFloat(raw ?? '')
  return Number.isFinite(value) && value > 0 ? normalizedNumber(value) : 0
}

function booleanAttribute(element: Element, name: string): boolean {
  const value = element.getAttribute(name)
  return value === '' || value === 'true'
}

function safelyMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

export function controlFamily(element: Element): ControlFamily | null {
  const role = element.getAttribute('role')?.toLowerCase()
  if (role === 'switch') return 'toggle'
  if (role === 'checkbox') return 'checkbox'
  if (role === 'radio') return 'radio'
  if (role === 'combobox') return 'select'
  if (
    ['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'tab']
      .includes(role ?? '')
  ) return 'button'

  const tag = element.tagName.toLowerCase()
  if (tag === 'button') return 'button'
  if (tag === 'textarea') return 'textarea'
  if (tag === 'select') return 'select'
  if (
    element.getAttribute('tabindex') === '0' &&
    ['div', 'li', 'span'].includes(tag)
  ) return 'button'
  if (tag !== 'input') return null

  const type = (element.getAttribute('type') ?? 'text').toLowerCase()
  if (type === 'checkbox') return 'checkbox'
  if (type === 'radio') return 'radio'
  if (['button', 'submit', 'reset'].includes(type)) return 'button'
  if (['hidden', 'image', 'file', 'range', 'color'].includes(type)) return null
  return 'input'
}

export function controlState(element: HTMLElement): ControlState {
  const disabled = booleanAttribute(element, 'disabled') ||
    booleanAttribute(element, 'aria-disabled') ||
    ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) ||
    safelyMatches(element, ':disabled')
  if (disabled) return 'disabled'
  if (element.hasAttribute(HOVER_TARGET_ATTRIBUTE)) return 'hover'

  const selected = booleanAttribute(element, 'aria-selected') ||
    booleanAttribute(element, 'aria-checked') ||
    ('checked' in element && Boolean((element as HTMLInputElement).checked))
  if (selected) return 'selected'

  if (booleanAttribute(element, 'aria-pressed') || safelyMatches(element, ':active')) {
    return 'pressed'
  }
  if (booleanAttribute(element, 'aria-expanded')) return 'expanded'
  if (safelyMatches(element, ':focus-visible')) {
    return 'focus'
  }
  if (safelyMatches(element, ':hover')) return 'hover'
  return 'default'
}

export function controlSize(height: number): ControlSize {
  const normalized = normalizedNumber(height)
  const sizes: Array<[number, ControlSize]> = [
    [24, 'xs'], [32, 'sm'], [40, 'md'], [48, 'lg'], [56, 'xl']
  ]
  return sizes.find(([candidate]) => Math.abs(candidate - normalized) <= 1)?.[1] ?? 'custom'
}

function isRenderedVisualEvidence(element: Element, view: Window): boolean {
  return isRenderedVisualElement(element, view)
}

function isVisible(element: Element, view: Window): boolean {
  if (element.closest('[aria-hidden="true"]')) return false
  return isRenderedVisualEvidence(element, view)
}

function color(raw: string): ColorValue {
  return parseCssColor(raw) ?? { ...transparent }
}

function families(raw: string): string[] {
  const values = raw
    .split(',')
    .map(value => value.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  return values.length > 0 ? values : ['sans-serif']
}

function typography(style: CSSStyleDeclaration): ControlTypography {
  const fontStyle: ControlTypography['fontStyle'] = style.fontStyle.startsWith('italic')
    ? 'italic'
    : style.fontStyle.startsWith('oblique') ? 'oblique' : 'normal'
  const rawWeight = style.fontWeight === 'bold'
    ? 700
    : style.fontWeight === 'normal' ? 400 : Number.parseInt(style.fontWeight, 10)
  const fontWeight = Number.isFinite(rawWeight) && rawWeight >= 1 && rawWeight <= 1000
    ? rawWeight
    : 400
  const fontSizePx = px(style.fontSize) || 14
  const parsedLineHeight = style.lineHeight && style.lineHeight !== 'normal'
    ? px(style.lineHeight)
    : 0
  return {
    fontFamilyStack: families(style.fontFamily),
    fontStyle,
    fontSizePx,
    fontWeight,
    lineHeightPx: parsedLineHeight > 0 ? parsedLineHeight : null,
    letterSpacingPx: style.letterSpacing && style.letterSpacing !== 'normal'
      ? normalizedNumber(Number.parseFloat(style.letterSpacing) || 0)
      : 0
  }
}

function radius(style: CSSStyleDeclaration, height: number): number {
  const candidates = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
    style.borderRadius
  ].flatMap(value => value.split(/[\s/]+/))
    .map(value => {
      const numeric = Number.parseFloat(value)
      if (!Number.isFinite(numeric) || numeric <= 0) return 0
      return value.trim().endsWith('%') ? height * numeric / 100 : numeric
    })
  const maximum = Math.max(0, ...candidates)
  return normalizedNumber(Math.min(maximum, height / 2))
}

function visibleBorderWidths(
  style: CSSStyleDeclaration
): { top: number; right: number; bottom: number; left: number } {
  const styles = [
    style.borderTopStyle,
    style.borderRightStyle,
    style.borderBottomStyle,
    style.borderLeftStyle
  ]
  const widths = [
    px(style.borderTopWidth),
    px(style.borderRightWidth),
    px(style.borderBottomWidth),
    px(style.borderLeftWidth)
  ].map((width, index) =>
    styles[index] === 'none' || styles[index] === 'hidden' ? 0 : width
  )
  return {
    top: widths[0] ?? 0,
    right: widths[1] ?? 0,
    bottom: widths[2] ?? 0,
    left: widths[3] ?? 0
  }
}

function visibleBorderWidth(style: CSSStyleDeclaration): number {
  return normalizedNumber(Math.max(0, ...Object.values(visibleBorderWidths(style))))
}

function asymmetricBorderWidths(
  style: CSSStyleDeclaration
): { top: number; right: number; bottom: number; left: number } | undefined {
  const widths = visibleBorderWidths(style)
  return new Set(Object.values(widths)).size > 1 ? widths : undefined
}

function hasVisualControlFrame(
  style: CSSStyleDeclaration,
  height: number
): boolean {
  const padding = px(style.paddingTop) + px(style.paddingRight) +
    px(style.paddingBottom) + px(style.paddingLeft)
  const background = color(style.backgroundColor)
  return padding > 0 ||
    background.a > 0.05 ||
    visibleBorderWidth(style) > 0 ||
    (px(style.outlineWidth) > 0 &&
      style.outlineStyle !== 'none' &&
      style.outlineStyle !== 'hidden') ||
    radius(style, height) > 0 ||
    parseBoxShadow(style.boxShadow).length > 0
}

function hasPaintedControlFrame(style: CSSStyleDeclaration): boolean {
  const outlineWidth = px(style.outlineWidth)
  return color(style.backgroundColor).a > 0.05 ||
    visibleBorderWidth(style) > 0 ||
    (
      outlineWidth > 0 &&
      style.outlineStyle !== 'none' &&
      style.outlineStyle !== 'hidden' &&
      color(style.outlineColor).a > 0.05
    ) ||
    parseBoxShadow(style.boxShadow).some(shadow => shadow.color.a > 0.05)
}

function visibleControlsForOwnership(
  candidate: Element,
  view: Window
): Set<HTMLElement> {
  const controls = new Set(
    Array.from(candidate.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter(
      control =>
        isVisible(control, view) ||
        control.matches('input[type="file"]')
    )
  )
  for (const link of Array.from(
    candidate.querySelectorAll<HTMLElement>('a[href]')
  )) {
    if (isSafeTransientStructuralLink(link, view)) controls.add(link)
  }
  return controls
}

function containsOnlyControl(
  candidate: Element,
  element: HTMLElement,
  view: Window
): boolean {
  const controls = visibleControlsForOwnership(candidate, view)
  return controls.size === 1 && controls.has(element)
}

function matchesDeclaredInsets(
  shell: HTMLElement,
  control: HTMLElement,
  style: CSSStyleDeclaration
): boolean {
  const shellBounds = shell.getBoundingClientRect()
  const controlBounds = control.getBoundingClientRect()
  const observed = {
    top: controlBounds.top - shellBounds.top,
    right: shellBounds.right - controlBounds.right,
    bottom: shellBounds.bottom - controlBounds.bottom,
    left: controlBounds.left - shellBounds.left
  }
  const declared = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft)
  }
  if (Object.values(declared).every(value => value <= 0)) return false
  return (Object.keys(declared) as Array<keyof typeof declared>).every(side =>
    observed[side] >= -2 && Math.abs(observed[side] - declared[side]) <= 2
  )
}

function tightlyOverlaysPaintedShell(
  shell: HTMLElement,
  control: HTMLElement
): boolean {
  const shellBounds = shell.getBoundingClientRect()
  const controlBounds = control.getBoundingClientRect()
  return shellBounds.width >= 16 &&
    shellBounds.height >= 16 &&
    shellBounds.width <= 1024 &&
    shellBounds.height <= 96 &&
    Math.abs(shellBounds.top - controlBounds.top) <= 2 &&
    Math.abs(shellBounds.right - controlBounds.right) <= 2 &&
    Math.abs(shellBounds.bottom - controlBounds.bottom) <= 2 &&
    Math.abs(shellBounds.left - controlBounds.left) <= 2
}

function tightlyWrapsControlWithGraphicSlots(
  shell: HTMLElement,
  control: HTMLElement,
  style: CSSStyleDeclaration,
  hasSingleOwnedGraphic: boolean
): boolean {
  const shellBounds = shell.getBoundingClientRect()
  const controlBounds = control.getBoundingClientRect()
  const topInset = controlBounds.top - shellBounds.top
  const rightInset = shellBounds.right - controlBounds.right
  const bottomInset = shellBounds.bottom - controlBounds.bottom
  const leftInset = controlBounds.left - shellBounds.left
  const widthDifference = shellBounds.width - controlBounds.width
  const tightlyWrapped = topInset >= -2 && topInset <= 2 &&
    bottomInset >= -2 && bottomInset <= 2 &&
    leftInset >= -2 &&
    rightInset >= -2
  const declaredPadding = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft)
  }
  const matchesDeclaredVerticalPadding =
    topInset >= -2 && Math.abs(topInset - declaredPadding.top) <= 2 &&
    bottomInset >= -2 && Math.abs(bottomInset - declaredPadding.bottom) <= 2
  const keepsDeclaredHorizontalPadding =
    leftInset >= declaredPadding.left - 2 &&
    rightInset >= declaredPadding.right - 2
  return shellBounds.width >= 16 &&
    shellBounds.height >= 16 &&
    shellBounds.width <= 1024 &&
    shellBounds.height <= 96 &&
    (
      tightlyWrapped ||
      (
        hasSingleOwnedGraphic &&
        matchesDeclaredVerticalPadding &&
        keepsDeclaredHorizontalPadding
      )
    ) &&
    widthDifference >= 0 && widthDifference <= 96
}

function renderedSiblingGraphics(
  shell: HTMLElement,
  control: HTMLElement,
  view: Window
): HTMLElement[] {
  return Array.from(
    shell.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR)
  ).filter(graphic =>
    !control.contains(graphic) &&
    isRenderedVisualEvidence(graphic, view) &&
    graphic.getBoundingClientRect().width > 0 &&
    graphic.getBoundingClientRect().height > 0
  )
}

function hasTightlyOwnedSiblingGraphic(
  shell: HTMLElement,
  control: HTMLElement,
  style: CSSStyleDeclaration,
  view: Window,
  graphics = renderedSiblingGraphics(shell, control, view)
): boolean {
  const family = controlFamily(control)
  const editingControl = family === 'input' || family === 'textarea' ||
    family === 'select'
  const tightEditingOverlay = editingControl &&
    tightlyOverlaysPaintedShell(shell, control)
  const supportedLayout = style.display === 'flex' ||
    style.display === 'inline-flex' || style.display === 'grid'
  if (
    !supportedLayout &&
    !tightEditingOverlay
  ) {
    return false
  }
  const declaredPadding = px(style.paddingTop) + px(style.paddingRight) +
    px(style.paddingBottom) + px(style.paddingLeft)
  if (graphics.length === 0 || graphics.length > 2) return false
  if (
    declaredPadding <= 0 &&
    !isSafeTransientStructuralControl(control, view) &&
    !tightEditingOverlay
  ) return false

  const shellBounds = shell.getBoundingClientRect()
  const controlBounds = control.getBoundingClientRect()
  const controlStyle = view.getComputedStyle(control)
  return graphics.every(graphic => {
    const bounds = graphic.getBoundingClientRect()
    const verticallyOwned = bounds.top < controlBounds.bottom &&
      bounds.bottom > controlBounds.top
    const insideShell = bounds.left >= shellBounds.left - 2 &&
      bounds.right <= shellBounds.right + 2 &&
      bounds.top >= shellBounds.top - 2 &&
      bounds.bottom <= shellBounds.bottom + 2
    const outsideControlCopy = bounds.right <= controlBounds.left + 4 ||
      bounds.left >= controlBounds.right - 4
    const center = bounds.left + bounds.width / 2
    const leadingLimit = controlBounds.left + Math.max(
      32,
      px(controlStyle.paddingLeft)
    )
    const trailingLimit = controlBounds.right - Math.max(
      32,
      px(controlStyle.paddingRight)
    )
    const insideControlEdge = center <= leadingLimit || center >= trailingLimit
    return verticallyOwned && insideShell && (outsideControlCopy || insideControlEdge)
  })
}

function ownershipTraceDistance(value: number): number | null {
  if (!Number.isFinite(value) || Math.abs(value) > 4096) return null
  return Math.round(value * 2) / 2
}

function ownershipTraceOtherControlCount(count: number): '0' | '1' | '2+' {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  return '2+'
}

function ownershipTraceGraphicCount(count: number): '0' | '1' | '2' | '3+' {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  if (count === 2) return '2'
  return '3+'
}

function pseudoHasPaintedControlFrame(
  element: HTMLElement,
  view: Window,
  pseudo: '::before' | '::after'
): boolean {
  const css = view as Window & {
    CSS?: { supports?: (condition: string) => boolean }
  }
  if (!css.CSS?.supports?.('selector(::before)')) return false
  try {
    const style = view.getComputedStyle(element, pseudo)
    const content = style.content.trim()
    return content !== '' && content !== 'none' && content !== 'normal' &&
      hasPaintedControlFrame(style)
  } catch {
    return false
  }
}

function controlOwnershipTracePaint(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  view: Window
): ControlOwnershipTrace['ancestors'][number]['paint'] {
  const outlineWidth = px(style.outlineWidth)
  const outline = outlineWidth > 0 &&
    style.outlineStyle !== 'none' &&
    style.outlineStyle !== 'hidden' &&
    color(style.outlineColor).a > 0.05
  const background = color(style.backgroundColor).a > 0.05
  const border = visibleBorderWidth(style) > 0
  const shadow = parseBoxShadow(style.boxShadow).some(item => item.color.a > 0.05)
  return {
    elementPaint: background || border || outline || shadow,
    beforePaint: pseudoHasPaintedControlFrame(element, view, '::before'),
    afterPaint: pseudoHasPaintedControlFrame(element, view, '::after'),
    background,
    border,
    outline,
    shadow
  }
}

function ownershipTraceInsets(
  shell: HTMLElement,
  control: HTMLElement,
  style: CSSStyleDeclaration
): {
  observed: { top: number | null; right: number | null; bottom: number | null; left: number | null }
  declared: { top: number; right: number; bottom: number; left: number }
} {
  const shellBounds = shell.getBoundingClientRect()
  const controlBounds = control.getBoundingClientRect()
  return {
    observed: {
      top: ownershipTraceDistance(controlBounds.top - shellBounds.top),
      right: ownershipTraceDistance(shellBounds.right - controlBounds.right),
      bottom: ownershipTraceDistance(shellBounds.bottom - controlBounds.bottom),
      left: ownershipTraceDistance(controlBounds.left - shellBounds.left)
    },
    declared: {
      top: ownershipTraceDistance(px(style.paddingTop)) ?? 0,
      right: ownershipTraceDistance(px(style.paddingRight)) ?? 0,
      bottom: ownershipTraceDistance(px(style.paddingBottom)) ?? 0,
      left: ownershipTraceDistance(px(style.paddingLeft)) ?? 0
    }
  }
}

function controlOwnership(
  element: HTMLElement,
  view: Window,
  traceEnabled = false
): { ownership: ControlOwnership; trace?: ControlOwnershipTrace } {
  const bounds = element.getBoundingClientRect()
  const ownStyle = view.getComputedStyle(element)
  const family = controlFamily(element)
  const requiresPaintedFrame = family === 'input' ||
    family === 'textarea' ||
    family === 'select'
  const hasOwnPaint = hasPaintedControlFrame(ownStyle)
  const canPromoteLayout = !requiresPaintedFrame || !hasOwnPaint
  const evidence: ControlOwnershipEvidence[] = []
  const traceAncestors: ControlOwnershipTrace['ancestors'] = []
  const evidenceDepths = new Map<HTMLElement, number>()
  let layoutReference = element

  let candidate = element.parentElement
  for (
    let depth = 0;
    candidate && depth < 6;
    depth += 1, candidate = candidate.parentElement
  ) {
    const visible = isVisible(candidate, view)
    const excludedVisualAsset = isExcludedVisualAsset(candidate)
    const visibleControls = traceEnabled
      ? visibleControlsForOwnership(candidate, view)
      : null
    const onlyTargetControl = traceEnabled
      ? visibleControls!.size === 1 && visibleControls!.has(element)
      : containsOnlyControl(candidate, element, view)
    const candidateBounds = candidate.getBoundingClientRect()
    const candidateStyle = view.getComputedStyle(candidate)
    const widthDelta = candidateBounds.width - bounds.width
    const heightDelta = candidateBounds.height - bounds.height
    const containsTargetWidth = candidateBounds.width >= bounds.width
    const containsTargetHeight = candidateBounds.height >= bounds.height
    const heightDeltaWithin48 = heightDelta <= 48
    const widthDeltaWithin96 = widthDelta <= 96
    const graphics = renderedSiblingGraphics(candidate, element, view)
    const ownsSlots = hasTightlyOwnedSiblingGraphic(
      candidate,
      element,
      candidateStyle,
      view,
      graphics
    )
    const tightGraphicWrap = tightlyWrapsControlWithGraphicSlots(
      candidate,
      element,
      candidateStyle,
      ownsSlots && graphics.length === 1
    )
    const insetMatch = matchesDeclaredInsets(candidate, layoutReference, candidateStyle)
    const overlayMatch = tightlyOverlaysPaintedShell(candidate, layoutReference)
    const ownsPaintedFrame = hasPaintedControlFrame(candidateStyle) &&
      (
        insetMatch ||
        (
          requiresPaintedFrame &&
          overlayMatch
        ) ||
        (
          requiresPaintedFrame &&
          ownsSlots &&
          tightGraphicWrap
        )
      )
    const ownsPaint = !hasOwnPaint && ownsPaintedFrame
    const compactLayout = candidateBounds.width - bounds.width <= 96
    const ownsLayout = canPromoteLayout && compactLayout && (
      ownsPaintedFrame || ownsSlots
    )
    if (traceEnabled) {
      const otherControls = visibleControls!.size - (visibleControls!.has(element) ? 1 : 0)
      const paint = controlOwnershipTracePaint(candidate, candidateStyle, view)
      const insets = ownershipTraceInsets(candidate, layoutReference, candidateStyle)
      const decision = !visible
        ? 'not-visible'
        : excludedVisualAsset
          ? 'excluded-asset'
          : !onlyTargetControl
            ? 'other-visible-control'
            : !containsTargetWidth || !containsTargetHeight
              ? 'bounds-smaller'
              : !heightDeltaWithin48
                ? 'height-delta-over-48'
                : !paint.elementPaint
                  ? 'no-element-paint'
                  : ownsPaintedFrame
                    ? 'eligible-paint-owner'
                    : 'painted-no-geometric-owner'
      traceAncestors.push({
        depth: depth + 1,
        visible,
        excludedVisualAsset,
        onlyTargetControl,
        otherVisibleControls: ownershipTraceOtherControlCount(otherControls),
        widthDeltaPx: ownershipTraceDistance(widthDelta),
        heightDeltaPx: ownershipTraceDistance(heightDelta),
        containsTargetWidth,
        containsTargetHeight,
        heightDeltaWithin48,
        widthDeltaWithin96,
        paint,
        observedInsets: insets.observed,
        declaredPadding: insets.declared,
        insetMatch,
        overlayMatch,
        slotLayout: candidateStyle.display === 'flex' || candidateStyle.display === 'inline-flex'
          ? 'flex'
          : candidateStyle.display === 'grid'
            ? 'grid'
            : 'other',
        renderedSiblingGraphics: ownershipTraceGraphicCount(graphics.length),
        ownsSiblingGraphic: ownsSlots,
        tightGraphicWrap,
        ownsPaintedFrame,
        ownsPaint,
        ownsLayout,
        ownsSlots,
        decision
      })
    }
    if (!visible || excludedVisualAsset || !onlyTargetControl) continue
    if (!containsTargetWidth || !containsTargetHeight || !heightDeltaWithin48) continue
    evidence.push({ element: candidate, ownsLayout, ownsPaint, ownsSlots })
    evidenceDepths.set(candidate, depth + 1)
    if (layoutReference === element && ownsLayout) layoutReference = candidate
  }

  const ownership = selectControlOwnership(element, evidence)
  if (!traceEnabled) return { ownership }
  const selectedDepth = (selected: HTMLElement): number | null =>
    selected === element ? 0 : evidenceDepths.get(selected) ?? null
  return {
    ownership,
    trace: {
      kind: 'control-ownership-trace-v1',
      family: 'input',
      stage: 'rejected-no-painted-frame',
      ownPaintedFrame: hasOwnPaint,
      selectedDepths: {
        layout: selectedDepth(ownership.layout),
        paint: selectedDepth(ownership.paint),
        slots: selectedDepth(ownership.slots),
        compositeAnchor: selectedDepth(ownership.compositeAnchor)
      },
      moreAncestorsBeyondLimit: candidate !== null,
      ancestors: traceAncestors
    }
  }
}

function hasRenderedText(element: HTMLElement): boolean {
  const pending = Array.from(element.childNodes)
  while (pending.length > 0) {
    const node = pending.shift()!
    if (node.nodeType === 1) {
      const child = node as Element
      if (child.matches(CONTROL_GRAPHIC_SELECTOR)) continue
      pending.push(...Array.from(child.childNodes))
      continue
    }
    if (node.nodeType !== 3) continue
    if (!(node.textContent ?? '').trim()) continue
    const parent = node.parentElement
    const view = element.ownerDocument.defaultView
    if (
      !parent ||
      !view ||
      !isRenderedVisualTextContainer(parent, view, element)
    ) continue
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(node)
    const measure = (
      range as Range & { getBoundingClientRect?: () => DOMRect }
    ).getBoundingClientRect
    if (typeof measure !== 'function') return true
    const bounds = measure.call(range)
    if (
      bounds.width > 0.5 &&
      bounds.height > 0.5 &&
      renderedRectIntersectsRoot(bounds, element)
    ) return true
  }
  return false
}

function contentStructure(
  element: HTMLElement,
  family: ControlFamily,
  graphicSlots: ControlSignature['slots']
): NonNullable<ControlSignature['content']> {
  const leading = graphicSlots.leading !== null
  const trailing = graphicSlots.trailing !== null
  const text = ['input', 'textarea', 'select'].includes(family)
    ? true
    : hasRenderedText(element)
  if (!text && (leading || trailing)) return { kind: 'icon-only' }
  if (!text) return { kind: 'empty' }
  if (leading && trailing) return { kind: 'icon-both' }
  if (leading) return { kind: 'icon-leading' }
  if (trailing) return { kind: 'icon-trailing' }
  return { kind: 'text-only' }
}

function luminance(value: ColorValue): number {
  return 0.2126 * value.r + 0.7152 * value.g + 0.0722 * value.b
}

function intentFor(
  family: ControlFamily,
  background: ColorValue,
  border: ColorValue,
  borderWidth: number
): ControlIntent {
  const redDominant = background.a > 0 &&
    background.r > background.g * 1.35 &&
    background.r > background.b * 1.2
  if (redDominant) return 'danger'
  if (family !== 'button' && family !== 'toggle') return 'neutral'
  const channelRange = Math.max(
    background.r,
    background.g,
    background.b
  ) - Math.min(
    background.r,
    background.g,
    background.b
  )
  const substantiveBackground =
    background.a > 0.2 ||
    channelRange > 0.18
  if (
    background.a > 0.05 &&
    substantiveBackground &&
    luminance(background) < 0.82
  ) return 'primary'
  if (borderWidth > 0 && border.a > 0) return 'secondary'
  return 'tertiary'
}

function hasSubstantiveControlSurface(
  appearance: {
    background: ColorValue
    border: ColorValue
    outline: ColorValue
    outlineWidth: number
    shadows: ReturnType<typeof parseBoxShadow>
  },
  borderWidth: number
): boolean {
  return appearance.background.a > 0.05 ||
    (borderWidth > 0 && appearance.border.a > 0.05) ||
    (appearance.outlineWidth > 0 && appearance.outline.a > 0.05) ||
    appearance.shadows.some(shadow => shadow.color.a > 0.05)
}

function minimumWidth(
  family: ControlFamily,
  width: number,
  widthBehavior: 'hug' | 'fill'
): number | null {
  return ['input', 'textarea', 'select', 'toggle', 'checkbox', 'radio'].includes(family) ||
    widthBehavior === 'fill'
    ? normalizedNumber(width)
    : null
}

function baseName(signature: Pick<ControlSignature, 'family' | 'intent' | 'size'>): string {
  return `${signature.family}-${signature.intent}-${signature.size}`
}

function compareTokens(left: ControlToken, right: ControlToken): number {
  const familyOrder: ControlFamily[] = [
    'button', 'input', 'textarea', 'select', 'toggle', 'checkbox', 'radio'
  ]
  const sizeOrder: ControlSize[] = ['xs', 'sm', 'md', 'lg', 'xl', 'custom']
  const stateOrder: ControlState[] = [
    'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
  ]
  return familyOrder.indexOf(left.family) - familyOrder.indexOf(right.family) ||
    sizeOrder.indexOf(left.size) - sizeOrder.indexOf(right.size) ||
    left.groupId.localeCompare(right.groupId) ||
    stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state) ||
    left.id.localeCompare(right.id) ||
    (left.instanceId ?? left.id).localeCompare(right.instanceId ?? right.id)
}

function isCompactControlGeometry(
  family: ControlFamily,
  height: number
): boolean {
  if (family === 'textarea') return height >= 16
  return height >= 16 && height <= 96
}

function isProductCommand(element: HTMLElement): boolean {
  const role = element.getAttribute('role')?.toLowerCase()
  if (element.tagName.toLowerCase() === 'button') return true
  if (
    ['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'tab']
      .includes(role ?? '')
  ) return true
  return element.getAttribute('tabindex') === '0' &&
    element.closest('[role="menu"]') !== null
}

function anatomyTraceAdjacentRows(
  element: HTMLElement,
  family: ControlFamily,
  view: Window
): { previous: HTMLElement; next: HTMLElement } | null {
  if (family !== 'button') return null
  const targetBounds = element.getBoundingClientRect()
  if (Math.abs(targetBounds.height - 72) > 1) return null
  for (let current = element.parentElement, depth = 0;
    current && depth < 6;
    current = current.parentElement, depth += 1
  ) {
    const style = view.getComputedStyle(current)
    if (!['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) continue
    const rows = Array.from(current.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
      .filter(candidate => controlFamily(candidate) === 'button')
      .filter(candidate => Math.abs(candidate.getBoundingClientRect().height - 72) <= 1)
      .filter(candidate => isVisible(candidate, view))
      .sort((left, right) =>
        left.getBoundingClientRect().top - right.getBoundingClientRect().top ||
        left.getBoundingClientRect().left - right.getBoundingClientRect().left
      )
    const index = rows.indexOf(element)
    const previous = index > 0 ? rows[index - 1] : null
    const next = index >= 0 ? rows[index + 1] : null
    if (previous && next) return { previous, next }
  }
  return null
}

const fileLikeDestination = /\.(?:7z|csv|docx?|dmg|exe|gz|images?|jpe?g|jsonl?|mov|mp3|mp4|pdf|png|pptx?|rar|tar|txt|webp|xlsx?|zip)(?:$|[?#])/i

function isSafeTransientStructuralLink(
  element: HTMLElement,
  view: Window
): boolean {
  if (!element.matches('a[href]')) return false
  if (!element.closest(`[${TRANSIENT_STRUCTURE_ATTRIBUTE}="true"]`)) return false
  if (element.hasAttribute('download')) return false
  if (element.querySelector('input[type="file"]')) return false
  const href = element.getAttribute('href')?.trim() ?? ''
  if (!href) return false
  let destination: URL
  try {
    destination = new URL(href, element.ownerDocument.location.href)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(destination.protocol)) return false
  if (fileLikeDestination.test(`${destination.pathname}${destination.search}`)) return false
  if (
    !isVisible(element, view) ||
    isExcludedVisualAsset(element) ||
    isPrivateControlContext(element)
  ) return false
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 &&
    bounds.height >= 16 &&
    bounds.height <= 96 &&
    bounds.width <= Math.max(1024, Math.max(1, view.innerWidth) * 1.5)
}

function isSafeTransientStructuralControl(
  element: HTMLElement,
  view: Window
): boolean {
  if (isSafeTransientStructuralLink(element, view)) return true
  if (!element.closest(`[${TRANSIENT_STRUCTURE_ATTRIBUTE}="true"]`)) return false
  if (!isProductCommand(element)) return false
  if (
    element.matches('input[type="file"]') ||
    element.querySelector('input[type="file"]') ||
    !isVisible(element, view) ||
    isExcludedVisualAsset(element) ||
    isPrivateControlContext(element)
  ) return false
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 &&
    bounds.height >= 16 &&
    bounds.height <= 96 &&
    bounds.width <= Math.max(1024, Math.max(1, view.innerWidth) * 1.5)
}

async function controlCandidates(
  document: Document,
  view: Window
): Promise<HTMLElement[]> {
  const standard = Array.from(document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
  const seen = new Set(standard)
  for (const link of Array.from(document.querySelectorAll<HTMLElement>(
    `[${TRANSIENT_STRUCTURE_ATTRIBUTE}="true"] a[href]`
  ))) {
    if (seen.has(link) || !isSafeTransientStructuralLink(link, view)) continue
    seen.add(link)
    standard.push(link)
  }
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('div,li'))) {
    if (
      seen.has(element) ||
      !isVisible(element, view) ||
      isPrivateControlContext(element) ||
      element.closest('[role="menu"]') === null
    ) continue
    const bounds = element.getBoundingClientRect()
    if (
      bounds.width < 120 ||
      bounds.height < 24 ||
      bounds.height > 80 ||
      view.getComputedStyle(element).cursor !== 'pointer'
    ) continue
    const anatomy = await analyzeControlAnatomy(element, view, {
      allowCompound: true
    })
    if (
      anatomy.content?.kind !== 'compound-row' ||
      !anatomy.slots.leading
    ) continue
    seen.add(element)
    standard.push(element)
  }
  return standard
}

function hasTransientDiagnosticScope(element: HTMLElement): boolean {
  if (element.closest(`[${TRANSIENT_STRUCTURE_ATTRIBUTE}="true"]`)) return true
  for (let current = element.parentElement; current; current = current.parentElement) {
    const transients = Array.from(current.querySelectorAll<HTMLElement>(
      `[${TRANSIENT_STRUCTURE_ATTRIBUTE}="true"]`
    ))
    if (transients.length === 0) continue
    const controlsOutsideTransient = Array.from(
      current.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)
    ).filter(control => !transients.some(transient => transient.contains(control)))
    if (controlsOutsideTransient.length === 1 && controlsOutsideTransient[0] === element) {
      return true
    }
  }
  return false
}

type CompoundInputCandidate = {
  shell: HTMLElement
  editable: HTMLElement
  slotGroups: NonNullable<ControlSignature['slotGroups']>
  suppressed: Set<HTMLElement>
}

function editableControlsWithin(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]):not([type="file"]):not([type="image"]),' +
    'textarea'
  )).filter(candidate => {
    const family = controlFamily(candidate)
    return family === 'input' || family === 'textarea'
  })
}

function structuralEditableOwner(
  editable: HTMLElement,
  view: Window
): HTMLElement | null {
  const editableBounds = editable.getBoundingClientRect()
  let candidate = editable.parentElement
  for (let depth = 0; candidate && depth < 6; depth += 1, candidate = candidate.parentElement) {
    if (
      !isVisible(candidate, view) ||
      isExcludedVisualAsset(candidate) ||
      isPrivateControlContext(candidate)
    ) continue
    const bounds = candidate.getBoundingClientRect()
    if (
      bounds.width < editableBounds.width ||
      bounds.height < editableBounds.height ||
      bounds.width > Math.max(2048, Math.max(1, view.innerWidth) * 2) ||
      bounds.height > Math.max(512, Math.max(1, view.innerHeight) * 0.75)
    ) continue
    const style = view.getComputedStyle(candidate)
    if (!hasPaintedControlFrame(style)) continue
    const editables = editableControlsWithin(candidate)
    if (editables.length !== 1 || editables[0] !== editable) continue
    const siblingControls = Array.from(candidate.querySelectorAll<HTMLElement>(
      'button,[role="button"],[role="menuitem"],[role="tab"]'
    )).filter(control =>
      control !== editable &&
      isVisible(control, view) &&
      !isPrivateControlContext(control)
    )
    if (siblingControls.length < 2 || siblingControls.length > 8) continue
    const hasOrderedActionGroup = [candidate, ...Array.from(
      candidate.querySelectorAll<HTMLElement>('div,section,[role="group"],[role="toolbar"]')
    )].some(group => {
      const groupStyle = view.getComputedStyle(group)
      if (!['flex', 'inline-flex', 'grid'].includes(groupStyle.display)) return false
      return siblingControls.filter(control => group.contains(control)).length >= 2
    })
    if (hasOrderedActionGroup) return candidate
  }
  return null
}

async function compactActionSlot(
  action: HTMLElement,
  view: Window
): Promise<Exclude<ControlSignature['slots']['leading'], null> | null> {
  if (
    !isVisible(action, view) ||
    isExcludedVisualAsset(action) ||
    isPrivateControlContext(action) ||
    hasRenderedText(action)
  ) return null
  const bounds = action.getBoundingClientRect()
  if (
    bounds.width < 16 ||
    bounds.height < 16 ||
    bounds.width > 64 ||
    bounds.height > 64
  ) return null
  const graphics = Array.from(action.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR))
    .filter(graphic => isRenderedVisualEvidence(graphic, view))
  if (graphics.length !== 1) return null
  const analyzed = await analyzeControlGraphicSlot(graphics[0]!, view)
  if (!analyzed) return null
  const style = view.getComputedStyle(action)
  const borderWidth = visibleBorderWidth(style)
  return {
    ...analyzed,
    surface: {
      width: normalizedNumber(bounds.width),
      height: normalizedNumber(bounds.height),
      background: color(style.backgroundColor),
      foreground: color(style.color),
      border: borderWidth > 0
        ? color(style.borderTopColor || style.borderColor)
        : transparent,
      borderWidth,
      radii: exactControlRadii(style, bounds.width, bounds.height)
    }
  }
}

async function compoundInputCandidate(
  editable: HTMLElement,
  view: Window
): Promise<CompoundInputCandidate | null> {
  const editableBounds = editable.getBoundingClientRect()
  let shell = editable.parentElement
  for (let depth = 0; shell && depth < 6; depth += 1, shell = shell.parentElement) {
    if (
      !isVisible(shell, view) ||
      isExcludedVisualAsset(shell) ||
      isPrivateControlContext(shell) ||
      hasLikelyPrivateControlCopy(shell)
    ) continue
    const shellBounds = shell.getBoundingClientRect()
    if (
      shellBounds.height < 24 ||
      shellBounds.height > 96 ||
      shellBounds.width < editableBounds.width ||
      shellBounds.width > editableBounds.width + 240
    ) continue
    const editables = editableControlsWithin(shell)
    if (editables.length !== 1 || editables[0] !== editable) continue
    const shellStyle = view.getComputedStyle(shell)
    if (!hasVisualControlFrame(shellStyle, shellBounds.height)) continue

    const editableCenter = editableBounds.left + editableBounds.width / 2
    const actions = Array.from(shell.querySelectorAll<HTMLElement>(
      'button,[role="button"]'
    )).filter(action => action !== editable)
    const leading: NonNullable<ControlSignature['slotGroups']>['leading'] = []
    const trailing: NonNullable<ControlSignature['slotGroups']>['trailing'] = []
    for (const action of actions) {
      const slot = await compactActionSlot(action, view)
      if (!slot) continue
      const actionBounds = action.getBoundingClientRect()
      const target = actionBounds.left + actionBounds.width / 2 < editableCenter
        ? leading
        : trailing
      if (target.length < 4) target.push(slot)
    }
    if (leading.length === 0 || trailing.length === 0) continue

    return {
      shell,
      editable,
      slotGroups: { leading, trailing },
      suppressed: new Set(
        Array.from(shell.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
      )
    }
  }
  return null
}

async function compoundInputCandidates(
  document: Document,
  view: Window
): Promise<CompoundInputCandidate[]> {
  const candidates: CompoundInputCandidate[] = []
  const claimedShells = new Set<HTMLElement>()
  for (const editable of editableControlsWithin(document.body)) {
    if (
      !isVisible(editable, view) ||
      isPrivateControlContext(editable) ||
      hasLikelyPrivateControlCopy(editable)
    ) continue
    const candidate = await compoundInputCandidate(editable, view)
    if (!candidate || claimedShells.has(candidate.shell)) continue
    claimedShells.add(candidate.shell)
    candidates.push(candidate)
  }
  return candidates
}

export async function collectControlsWithObservations(
  document: Document,
  options: { diagnostics?: ControlDiagnosticRecorder } = {}
): Promise<CollectedControls> {
  const view = document.defaultView
  if (!view) return { controls: [], observations: [] }
  const aggregate = new Map<string, CollectedControlToken>()
  const observationElements = new Map<string, ControlOwnership>()
  const observationSlotSources = new Map<string, SlotSourceElements | undefined>()
  const sampleEvidence = new Map<string, Map<string, ControlSampleEvidence>>()
  const provenanceRows: StateProvenanceRow[] = []
  type UnsavedControl = Omit<
    CollectedControlToken,
    'id' | 'groupId' | 'templateId' | 'logicalControlId' | 'instanceId' |
      'name' | 'occurrences' | 'stateOccurrences'
  >
  const record = async (
    signature: UnsavedControl,
    candidate: ReturnType<typeof controlSampleCandidate>,
    ownership: ControlOwnership,
    mergeTrace?: ControlAnatomyMergeTrace,
    slotSources?: SlotSourceElements
  ): Promise<void> => {
    const element = ownership.interaction
    const id = await stableControlId(signature)
    const { templateId, logicalControlId, instanceId } = await controlIdentities({
      document,
      element,
      signature,
      sampleText: candidate,
      supportingText: signature.content?.kind === 'compound-row'
        ? signature.supportingText ?? null
        : null
    })
    if (
      options.diagnostics?.recordStateProvenance &&
      signature.family === 'button' &&
      signature.content?.kind === 'compound-row'
    ) {
      provenanceRows.push({
        element,
        ownership,
        signature,
        logicalControlId,
        instanceId,
        state: signature.state,
        scopeRoot: findProvenanceScopeRoot(element, view)
      })
    }
    if (mergeTrace) {
      options.diagnostics?.recordMergeTrace(element, {
        ...mergeTrace,
        relativeRowOrder: 'target',
        logicalControlId,
        instanceId
      })
    }
    if (candidate) {
      const candidates = sampleEvidence.get(instanceId) ??
        new Map<string, ControlSampleEvidence>()
      const supportingText = signature.content?.kind === 'compound-row'
        ? signature.supportingText
        : undefined
      const key = [
        candidate.source,
        candidate.value,
        supportingText?.source ?? '',
        supportingText?.value ?? ''
      ].join('\u0000')
      const evidence = candidates.get(key)
      candidates.set(key, evidence
        ? { ...evidence, occurrences: evidence.occurrences + 1 }
        : {
            ...candidate,
            ...(supportingText ? { supportingText } : {}),
            occurrences: 1
          })
      sampleEvidence.set(instanceId, candidates)
    }
    const existing = aggregate.get(instanceId)
    if (existing) {
      existing.occurrences += 1
      if (slotSources && !observationSlotSources.get(instanceId)) {
        observationSlotSources.set(instanceId, slotSources)
      }
      return
    }
    observationElements.set(instanceId, ownership)
    observationSlotSources.set(instanceId, slotSources)
    aggregate.set(instanceId, {
      ...signature,
      id,
      groupId: templateId,
      templateId,
      logicalControlId,
      instanceId,
      name: baseName(signature),
      occurrences: 1,
      stateOccurrences: 1
    })
  }

  const compoundInputs = await compoundInputCandidates(document, view)
  const suppressed = new Set<HTMLElement>()
  for (const candidate of compoundInputs) {
    candidate.suppressed.forEach(element => suppressed.add(element))
    const { shell, editable, slotGroups } = candidate
    const bounds = shell.getBoundingClientRect()
    const style = view.getComputedStyle(shell)
    const textStyle = view.getComputedStyle(editable)
    const borderWidth = visibleBorderWidth(style)
    const borderWidths = asymmetricBorderWidths(style)
    const outlineWidth = px(style.outlineWidth)
    const outlineVisible = outlineWidth > 0 &&
      style.outlineStyle !== 'none' &&
      style.outlineStyle !== 'hidden'
    const background = color(style.backgroundColor)
    const border = borderWidth > 0 ? color(style.borderColor) : { ...transparent }
    const family = controlFamily(editable) === 'textarea' ? 'textarea' : 'input'
    const signature: UnsavedControl = {
      family,
      state: controlState(editable),
      intent: intentFor(family, background, border, borderWidth),
      size: controlSize(bounds.height),
      geometry: {
        height: normalizedNumber(bounds.height),
        minWidth: normalizedNumber(bounds.width),
        padding: {
          top: px(style.paddingTop),
          right: px(style.paddingRight),
          bottom: px(style.paddingBottom),
          left: px(style.paddingLeft)
        },
        gap: px(style.gap || style.columnGap),
        radius: radius(style, bounds.height),
        borderWidth,
        ...(borderWidths ? { borderWidths } : {})
      },
      appearance: {
        background,
        foreground: color(textStyle.color),
        border,
        outline: outlineVisible ? color(style.outlineColor) : { ...transparent },
        outlineWidth: outlineVisible ? outlineWidth : 0,
        outlineOffset: outlineVisible
          ? normalizedNumber(Number.parseFloat(style.outlineOffset) || 0)
          : 0,
        shadows: parseBoxShadow(style.boxShadow)
      },
      typography: typography(textStyle),
      slots: {
        leading: slotGroups.leading[0] ?? null,
        trailing: slotGroups.trailing[slotGroups.trailing.length - 1] ?? null
      },
      slotGroups,
      content: { kind: 'compound-input' },
      layout: { widthBehavior: 'fill' }
    }
    await record(
      signature,
      controlSampleCandidate(editable, family),
      {
        interaction: editable,
        layout: shell,
        paint: shell,
        slots: shell,
        compositeAnchor: shell
      }
    )
  }

  for (const element of await controlCandidates(document, view)) {
    if (suppressed.has(element)) continue
    const family = controlFamily(element) ?? 'button'
    const diagnoseEditingControl = (
      stage: Parameters<ControlDiagnosticRecorder['record']>[2]
    ) => {
      if (
        (
          (
            ['input', 'textarea', 'select'].includes(family) &&
            element.matches(
              'input:not([type="hidden"]):not([type="file"]):not([type="image"]),' +
              'textarea,select'
            )
          ) ||
          isSafeTransientStructuralLink(element, view)
        ) &&
        hasTransientDiagnosticScope(element)
      ) options.diagnostics?.record(element, family, stage)
    }
    if (!isVisible(element, view)) {
      diagnoseEditingControl('rejected-not-visible')
      continue
    }
    if (isExcludedVisualAsset(element)) {
      diagnoseEditingControl('rejected-excluded-visual-asset')
      continue
    }
    if (isPrivateControlContext(element)) {
      diagnoseEditingControl('rejected-private-context')
      continue
    }
    if (hasLikelyPrivateControlCopy(element)) {
      diagnoseEditingControl('rejected-private-copy')
      continue
    }
    const traceEligible = family === 'input' &&
      element.matches('input:not([type="hidden"]):not([type="file"]):not([type="image"])') &&
      hasTransientDiagnosticScope(element)
    const ownershipResult = controlOwnership(element, view, traceEligible)
    const ownership = ownershipResult.ownership
    const layoutElement = ownership.layout
    const paintElement = ownership.paint
    const bounds = layoutElement.getBoundingClientRect()
    if (!isCompactControlGeometry(family, bounds.height)) {
      diagnoseEditingControl('rejected-compact-geometry')
      continue
    }
    const style = view.getComputedStyle(layoutElement)
    const paintStyle = view.getComputedStyle(paintElement)
    const textStyle = view.getComputedStyle(element)
    const structuralEditable = (
      family === 'input' || family === 'textarea'
    ) && layoutElement === element
      ? structuralEditableOwner(element, view)
      : null
    if (
      ['input', 'textarea', 'select'].includes(family) &&
      !hasPaintedControlFrame(paintStyle) &&
      !structuralEditable
    ) {
      diagnoseEditingControl('rejected-no-painted-frame')
      if (traceEligible && ownershipResult.trace) {
        options.diagnostics?.recordOwnershipTrace(element, ownershipResult.trace)
      }
      continue
    }
    const layoutBorderWidth = visibleBorderWidth(style)
    const paintBorderWidth = visibleBorderWidth(paintStyle)
    const borderWidth = Math.max(layoutBorderWidth, paintBorderWidth)
    const borderWidths = asymmetricBorderWidths(
      paintBorderWidth > 0 ? paintStyle : style
    )
    const paintOutlineWidth = px(paintStyle.outlineWidth)
    const layoutOutlineWidth = px(style.outlineWidth)
    const paintOutlineVisible = paintOutlineWidth > 0 &&
      paintStyle.outlineStyle !== 'none' &&
      paintStyle.outlineStyle !== 'hidden'
    const outlineWidth = paintOutlineVisible
      ? paintOutlineWidth
      : layoutOutlineWidth
    const outlineStyle = paintOutlineVisible ? paintStyle : style
    const outlineVisible = outlineWidth > 0 &&
      outlineStyle.outlineStyle !== 'none' &&
      outlineStyle.outlineStyle !== 'hidden'
    const paintBackground = color(paintStyle.backgroundColor)
    const layoutBackground = color(style.backgroundColor)
    const background = paintBackground.a > 0.05
      ? paintBackground
      : layoutBackground
    const borderStyle = paintBorderWidth > 0 ? paintStyle : style
    const border = borderWidth > 0
      ? color(borderStyle.borderColor)
      : { ...transparent }
    const outline = outlineVisible
      ? color(outlineStyle.outlineColor)
      : { ...transparent }
    const paintShadows = parseBoxShadow(paintStyle.boxShadow)
    const shadows = paintShadows.some(shadow => shadow.color.a > 0.05)
      ? paintShadows
      : parseBoxShadow(style.boxShadow)
    const allowCommandCopy = family === 'button' && isProductCommand(element)
    const anatomy = await analyzeControlAnatomy(element, view, {
      allowCompound: allowCommandCopy,
      layoutRoot: ownership.layout,
      slotRoot: ownership.slots
    })
    const widthBehavior = anatomy.layout.widthBehavior
    const compoundContent = anatomy.content?.kind === 'compound-row'
      ? anatomy.content
      : null
    const hasLeadingIdentitySlot = compoundContent !== null &&
      (
        anatomy.slots.leading?.assetType === 'brand-logo' ||
        anatomy.slots.leading?.assetType === 'unknown'
      )
    const contentTextStyle = anatomy.primaryStyle ?? {
      foreground: color(textStyle.color),
      typography: typography(textStyle)
    }
    const state = controlState(element)
    if (
      state === 'default' &&
      hasLeadingIdentitySlot &&
      compoundContent?.trailing === 'none' &&
      anatomy.slots.trailing === null
    ) {
      diagnoseEditingControl('rejected-identity-only')
      continue
    }
    if (isLikelyPrivateControlCopy([
      anatomy.sampleText?.value,
      anatomy.supportingText?.value
    ])) continue
    const graphicSlots = anatomy.slots
    const content = anatomy.content ?? contentStructure(element, family, graphicSlots)
    const anatomyCopyAllowed = Boolean(
      anatomy.sampleText &&
      !hasLeadingIdentitySlot &&
      allowsControlSampleContext(element, family, anatomy.sampleText.value)
    )
    if (
      family === 'button' &&
      content.kind === 'empty' &&
      graphicSlots.leading === null &&
      graphicSlots.trailing === null
    ) {
      diagnoseEditingControl('rejected-empty-control')
      continue
    }
    const signature: UnsavedControl = {
      family,
      state,
      intent: intentFor(family, background, border, borderWidth),
      size: controlSize(bounds.height),
      geometry: {
        height: normalizedNumber(bounds.height),
        minWidth: minimumWidth(
          family,
          bounds.width,
          widthBehavior
        ),
        padding: {
          top: px(style.paddingTop),
          right: px(style.paddingRight),
          bottom: px(style.paddingBottom),
          left: px(style.paddingLeft)
        },
        gap: px(style.gap || style.columnGap) || anatomy.contentGap || 0,
        radius: radius(
          hasPaintedControlFrame(paintStyle) ? paintStyle : style,
          bounds.height
        ),
        borderWidth,
        ...(borderWidths ? { borderWidths } : {})
      },
      appearance: {
        background,
        foreground: contentTextStyle.foreground,
        border,
        outline,
        outlineWidth: outlineVisible ? outlineWidth : 0,
        outlineOffset: outlineVisible
          ? normalizedNumber(Number.parseFloat(outlineStyle.outlineOffset) || 0)
          : 0,
        shadows
      },
      typography: contentTextStyle.typography,
      slots: graphicSlots,
      content,
      layout: {
        widthBehavior,
        contentAlignment: anatomy.layout.contentAlignment
      },
      ...(anatomyCopyAllowed && anatomy.supportingText
        ? { supportingText: anatomy.supportingText }
        : {}),
      ...(anatomy.supportingStyle
        ? { supportingStyle: anatomy.supportingStyle }
        : {})
    }
    if (
      content.kind === 'text-only' &&
      graphicSlots.leading === null &&
      graphicSlots.trailing === null &&
      signature.appearance.foreground.a <= 0.05 &&
      !hasSubstantiveControlSurface(
        signature.appearance,
        signature.geometry.borderWidth
      )
    ) continue
    const candidate = anatomy.content?.kind === 'compound-row'
      ? anatomyCopyAllowed
        ? anatomy.sampleText
        : null
      : family === 'input' || family === 'textarea'
        ? controlSampleCandidate(element, family)
        : allowCommandCopy && anatomy.textRegionCount <= 2
          ? controlSampleCandidate(element, family)
          : null
    const adjacentRows = options.diagnostics &&
      family === 'button'
      ? anatomyTraceAdjacentRows(element, family, view)
      : null
    if (adjacentRows && content.kind === 'text-only' && candidate === null) {
      options.diagnostics?.recordAnatomyTrace(element, controlAnatomyTrace({
        element,
        view,
        anatomy,
        productCommand: allowCommandCopy,
        controlSampleCandidatePresent: candidate !== null,
        adjacentRows
      }))
    }
    await record(
      signature,
      candidate,
      ownership,
      adjacentRows ? anatomy.mergeTrace : undefined,
      anatomy.slotSources
    )
  }

  if (options.diagnostics?.recordStateProvenance) {
    const markerRows = provenanceRows.filter(row => {
      const trailing = row.signature.slots.trailing
      return trailing?.assetType === 'ui-icon' &&
        Boolean(trailing.vectorSvg) &&
        Boolean(trailing.surface)
    })
    const recorded = new Set<HTMLElement>()
    for (const target of markerRows) {
      const peers = provenanceRows.filter(row => row.scopeRoot === target.scopeRoot)
      const defaultPeer = peers.find(row =>
        row.element !== target.element &&
        row.state === 'default' &&
        !markerRows.some(marker => marker.element === row.element)
      )
      const hoverPeer = peers.find(row =>
        row.element !== target.element &&
        row.state === 'hover' &&
        !markerRows.some(marker => marker.element === row.element)
      )
      const entries: Array<[
        StateProvenanceRow | undefined,
        'target' | 'default-peer' | 'hover-peer'
      ]> = [
        [target, 'target'],
        [defaultPeer, 'default-peer'],
        [hoverPeer, 'hover-peer']
      ]
      for (const [row, traceRole] of entries) {
        if (!row || recorded.has(row.element)) continue
        recorded.add(row.element)
        options.diagnostics.recordStateProvenance(
          row.element,
          buildStateProvenanceTrace({ row, traceRole, peers })
        )
      }
    }
  }

  const tokens = [...aggregate.values()].map(token => {
    const evidence = mergeControlSampleEvidence(
      sampleEvidence.get(token.instanceId ?? token.id)?.values()
    )
    const copy = chooseControlCopy(evidence)
    return {
      ...token,
      ...(copy?.sampleText ? { sampleText: copy.sampleText } : {}),
      ...(copy?.supportingText ? { supportingText: copy.supportingText } : {}),
      ...(evidence.length > 0 ? { sampleTextEvidence: evidence } : {})
    }
  }).sort(compareTokens)
  const nameCounts = new Map<string, number>()
  for (const token of tokens) nameCounts.set(token.name, (nameCounts.get(token.name) ?? 0) + 1)
  const controls = tokens.map(token => nameCounts.get(token.name) === 1
    ? token
    : {
        ...token,
        name: `${token.name}-${(token.instanceId ?? token.id)
          .slice('sha256:'.length, 'sha256:'.length + 6)}`
      }
  )
  const rawObservations: ControlObservation[] = controls.flatMap(token => {
    const owner = observationElements.get(token.instanceId ?? token.id)
    if (!owner) return []
    const slotSources = observationSlotSources.get(token.instanceId ?? token.id)
    return [{
      token,
      ownership: owner,
      ...(slotSources ? { slotSources } : {})
    }]
  })
  return {
    controls,
    observations: attachSlotProvenance(rawObservations)
  }
}

export async function collectControls(document: Document): Promise<CollectedControlToken[]> {
  return (await collectControlsWithObservations(document)).controls
}
