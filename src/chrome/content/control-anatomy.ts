import type {
  ColorValue,
  ControlContent,
  ControlSampleText,
  ControlSlot,
  ControlTypography
} from '../../shared/schema'
import { isAuthorSuppliedGraphicPayload } from './content-payload'
import { isSafeControlSampleTextValue } from '../../shared/schema'
import { parseCssColor } from './colors'
import { isPrivateControlContext } from './control-sample-text'
import {
  isLikelyBrandGraphic,
  isLikelyIdentityGraphic
} from './ui-vector'
import {
  sanitizeUiGraphicElement,
  UI_GRAPHIC_SELECTOR
} from './ui-graphic'
import {
  isRenderedVisualElement,
  isRenderedVisualTextContainer
} from './rendered-visual'
import { exactControlRadii } from './control-surface'
import {
  findPaintedIconSurface,
  type PaintedIconSurface
} from './icon-interaction-surface'
import type { SlotSourceElements } from './slot-provenance'

export const CONTROL_GRAPHIC_SELECTOR =
  `${UI_GRAPHIC_SELECTOR},img,picture,canvas`
const NESTED_CONTROL_SELECTOR = [
  'button', 'input', 'textarea', 'select',
  '[role="button"]', '[role="combobox"]', '[role="listbox"]',
  '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[role="menuitem"]', '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]'
].join(',')
const PAINTED_CARRIER_CONTROL_SELECTOR = [
  'button', 'input', 'textarea', 'select',
  '[role="button"]', '[role="combobox"]', '[role="listbox"]',
  '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[role="menuitem"]', '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]', '[role="tab"]', 'a[href]'
].join(',')

type TextRegion = {
  element: HTMLElement
  value: string
  bounds: DOMRect
}

export type ControlAnatomy = {
  slots: { leading: ControlSlot | null; trailing: ControlSlot | null }
  /** Internal DOM source references used only for same-sample ownership evidence. */
  slotSources?: SlotSourceElements
  content: ControlContent | null
  layout: {
    widthBehavior: 'hug' | 'fill'
    contentAlignment: 'start' | 'center' | 'end' | 'space-between'
  }
  contentGap: number | null
  textRegionCount: number
  sampleText: ControlSampleText | null
  primaryStyle: {
    foreground: ColorValue
    typography: ControlTypography
  } | null
  supportingText: ControlSampleText | null
  supportingStyle: {
    foreground: ColorValue
    typography: ControlTypography
  } | null
  /**
   * Anonymous, console-only evidence for a clipped-list text candidate.
   * This never participates in the product token or shared JSON contract.
   */
  mergeTrace?: ControlAnatomyMergeTrace
}

export type ControlAnatomyMergeTrace = {
  kind: 'control-anatomy-merge-trace-v2'
  runtimeRevision: `merge-v3-${string}`
  relativeRowOrder?: 'previous' | 'target' | 'next'
  preRegionCount: number
  preLineRegionCounts: number[]
  rawDirectTextCandidateCount: number
  renderedTextCandidateCount: number
  safeTextCandidateCount: number
  nestedControlBoundaryExcludedCount: number
  renderedRejectionCounts: {
    notVisible: number
    notRenderedTextContainer: number
  }
  safeRejectionCounts: { unsafeOrEmpty: number }
  rows: Array<{
    centerDeltaBucket: '0-2' | '3-8' | '9+'
    horizontalGapBucket: 'overlap' | '0-8' | '9-16' | '17+'
    orderValid: boolean
    geometryEligible: boolean
    styleCompatible: boolean
    styleDifferences: {
      fontFamily: boolean
      fontSize: boolean
      fontWeight: boolean
      lineHeight: boolean
      letterSpacing: boolean
      color: boolean
    }
    fragmentPrivate: boolean[]
    combinedSafe: boolean
  }>
  mergeDecision: 'not-two-lines' | 'already-two-lines' | 'geometry' | 'style' |
    'fragment-private' | 'combined-unsafe' | 'merged'
  postRegionCount: number
  anatomyTextRegionCount: number
  compoundFound: boolean
  samplePresent: boolean
  supportingPresent: boolean
  contentKindBefore: 'text-only' | 'compound-row'
  contentKindAfter: 'text-only' | 'compound-row'
}

type RelativePlacement = {
  x: number
  y: number
  width: number
  height: number
}

type ControlAnatomyTraceRow = {
  relativeRowOrder: 'previous' | 'target' | 'next'
  rawDirectTextCandidateCount: number
  renderedTextCandidateCount: number
  safeTextCandidateCount: number
  lineClusterCount: number
  lineRegionCounts: number[]
  regions: Array<{ lengthBucket: '1-8' | '9-24' | '25-32' | '33+'; placement: RelativePlacement }>
  nestedControlBoundaryExcludedCount: number
  renderedRejectionCounts: {
    notVisible: number
    notRenderedTextContainer: number
  }
  safeRejectionCounts: { unsafeOrEmpty: number }
}

