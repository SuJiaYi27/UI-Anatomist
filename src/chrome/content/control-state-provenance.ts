import type { ControlState } from '../../shared/schema'
import type {
  ControlSignature,
  ControlSlotSignature
} from '../../shared/stable-id'
import type { ControlOwnership } from './control-ownership'
import { CONTROL_GRAPHIC_SELECTOR } from './control-anatomy'
import { HOVER_TARGET_ATTRIBUTE } from './hover-state-explorer'

export type ProvenanceTriState = boolean | 'present-nontrue'

export type ControlStateSignals = {
  ariaSelected: ProvenanceTriState
  ariaChecked: ProvenanceTriState
  nativeChecked: boolean
  ariaCurrent: ProvenanceTriState
  dataState:
    | 'selected' | 'checked' | 'on' | 'active' | 'hover' | 'pressed'
    | 'open' | 'other' | 'none'
  dataSelected: ProvenanceTriState
  dataChecked: ProvenanceTriState
  dataActive: ProvenanceTriState
  forcedHover: boolean
  active: boolean
  focusVisible: boolean
  hover: boolean
}

export type RoleStateEvidence = {
  sameNodeAsInteraction: boolean
  onlyTargetControl: boolean
  signals: ControlStateSignals
}

export type MarkerScopeEvidence = {
  markerFound: boolean
  sameControlOnly: boolean
  signals: ControlStateSignals
}

export type StateProvenanceVisualFacts = {
  rowPainted: boolean
  trailingVector: boolean
  trailingSurface: boolean
  surfaceRound: boolean
  surfaceContainsGraphic: boolean
}

export type StateProvenancePeerComparison = {
  comparablePeerCount: '0' | '1' | '2' | '3+'
  markerPeerCount: 0 | 1 | '2+'
  paintedNoMarkerPeer: boolean
  hoverPaintedNoMarkerPeer: boolean
}

export type ControlStateProvenanceTrace = {
  kind: 'control-state-provenance-trace-v1'
  runtimeRevision: `state-provenance-v1-${string}`
  family: 'button'
  traceRole: 'target' | 'default-peer' | 'hover-peer'
  logicalControlId: string
  instanceId: string
  contentKind: string
  collectedState: ControlState
  preNormalizeState: ControlState
  postNormalizeState?: ControlState | null
  decisionSource:
    | 'disabled' | 'forced-hover' | 'interaction-selected' | 'pressed'
    | 'expanded' | 'focus' | 'css-hover' | 'default'
  ownership: {
    interaction: RoleStateEvidence
    layout: RoleStateEvidence
    paint: RoleStateEvidence
    slots: RoleStateEvidence
    compositeAnchor: RoleStateEvidence
  }
  markerScope: MarkerScopeEvidence
  visualFacts: StateProvenanceVisualFacts
  peerComparison: StateProvenancePeerComparison
}

export type StateProvenanceRow = {
  element: HTMLElement
  ownership: ControlOwnership
  signature: ControlSignature
  logicalControlId: string
  instanceId: string
  state: ControlState
  scopeRoot: HTMLElement
}

const GENERIC_CONTROL_SELECTOR = [
  'button', 'input', 'textarea', 'select',
  '[role="button"]', '[role="combobox"]', '[role="switch"]',
  '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]',
  '[role="menuitemradio"]', '[role="menuitemcheckbox"]', '[role="tab"]'
].join(',')

function safelyMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

function triState(element: Element, name: string): ProvenanceTriState {
  if (!element.hasAttribute(name)) return false
  const value = element.getAttribute(name)?.trim().toLowerCase() ?? ''
  if (value === '' || value === 'true') return true
  return 'present-nontrue'
}

function dataState(element: Element): ControlStateSignals['dataState'] {
  const value = element.getAttribute('data-state')?.trim().toLowerCase()
  if (!value) return 'none'
  if (value === 'selected') return 'selected'
  if (value === 'checked') return 'checked'
  if (value === 'on') return 'on'
  if (value === 'active') return 'active'
  if (value === 'hover') return 'hover'
  if (value === 'pressed') return 'pressed'
  if (value === 'open') return 'open'
  return 'other'
}

export function stateSignals(element: HTMLElement): ControlStateSignals {
  return {
    ariaSelected: triState(element, 'aria-selected'),
    ariaChecked: triState(element, 'aria-checked'),
    nativeChecked: 'checked' in element && Boolean(
      (element as HTMLInputElement).checked
    ),
    ariaCurrent: triState(element, 'aria-current'),
    dataState: dataState(element),
    dataSelected: triState(element, 'data-selected'),
    dataChecked: triState(element, 'data-checked'),
    dataActive: triState(element, 'data-active'),
    forcedHover: element.hasAttribute(HOVER_TARGET_ATTRIBUTE),
    active: safelyMatches(element, ':active'),
    focusVisible: safelyMatches(element, ':focus-visible'),
    hover: safelyMatches(element, ':hover')
  }
}