export type ControlAnatomyTrace = ControlAnatomyTraceRow & {
  kind: 'control-anatomy-trace-v1'
  family: 'button'
  role: 'button' | 'menu-item' | 'other'
  productCommand: boolean
  privateContext: boolean
  allowCompound: boolean
  anatomyTextRegionCount: number
  compoundFound: boolean
  samplePresent: boolean
  supportingPresent: boolean
  controlSampleCandidatePresent: boolean
  baselineRows: Array<Omit<ControlAnatomyTraceRow, 'relativeRowOrder'> & {
    relativeRowOrder: 'previous' | 'next'
  }>
}

type ControlAnatomyOptions = {
  allowCompound?: boolean
  layoutRoot?: HTMLElement
  slotRoot?: HTMLElement
}

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

function px(raw: string | null | undefined): number {
  const value = Number.parseFloat(raw ?? '')
  return Number.isFinite(value) && value > 0 ? normalizedNumber(value) : 0
}

function typography(style: CSSStyleDeclaration): ControlTypography {
  const weight = style.fontWeight === 'bold'
    ? 700
    : style.fontWeight === 'normal' ? 400 : Number.parseInt(style.fontWeight, 10)
  const fontSize = px(style.fontSize) || 14
  const lineHeight = style.lineHeight && style.lineHeight !== 'normal'
    ? px(style.lineHeight)
    : 0
  return {
    fontFamilyStack: style.fontFamily
      .split(',')
      .map(value => value.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean),
    fontStyle: style.fontStyle.startsWith('italic')
      ? 'italic'
      : style.fontStyle.startsWith('oblique') ? 'oblique' : 'normal',
    fontSizePx: fontSize,
    fontWeight: Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? weight : 400,
    lineHeightPx: lineHeight > 0 ? lineHeight : null,
    letterSpacingPx: style.letterSpacing && style.letterSpacing !== 'normal'
      ? normalizedNumber(Number.parseFloat(style.letterSpacing) || 0)
      : 0
  }
}

function color(style: CSSStyleDeclaration): ColorValue {
  return parseCssColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 }
}

function visible(element: Element, view: Window): boolean {
  return isRenderedVisualElement(element, view)
}

function belongsToRoot(element: Element, root: HTMLElement): boolean {
  const closest = element.closest(NESTED_CONTROL_SELECTOR)
  const nested = closest && root.contains(closest) ? closest : null
  return nested === root ||
    (nested === null && !root.matches(NESTED_CONTROL_SELECTOR))
}