function isSelectedSignal(signals: ControlStateSignals): boolean {
  return signals.ariaSelected === true ||
    signals.ariaChecked === true ||
    signals.nativeChecked
}

function isDisabled(element: HTMLElement, signals: ControlStateSignals): boolean {
  return triState(element, 'disabled') === true ||
    triState(element, 'aria-disabled') === true ||
    ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) ||
    safelyMatches(element, ':disabled')
}

export function decisionSource(
  element: HTMLElement,
  collectedState: ControlState
): ControlStateProvenanceTrace['decisionSource'] {
  const signals = stateSignals(element)
  if (isDisabled(element, signals)) return 'disabled'
  if (signals.forcedHover) return 'forced-hover'
  if (isSelectedSignal(signals)) return 'interaction-selected'
  if (triState(element, 'aria-pressed') === true || signals.active) return 'pressed'
  if (triState(element, 'aria-expanded') === true) return 'expanded'
  if (signals.focusVisible) return 'focus'
  if (signals.hover || collectedState === 'hover') return 'css-hover'
  return 'default'
}

function controlsWithin(element: Element): HTMLElement[] {
  const own = safelyMatches(element, GENERIC_CONTROL_SELECTOR) &&
    element.nodeType === 1
    ? [element as HTMLElement]
    : []
  return [
    ...own,
    ...Array.from(element.querySelectorAll<HTMLElement>(GENERIC_CONTROL_SELECTOR))
  ]
}

function roleEvidence(
  role: HTMLElement,
  interaction: HTMLElement
): RoleStateEvidence {
  const controls = controlsWithin(role)
  return {
    sameNodeAsInteraction: role === interaction,
    onlyTargetControl: controls.length === 1 && controls[0] === interaction,
    signals: stateSignals(role)
  }
}

function mergeSignals(elements: HTMLElement[]): ControlStateSignals {
  const signals = elements.map(stateSignals)
  const firstTrue = (key: keyof ControlStateSignals): ProvenanceTriState => {
    if (signals.some(value => value[key] === true)) return true
    if (signals.some(value => value[key] === 'present-nontrue')) {
      return 'present-nontrue'
    }
    return false
  }
  const state = signals.find(value => value.dataState !== 'none')?.dataState ?? 'none'
  return {
    ariaSelected: firstTrue('ariaSelected'),
    ariaChecked: firstTrue('ariaChecked'),
    nativeChecked: signals.some(value => value.nativeChecked),
    ariaCurrent: firstTrue('ariaCurrent'),
    dataState: state,
    dataSelected: firstTrue('dataSelected'),
    dataChecked: firstTrue('dataChecked'),
    dataActive: firstTrue('dataActive'),
    forcedHover: signals.some(value => value.forcedHover),
    active: signals.some(value => value.active),
    focusVisible: signals.some(value => value.focusVisible),
    hover: signals.some(value => value.hover)
  }
}

function markerScope(
  interaction: HTMLElement,
  ownership: ControlOwnership
): MarkerScopeEvidence {
  const root = ownership.slots
  const graphics = [
    ...(safelyMatches(root, CONTROL_GRAPHIC_SELECTOR) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(CONTROL_GRAPHIC_SELECTOR))
  ]
  if (graphics.length === 0) {
    return {
      markerFound: false,
      sameControlOnly: true,
      signals: stateSignals(interaction)
    }
  }
  const elements: HTMLElement[] = []
  let sameControlOnly = true
  for (const graphic of graphics) {
    let current: Element | null = graphic
    while (current) {
      if (current !== interaction && safelyMatches(current, GENERIC_CONTROL_SELECTOR)) {
        sameControlOnly = false
        break
      }
      if (current.nodeType === 1) elements.push(current as HTMLElement)
      if (current === interaction) break
      current = current.parentElement
    }
    if (!sameControlOnly) break
  }
  return {
    markerFound: graphics.length > 0,
    sameControlOnly,
    signals: mergeSignals(elements.length > 0 ? elements : [interaction])
  }
}

function rowPainted(signature: ControlSignature): boolean {
  return signature.appearance.background.a >= 0.05 ||
    signature.appearance.border.a > 0.05 ||
    signature.appearance.outline.a > 0.05 ||
    signature.appearance.shadows.length > 0
}

type ControlSlotSurface = Exclude<ControlSlotSignature, null>['surface']

function surfaceRound(surface: ControlSlotSurface): boolean {
  if (!surface) return false
  const radius = Math.min(surface.width, surface.height) / 2
  return Object.values(surface.radii).every(value => Math.abs(value - radius) <= 1)
}

function surfaceContainsGraphic(
  slot: NonNullable<ControlSlotSignature>,
  surface: ControlSlotSurface
): boolean {
  if (!surface) return false
  return surface.width >= slot.width - 0.5 &&
    surface.height >= slot.height - 0.5 &&
    surface.width <= slot.width * 3 &&
    surface.height <= slot.height * 3
}

export function visualFacts(signature: ControlSignature): StateProvenanceVisualFacts {
  const trailing = signature.slots.trailing
  const surface = trailing?.surface
  return {
    rowPainted: rowPainted(signature),
    trailingVector: trailing?.assetType === 'ui-icon' && Boolean(trailing.vectorSvg),
    trailingSurface: Boolean(surface),
    surfaceRound: surfaceRound(surface),
    surfaceContainsGraphic: Boolean(
      trailing && surface && surfaceContainsGraphic(trailing, surface)
    )
  }
}

function countBucket(value: number): '0' | '1' | '2' | '3+' {
  return value >= 3 ? '3+' : String(value) as '0' | '1' | '2'
}

function markerCountBucket(value: number): 0 | 1 | '2+' {
  return value >= 2 ? '2+' : value as 0 | 1
}

function hasMarker(signature: ControlSignature): boolean {
  const slot = signature.slots.trailing
  return slot?.assetType === 'ui-icon' && Boolean(slot.vectorSvg) &&
    Boolean(slot.surface)
}

function peerComparison(
  row: StateProvenanceRow,
  peers: StateProvenanceRow[]
): StateProvenancePeerComparison {
  const comparable = peers.filter(peer => peer.element !== row.element)
  const markerPeers = comparable.filter(peer => hasMarker(peer.signature))
  const noMarker = comparable.filter(peer => !hasMarker(peer.signature))
  const paintedNoMarker = noMarker.some(peer => rowPainted(peer.signature))
  const hoverPaintedNoMarker = noMarker.some(peer =>
    peer.state === 'hover' && rowPainted(peer.signature)
  )
  return {
    comparablePeerCount: countBucket(comparable.length),
    markerPeerCount: markerCountBucket(markerPeers.length),
    paintedNoMarkerPeer: paintedNoMarker,
    hoverPaintedNoMarkerPeer: hoverPaintedNoMarker
  }
}

export function findProvenanceScopeRoot(
  element: HTMLElement,
  view: Window
): HTMLElement {
  let current: HTMLElement | null = element.parentElement
  let fallback = element.parentElement ?? element
  for (let depth = 0; current && depth < 6; depth += 1) {
    fallback = current
    const controls = controlsWithin(current).filter(candidate => {
      try {
        return candidate !== element && view.getComputedStyle(candidate).display !== 'none'
      } catch {
        return candidate !== element
      }
    })
    if (controls.length >= 2) return current
    current = current.parentElement
  }
  return fallback
}

export function buildStateProvenanceTrace(input: {
  row: StateProvenanceRow
  traceRole: ControlStateProvenanceTrace['traceRole']
  peers: StateProvenanceRow[]
}): ControlStateProvenanceTrace {
  const { row, traceRole, peers } = input
  const interaction = row.ownership.interaction
  const ownership = {
    interaction: roleEvidence(row.ownership.interaction, interaction),
    layout: roleEvidence(row.ownership.layout, interaction),
    paint: roleEvidence(row.ownership.paint, interaction),
    slots: roleEvidence(row.ownership.slots, interaction),
    compositeAnchor: roleEvidence(row.ownership.compositeAnchor, interaction)
  }
  return {
    kind: 'control-state-provenance-trace-v1',
    runtimeRevision: 'state-provenance-v1-anonymous',
    family: 'button',
    traceRole,
    logicalControlId: row.logicalControlId,
    instanceId: row.instanceId,
    contentKind: row.signature.content?.kind ?? 'empty',
    collectedState: row.state,
    preNormalizeState: row.state,
    decisionSource: decisionSource(interaction, row.state),
    ownership,
    markerScope: markerScope(interaction, row.ownership),
    visualFacts: visualFacts(row.signature),
    peerComparison: peerComparison(row, peers)
  }
}