function directText(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter(node => node.nodeType === 3)
    .map(node => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function traceLengthBucket(value: string): '1-8' | '9-24' | '25-32' | '33+' {
  if (value.length <= 8) return '1-8'
  if (value.length <= 24) return '9-24'
  if (value.length <= 32) return '25-32'
  return '33+'
}

function relativePlacement(bounds: DOMRect, rootBounds: DOMRect): RelativePlacement {
  return {
    x: normalizedNumber(bounds.left - rootBounds.left),
    y: normalizedNumber(bounds.top - rootBounds.top),
    width: normalizedNumber(bounds.width),
    height: normalizedNumber(bounds.height)
  }
}

type TextEvidence = {
  regions: TextRegion[]
  rawDirectTextCandidateCount: number
  renderedTextCandidateCount: number
  nestedControlBoundaryExcludedCount: number
  notVisible: number
  notRenderedTextContainer: number
  unsafeOrEmpty: number
  lines: TextRegion[][]
}

function centerLineClusters(regions: TextRegion[]): TextRegion[][] {
  const lines: TextRegion[][] = []
  for (const region of regions) {
    const center = region.bounds.top + region.bounds.height / 2
    const line = lines.find(existing => {
      const first = existing[0]
      if (!first) return false
      const firstCenter = first.bounds.top + first.bounds.height / 2
      return Math.abs(center - firstCenter) <=
        Math.max(2, first.bounds.height * 0.6)
    })
    if (line) line.push(region)
    else lines.push([region])
  }
  return lines
}

function collectTextEvidence(root: HTMLElement, view: Window): TextEvidence {
  const rootBounds = root.getBoundingClientRect()
  const safeRegions: TextRegion[] = []
  let rawDirectTextCandidateCount = 0
  let renderedTextCandidateCount = 0
  let nestedControlBoundaryExcludedCount = 0
  let notVisible = 0
  let notRenderedTextContainer = 0
  let unsafeOrEmpty = 0
  for (const candidate of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    const value = directText(candidate)
    if (!value) continue
    if (!belongsToRoot(candidate, root)) {
      nestedControlBoundaryExcludedCount += 1
      continue
    }
    if (candidate.matches(CONTROL_GRAPHIC_SELECTOR)) continue
    rawDirectTextCandidateCount += 1
    if (!visible(candidate, view)) {
      notVisible += 1
      continue
    }
    if (!isRenderedVisualTextContainer(candidate, view, root)) {
      notRenderedTextContainer += 1
      continue
    }
    renderedTextCandidateCount += 1
    if (!isSafeControlSampleTextValue(value)) {
      unsafeOrEmpty += 1
      continue
    }
    safeRegions.push({ element: candidate, value, bounds: candidate.getBoundingClientRect() })
  }
  safeRegions.sort((left, right) =>
    left.bounds.top - right.bounds.top ||
    left.bounds.left - right.bounds.left
  )
  const lines = centerLineClusters(safeRegions)
  return {
    regions: safeRegions,
    rawDirectTextCandidateCount,
    renderedTextCandidateCount,
    nestedControlBoundaryExcludedCount,
    notVisible,
    notRenderedTextContainer,
    unsafeOrEmpty,
    lines
  }
}

function traceTextEvidence(
  root: HTMLElement,
  view: Window,
  relativeRowOrder: ControlAnatomyTraceRow['relativeRowOrder']
): ControlAnatomyTraceRow {
  const evidence = collectTextEvidence(root, view)
  const rootBounds = root.getBoundingClientRect()
  return {
    relativeRowOrder,
    rawDirectTextCandidateCount: evidence.rawDirectTextCandidateCount,
    renderedTextCandidateCount: evidence.renderedTextCandidateCount,
    safeTextCandidateCount: evidence.regions.length,
    lineClusterCount: evidence.lines.length,
    lineRegionCounts: evidence.lines.map(line => line.length),
    regions: evidence.regions.map(region => ({
      lengthBucket: traceLengthBucket(region.value),
      placement: relativePlacement(region.bounds, rootBounds)
    })),
    nestedControlBoundaryExcludedCount: evidence.nestedControlBoundaryExcludedCount,
    renderedRejectionCounts: {
      notVisible: evidence.notVisible,
      notRenderedTextContainer: evidence.notRenderedTextContainer
    },
    safeRejectionCounts: { unsafeOrEmpty: evidence.unsafeOrEmpty }
  }
}

export function controlAnatomyTrace(input: {
  element: HTMLElement
  view: Window
  anatomy: ControlAnatomy
  productCommand: boolean
  controlSampleCandidatePresent: boolean
  adjacentRows: { previous: HTMLElement; next: HTMLElement }
}): ControlAnatomyTrace {
  const target = traceTextEvidence(input.element, input.view, 'target')
  const role = input.element.getAttribute('role')?.toLowerCase()
  const baselineRows: ControlAnatomyTrace['baselineRows'] = [
    {
      ...traceTextEvidence(input.adjacentRows.previous, input.view, 'previous'),
      relativeRowOrder: 'previous'
    },
    {
      ...traceTextEvidence(input.adjacentRows.next, input.view, 'next'),
      relativeRowOrder: 'next'
    }
  ]
  return {
    kind: 'control-anatomy-trace-v1',
    ...target,
    family: 'button',
    role: role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox'
      ? 'menu-item'
      : input.element.tagName.toLowerCase() === 'button' || role === 'button'
        ? 'button'
        : 'other',
    productCommand: input.productCommand,
    privateContext: isPrivateControlContext(input.element),
    allowCompound: input.productCommand,
    anatomyTextRegionCount: input.anatomy.textRegionCount,
    compoundFound: input.anatomy.content?.kind === 'compound-row',
    samplePresent: input.anatomy.sampleText !== null,
    supportingPresent: input.anatomy.supportingText !== null,
    controlSampleCandidatePresent: input.controlSampleCandidatePresent,
    baselineRows
  }
}

function textRegions(root: HTMLElement, view: Window): TextRegion[] {
  if (isPrivateControlContext(root)) return []
  return collectTextEvidence(root, view).regions
}

function sameRenderedTextTypography(left: HTMLElement, right: HTMLElement, view: Window): boolean {
  const leftStyle = view.getComputedStyle(left)
  const rightStyle = view.getComputedStyle(right)
  const leftTypography = typography(leftStyle)
  const rightTypography = typography(rightStyle)
  return JSON.stringify(leftTypography) === JSON.stringify(rightTypography)
}

function sameVisualTextLine(left: TextRegion, right: TextRegion): boolean {
  const leftCenter = left.bounds.top + left.bounds.height / 2
  const rightCenter = right.bounds.top + right.bounds.height / 2
  return Math.abs(leftCenter - rightCenter) <=
      Math.max(2, Math.min(left.bounds.height, right.bounds.height) * 0.6) &&
    right.bounds.left >= left.bounds.right - 0.5 &&
    right.bounds.left - left.bounds.right <=
      Math.max(8, Math.min(left.bounds.height, right.bounds.height))
}

function visualLineClusters(regions: TextRegion[]): TextRegion[][] {
  return centerLineClusters(regions)
    .map(line => [...line].sort((left, right) =>
      left.bounds.left - right.bounds.left
    ))
    .sort((left, right) =>
      (left[0]?.bounds.top ?? 0) - (right[0]?.bounds.top ?? 0)
    )
}

function bucketCenterDelta(value: number): '0-2' | '3-8' | '9+' {
  if (value <= 2) return '0-2'
  if (value <= 8) return '3-8'
  return '9+'
}

function bucketHorizontalGap(value: number): 'overlap' | '0-8' | '9-16' | '17+' {
  if (value < 0) return 'overlap'
  if (value <= 8) return '0-8'
  if (value <= 16) return '9-16'
  return '17+'
}

function styleDifferenceFlags(
  left: HTMLElement,
  right: HTMLElement,
  view: Window
): {
  fontFamily: boolean
  fontSize: boolean
  fontWeight: boolean
  lineHeight: boolean
  letterSpacing: boolean
  color: boolean
} {
  const leftStyle = view.getComputedStyle(left)
  const rightStyle = view.getComputedStyle(right)
  const leftTypography = typography(leftStyle)
  const rightTypography = typography(rightStyle)
  const leftColor = color(leftStyle)
  const rightColor = color(rightStyle)
  return {
    fontFamily: JSON.stringify(leftTypography.fontFamilyStack) !==
      JSON.stringify(rightTypography.fontFamilyStack) ||
      leftTypography.fontStyle !== rightTypography.fontStyle,
    fontSize: leftTypography.fontSizePx !== rightTypography.fontSizePx,
    fontWeight: leftTypography.fontWeight !== rightTypography.fontWeight,
    lineHeight: leftTypography.lineHeightPx !== rightTypography.lineHeightPx,
    letterSpacing: leftTypography.letterSpacingPx !== rightTypography.letterSpacingPx,
    color: leftColor.r !== rightColor.r ||
      leftColor.g !== rightColor.g ||
      leftColor.b !== rightColor.b ||
      leftColor.a !== rightColor.a
  }
}

function mergeTraceForRegions(
  regions: TextRegion[],
  evidence: TextEvidence,
  view: Window
): Omit<ControlAnatomyMergeTrace,
  'relativeRowOrder' | 'anatomyTextRegionCount' | 'compoundFound' |
  'samplePresent' | 'supportingPresent' | 'contentKindBefore' | 'contentKindAfter'> {
  const lines = visualLineClusters(regions)
  const rows = lines.map(line => {
    const sorted = [...line].sort((left, right) =>
      left.bounds.left - right.bounds.left
    )
    const pairs = sorted.slice(1).map((right, index) => {
      const left = sorted[index]!
      const leftCenter = left.bounds.top + left.bounds.height / 2
      const rightCenter = right.bounds.top + right.bounds.height / 2
      return {
        centerDelta: Math.abs(leftCenter - rightCenter),
        gap: right.bounds.left - left.bounds.right,
        orderValid: right.bounds.left >= left.bounds.right - 0.5,
        geometryEligible: sameVisualTextLine(left, right),
        styleDifferences: styleDifferenceFlags(left.element, right.element, view)
      }
    })
    const styleDifferences = pairs.reduce((merged, pair) => ({
      fontFamily: merged.fontFamily || pair.styleDifferences.fontFamily,
      fontSize: merged.fontSize || pair.styleDifferences.fontSize,
      fontWeight: merged.fontWeight || pair.styleDifferences.fontWeight,
      lineHeight: merged.lineHeight || pair.styleDifferences.lineHeight,
      letterSpacing: merged.letterSpacing || pair.styleDifferences.letterSpacing,
      color: merged.color || pair.styleDifferences.color
    }), {
      fontFamily: false,
      fontSize: false,
      fontWeight: false,
      lineHeight: false,
      letterSpacing: false,
      color: false
    })
    const value = sorted.map(region => region.value).join(' ')
      .replace(/\s+/g, ' ').trim()
    return {
      centerDeltaBucket: bucketCenterDelta(
        Math.max(0, ...pairs.map(pair => pair.centerDelta))
      ),
      horizontalGapBucket: bucketHorizontalGap(
        pairs.length > 0
          ? Math.max(...pairs.map(pair => pair.gap))
          : 0
      ),
      orderValid: pairs.every(pair => pair.orderValid),
      geometryEligible: pairs.every(pair => pair.geometryEligible),
      // The merged row keeps the first fragment's representative foreground,
      // so a color-only fragment difference is safe to coalesce. Typography
      // differences remain a hard style boundary.
      styleCompatible: [
        styleDifferences.fontFamily,
        styleDifferences.fontSize,
        styleDifferences.fontWeight,
        styleDifferences.lineHeight,
        styleDifferences.letterSpacing
      ].every(value => !value),
      styleDifferences,
      fragmentPrivate: sorted.map(region => isPrivateControlContext(region.element)),
      combinedSafe: isSafeControlSampleTextValue(value)
    }
  })
  let mergeDecision: ControlAnatomyMergeTrace['mergeDecision'] = 'merged'
  if (lines.length !== 2) {
    mergeDecision = 'not-two-lines'
  } else if (lines.every(line => line.length === 1)) {
    mergeDecision = 'already-two-lines'
  } else if (rows.some(row => !row.geometryEligible || !row.orderValid)) {
    mergeDecision = 'geometry'
  } else if (rows.some(row => !row.styleCompatible)) {
    mergeDecision = 'style'
  } else if (rows.some(row => row.fragmentPrivate.some(Boolean))) {
    mergeDecision = 'fragment-private'
  } else if (rows.some(row => !row.combinedSafe)) {
    mergeDecision = 'combined-unsafe'
  }
  return {
    kind: 'control-anatomy-merge-trace-v2',
    runtimeRevision: 'merge-v3-2026-08-21',
    preRegionCount: regions.length,
    preLineRegionCounts: lines.map(line => line.length),
    rawDirectTextCandidateCount: evidence.rawDirectTextCandidateCount,
    renderedTextCandidateCount: evidence.renderedTextCandidateCount,
    safeTextCandidateCount: evidence.regions.length,
    nestedControlBoundaryExcludedCount: evidence.nestedControlBoundaryExcludedCount,
    renderedRejectionCounts: {
      notVisible: evidence.notVisible,
      notRenderedTextContainer: evidence.notRenderedTextContainer
    },
    safeRejectionCounts: { unsafeOrEmpty: evidence.unsafeOrEmpty },
    rows,
    mergeDecision,
    postRegionCount: mergeDecision === 'merged' ? 2 : regions.length
  }
}

function mergedTextBounds(regions: TextRegion[]): DOMRect {
  const left = Math.min(...regions.map(region => region.bounds.left))
  const top = Math.min(...regions.map(region => region.bounds.top))
  const right = Math.max(...regions.map(region => region.bounds.right))
  const bottom = Math.max(...regions.map(region => region.bounds.bottom))
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    top,
    right,
    bottom,
    left
  } as DOMRect
}

function coalesceBoundedVisualTextLines(
  regions: TextRegion[],
  view: Window
): TextRegion[] {
  const lines = visualLineClusters(regions)
  if (lines.length !== 2) return regions
  const merged = lines.map(line => {
    if (line.length === 1) return line[0] ?? null
    const [first] = line
    if (!first) return null
    for (const [index, fragment] of line.slice(1).entries()) {
      const previous = line[index]!
      if (
        !sameVisualTextLine(previous, fragment) ||
        !sameRenderedTextTypography(first.element, fragment.element, view) ||
        isPrivateControlContext(fragment.element)
      ) return null
    }
    if (isPrivateControlContext(first.element)) return null
    const value = line.map(fragment => fragment.value).join(' ')
      .replace(/\s+/g, ' ').trim()
    if (!isSafeControlSampleTextValue(value)) return null
    return { element: first.element, value, bounds: mergedTextBounds(line) }
  })
  return merged.every((line): line is TextRegion => line !== null)
    ? merged
    : regions
}

export async function analyzeControlGraphicSlot(
  element: Element,
  view: Window
): Promise<ControlSlot> {
  const bounds = element.getBoundingClientRect()
  const isBrand = isLikelyBrandGraphic(element)
  const isIdentity = isLikelyIdentityGraphic(element, view)
  const isAuthorPayload = isAuthorSuppliedGraphicPayload(element)
  const vectorSvg = isBrand || isIdentity || isAuthorPayload
    ? null
    : (await sanitizeUiGraphicElement(element, view, {
        vector: {
          allowCurrentColorFill: true,
          allowResolvedCurrentColorFill: true,
          maximumLength: 4096
        }
      }))?.vectorSvg ?? null
  const assetType: ControlSlot['assetType'] = vectorSvg
    ? 'ui-icon'
    : isBrand || element.matches('img,picture')
      ? 'brand-logo'
      : 'unknown'
  const carrier = vectorSvg
    ? findPaintedIconSurface(element, view, {
        accept: surface => isBoundedControlGraphicCarrier(
          surface,
          element,
          view
        )
      })
    : null
  return {
    width: normalizedNumber(bounds.width),
    height: normalizedNumber(bounds.height),
    assetType,
    ...(carrier ? { surface: controlSlotSurface(carrier, view) } : {}),
    ...(vectorSvg ? { vectorSvg } : {})
  }
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

function carrierStyle(
  surface: PaintedIconSurface,
  view: Window
): CSSStyleDeclaration {
  return surface.source === 'element'
    ? view.getComputedStyle(surface.element)
    : view.getComputedStyle(surface.element, `::${surface.source}`)
}

function isBoundedControlGraphicCarrier(
  surface: PaintedIconSurface,
  graphic: Element,
  view: Window
): boolean {
  const graphicBounds = graphic.getBoundingClientRect()
  if (
    graphicBounds.width <= 0 ||
    graphicBounds.height <= 0 ||
    surface.width < graphicBounds.width - 0.5 ||
    surface.height < graphicBounds.height - 0.5
  ) return false

  // Keep the carrier compact relative to the actual graphic. This rejects a
  // row or page surface while allowing the small, tightly owned icon carriers
  // used by controls.
  const maximumCompactScale = 3
  const maximumExtra = 32
  if (
    surface.width > graphicBounds.width * maximumCompactScale ||
    surface.height > graphicBounds.height * maximumCompactScale ||
    surface.width - graphicBounds.width > maximumExtra ||
    surface.height - graphicBounds.height > maximumExtra
  ) return false

  const control = graphic.closest<HTMLElement>(
    PAINTED_CARRIER_CONTROL_SELECTOR
  )
  // The interaction element's own background is the row/control surface, not
  // an icon carrier. Carrier evidence must come from a tight inner wrapper or
  // the graphic host itself; compact action controls keep their established
  // full-control surface path separately.
  if (
    !control ||
    surface.element === control ||
    isPrivateControlContext(surface.element)
  ) return false

  const visibleControls = [
    ...(surface.element.matches(PAINTED_CARRIER_CONTROL_SELECTOR)
      ? [surface.element]
      : []),
    ...Array.from(
      surface.element.querySelectorAll<HTMLElement>(
        PAINTED_CARRIER_CONTROL_SELECTOR
      )
    )
  ].filter(candidate => visible(candidate, view))
  // A carrier may be the control itself, or a neutral wrapper inside it. It
  // cannot wrap that control from outside or contain another visible control.
  if (visibleControls.some(candidate => candidate !== control)) return false
  if (surface.element !== control && !control.contains(surface.element)) return false

  const visibleGraphics = [
    ...(surface.element.matches(CONTROL_GRAPHIC_SELECTOR)
      ? [surface.element]
      : []),
    ...Array.from(
      surface.element.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR)
    )
  ].filter(candidate => visible(candidate, view))
  return !visibleGraphics.some(candidate => candidate !== graphic)
}

function controlSlotSurface(
  surface: PaintedIconSurface,
  view: Window
): NonNullable<ControlSlot['surface']> {
  const style = carrierStyle(surface, view)
  const borderWidths = visibleBorderWidths(style)
  const borderWidth = normalizedNumber(Math.max(...Object.values(borderWidths)))
  const borderColor = borderWidth > 0
    ? parseCssColor(style.borderTopColor || style.borderColor) ??
      { r: 0, g: 0, b: 0, a: 0 }
    : { r: 0, g: 0, b: 0, a: 0 }
  return {
    width: surface.width,
    height: surface.height,
    background: surface.background,
    foreground: color(style),
    border: borderColor,
    borderWidth,
    radii: exactControlRadii(style, surface.width, surface.height)
  }
}

function widthBehavior(
  element: HTMLElement,
  view: Window
): 'hug' | 'fill' {
  const style = view.getComputedStyle(element)
  if (
    style.width.trim().endsWith('%') ||
    Number.parseFloat(style.flexGrow || '0') > 0 ||
    style.alignSelf === 'stretch'
  ) return 'fill'
  const parent = element.parentElement
  if (!parent) return 'hug'
  const bounds = element.getBoundingClientRect()
  const parentBounds = parent.getBoundingClientRect()
  const parentStyle = view.getComputedStyle(parent)
  const available = parentBounds.width -
    px(parentStyle.paddingLeft) -
    px(parentStyle.paddingRight)
  return parentBounds.width >= bounds.width + 8 &&
    Math.abs(available - bounds.width) <= 2
    ? 'fill'
    : 'hug'
}

type ContentAlignment = ControlAnatomy['layout']['contentAlignment']

function measuredContentAlignment(
  root: HTMLElement,
  style: CSSStyleDeclaration,
  texts: TextRegion[],
  graphics: HTMLElement[]
): Exclude<ContentAlignment, 'space-between'> | null {
  const rootBounds = root.getBoundingClientRect()
  if (rootBounds.width <= 0) return null
  const bounds = [
    ...texts.map(region => region.bounds),
    ...graphics.map(graphic => graphic.getBoundingClientRect())
  ].filter(value => value.width > 0 && value.height > 0)
  if (bounds.length === 0) return null
  const contentLeft = rootBounds.left + px(style.paddingLeft)
  const contentRight = rootBounds.right - px(style.paddingRight)
  const contentWidth = contentRight - contentLeft
  if (contentWidth <= 0) return null
  const left = Math.min(...bounds.map(value => value.left))
  const right = Math.max(...bounds.map(value => value.right))
  const leftSpace = Math.max(0, left - contentLeft)
  const rightSpace = Math.max(0, contentRight - right)
  const tolerance = Math.max(2, Math.min(8, contentWidth * 0.04))
  if (Math.abs(leftSpace - rightSpace) <= tolerance) return 'center'
  return leftSpace < rightSpace ? 'start' : 'end'
}

function contentAlignment(
  root: HTMLElement,
  style: CSSStyleDeclaration,
  texts: TextRegion[],
  graphics: HTMLElement[]
): ContentAlignment {
  const measured = measuredContentAlignment(root, style, texts, graphics)
  const justify = style.justifyContent.trim().toLowerCase()
  if (justify === 'space-between') return 'space-between'
  if (justify === 'center') return 'center'
  if (
    justify === 'flex-start' || justify === 'start' || justify === 'left' ||
    justify === 'flex-end' || justify === 'end' || justify === 'right'
  ) return measured ?? (
    justify === 'flex-end' || justify === 'end' || justify === 'right'
      ? 'end'
      : 'start'
  )
  const textAlign = style.textAlign.trim().toLowerCase()
  if (textAlign === 'center') return 'center'
  if (textAlign === 'right' || textAlign === 'end') return measured ?? 'end'
  if (textAlign === 'left' || textAlign === 'start') return measured ?? 'start'
  return measured ?? 'start'
}

export async function analyzeControlAnatomy(
  root: HTMLElement,
  view: Window,
  options: ControlAnatomyOptions = {}
): Promise<ControlAnatomy> {
  const layoutRoot = options.layoutRoot?.contains(root)
    ? options.layoutRoot
    : root
  const slotRoot = options.slotRoot?.contains(root)
    ? options.slotRoot
    : layoutRoot
  const evidence: TextEvidence = isPrivateControlContext(root)
    ? {
        regions: [],
        rawDirectTextCandidateCount: 0,
        renderedTextCandidateCount: 0,
        nestedControlBoundaryExcludedCount: 0,
        notVisible: 0,
        notRenderedTextContainer: 0,
        unsafeOrEmpty: 0,
        lines: []
      }
    : collectTextEvidence(root, view)
  const texts = coalesceBoundedVisualTextLines(evidence.regions, view)
  const mergeTrace = mergeTraceForRegions(evidence.regions, evidence, view)
  const graphics = [
    ...(root.matches(CONTROL_GRAPHIC_SELECTOR) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR))
  ]
    .filter(element => belongsToRoot(element, root) && visible(element, view))
    .filter(element =>
      !Array.from(element.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR))
        .some(descendant =>
          descendant !== element &&
          belongsToRoot(descendant, root) &&
          visible(descendant, view)
        )
    )
  const siblingSlotGraphics = slotRoot === root
    ? []
    : Array.from(
        slotRoot.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR)
      )
        .filter(element =>
          !root.contains(element) &&
          belongsToRoot(element, slotRoot) &&
          visible(element, view)
        )
        .filter(element =>
          !Array.from(element.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR))
            .some(descendant =>
              descendant !== element &&
              belongsToRoot(descendant, slotRoot) &&
              visible(descendant, view)
            )
        )
  const primary = texts[0] ?? null
  const slotGraphics = [...graphics, ...siblingSlotGraphics]
  const layoutGraphics = slotGraphics.filter(graphic => layoutRoot.contains(graphic))
  const stackedSupporting = primary
    ? texts.find(candidate =>
        candidate !== primary &&
        Math.abs(candidate.bounds.left - primary.bounds.left) <= 8 &&
        candidate.bounds.top >= primary.bounds.top + primary.bounds.height * 0.5
      ) ?? null
    : null
  const inlineSupporting = primary
    ? texts
        .filter(candidate => {
          if (candidate === primary) return false
          const primaryCenter = primary.bounds.top + primary.bounds.height / 2
          const candidateCenter = candidate.bounds.top + candidate.bounds.height / 2
          return candidate.bounds.left >= primary.bounds.right - 2 &&
            Math.abs(candidateCenter - primaryCenter) <=
              Math.max(primary.bounds.height, candidate.bounds.height) * 0.6
        })
        .sort((left, right) => left.bounds.left - right.bounds.left)[0] ?? null
    : null
  const supporting = stackedSupporting ?? inlineSupporting
  const textFlow = stackedSupporting ? 'stacked' as const : 'inline' as const
  const measuredTextGap = primary && supporting
    ? normalizedNumber(Math.max(0, textFlow === 'stacked'
        ? supporting.bounds.top - primary.bounds.bottom
        : supporting.bounds.left - primary.bounds.right
      ))
    : 0
  const rootStyle = view.getComputedStyle(root)
  const layoutStyle = view.getComputedStyle(layoutRoot)
  const distributedInlineText = textFlow === 'inline' &&
    Boolean(primary && supporting) &&
    (
      rootStyle.justifyContent === 'space-between' ||
      measuredTextGap > 64
    )
  const declaredTextGap = px(rootStyle.columnGap || rootStyle.gap)
  const textGap = distributedInlineText
    ? normalizedNumber(
        declaredTextGap > 0 && declaredTextGap <= 64
          ? declaredTextGap
          : 8
      )
    : measuredTextGap
  const supportingRight = supporting?.bounds.right ?? primary?.bounds.right ?? 0
  const trailingText = primary
    ? texts.find(candidate =>
        candidate !== primary &&
        candidate !== supporting &&
        candidate.bounds.left >= supportingRight + 16
      ) ?? null
    : null
  const leadingGraphic = primary
    ? slotGraphics
        .filter(graphic => graphic.getBoundingClientRect().right <= primary.bounds.left + 4)
        .sort((left, right) =>
          right.getBoundingClientRect().right - left.getBoundingClientRect().right
        )[0] ?? (
          root.firstElementChild &&
          slotGraphics.includes(root.firstElementChild as HTMLElement)
            ? root.firstElementChild as HTMLElement
            : null
        )
    : slotGraphics[0] ?? null
  const trailingGraphic = primary
    ? slotGraphics
        .filter(graphic => graphic.getBoundingClientRect().left >= primary.bounds.right - 4)
        .sort((left, right) =>
          left.getBoundingClientRect().left - right.getBoundingClientRect().left
        )[0] ?? null
    : null
  const slots = {
    leading: leadingGraphic
      ? await analyzeControlGraphicSlot(leadingGraphic, view)
      : null,
    trailing: trailingGraphic && trailingGraphic !== leadingGraphic
      ? await analyzeControlGraphicSlot(trailingGraphic, view)
      : null
  }
  const slotSources: SlotSourceElements = {
    leading: leadingGraphic,
    trailing: trailingGraphic && trailingGraphic !== leadingGraphic
      ? trailingGraphic
      : null
  }
  const textLeft = Math.min(
    primary?.bounds.left ?? Number.POSITIVE_INFINITY,
    supporting?.bounds.left ?? Number.POSITIVE_INFINITY
  )
  const textRight = Math.max(
    primary?.bounds.right ?? Number.NEGATIVE_INFINITY,
    supporting?.bounds.right ?? Number.NEGATIVE_INFINITY
  )
  const contentGaps = [
    leadingGraphic && Number.isFinite(textLeft)
      ? textLeft - leadingGraphic.getBoundingClientRect().right
      : 0,
    trailingGraphic && Number.isFinite(textRight)
      ? trailingGraphic.getBoundingClientRect().left - textRight
      : 0
  ].filter(gap => gap > 0 && gap <= 64)
  const isCompound = options.allowCompound !== false &&
    texts.length === 2 &&
    Boolean(primary && supporting)
  const compoundSupporting = isCompound ? supporting : null
  const primaryComputed = primary
    ? view.getComputedStyle(primary.element)
    : null
  const supportingComputed = compoundSupporting
    ? view.getComputedStyle(compoundSupporting.element)
    : null
  const contentKind = isCompound ? 'compound-row' : 'text-only'
  return {
    slots,
    slotSources,
    content: isCompound
      ? {
          kind: 'compound-row',
          trailing: trailingText || slots.trailing ? 'action' : 'none',
          textFlow,
          textGap
        }
      : null,
    layout: {
      widthBehavior: distributedInlineText
        ? 'fill'
        : widthBehavior(layoutRoot, view),
      contentAlignment: contentAlignment(
        layoutRoot,
        layoutStyle,
        texts,
        layoutGraphics
      )
    },
    contentGap: contentGaps.length > 0
      ? normalizedNumber(Math.min(...contentGaps))
      : null,
    textRegionCount: texts.length,
    sampleText: primary
      ? { value: primary.value, source: 'visible-text' }
      : null,
    primaryStyle: primaryComputed
      ? {
          foreground: color(primaryComputed),
          typography: typography(primaryComputed)
        }
      : null,
    supportingText: compoundSupporting
      ? { value: compoundSupporting.value, source: 'visible-text' }
      : null,
    supportingStyle: supportingComputed
      ? {
          foreground: color(supportingComputed),
          typography: typography(supportingComputed)
        }
      : null,
    mergeTrace: {
      ...mergeTrace,
      anatomyTextRegionCount: texts.length,
      compoundFound: isCompound,
      samplePresent: isCompound && primary !== null,
      supportingPresent: compoundSupporting !== null,
      contentKindBefore: contentKind,
      contentKindAfter: contentKind
    }
  }
}
