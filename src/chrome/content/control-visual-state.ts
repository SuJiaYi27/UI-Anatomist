import type { ControlObservation } from './controls'
import { findProvenanceScopeRoot } from './control-state-provenance'
import { HOVER_PROBE_ATTRIBUTE, HOVER_TARGET_ATTRIBUTE } from './hover-state-explorer'

export type VisualSelectedPeerContext = {
  directOptionsByObservation: ReadonlyMap<
    ControlObservation,
    readonly ControlObservation[]
  >
  /**
   * Internal Composite boundary identity for the same direct-option relation.
   * It never enters a token or exported JSON contract.
   */
  directOptionGroupByObservation?: ReadonlyMap<ControlObservation, HTMLElement>
}

const GENERIC_CONTROL_SELECTOR = [
  'button', 'input', 'textarea', 'select',
  '[role="button"]', '[role="combobox"]', '[role="switch"]',
  '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]',
  '[role="menuitemradio"]', '[role="menuitemcheckbox"]', '[role="tab"]'
].join(',')

type VisualDimension = 'surface' | 'border' | 'typography' | 'slots'
export type VisualSelectedEvidence = Partial<Record<VisualDimension, string>>

export type VisualSelectedRetention = {
  evidence: VisualSelectedEvidence
  group: HTMLElement
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Collection has already reduced CSS measurements to four decimal places.
 * Comparison keeps that source precision, then uses a relative component
 * scale only for rendered pixel quantities. Color channels instead use their
 * display channel precision. This prevents one global numeric bucket from
 * defining unrelated visual fields.
 */
function renderedPixel(value: number, reference: number): number {
  const collectionPrecision = 0.0001
  const scale = Math.max(Math.abs(reference), 1)
  const noisePrecision = Math.max(collectionPrecision, scale / 1000)
  return Number((Math.round(value / noisePrecision) * noisePrecision).toFixed(4))
}

function renderedColor(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
}

function renderedValue(
  value: unknown,
  reference: number,
  key = ''
): unknown {
  if (typeof value === 'number') {
    return ['r', 'g', 'b', 'a'].includes(key)
      ? renderedColor(value)
      : renderedPixel(value, reference)
  }
  if (Array.isArray(value)) {
    return value.map(item => renderedValue(item, reference))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, nested]) => [
        nestedKey,
        renderedValue(nested, reference, nestedKey)
      ])
    )
  }
  return value
}

/**
 * A local repeated scope and the collected interaction family establish the
 * comparison relation. Derived size/intent/content and a paint-wrapper move
 * are visual observations: using them as identity would hide the state they
 * are meant to compare.
 */
function sameFunctionalStructure(
  target: ControlObservation,
  candidate: ControlObservation
): boolean {
  // Family is only a broad interaction category.  Derived visual fields and
  // nested-control cardinality are deliberately not peer-identity gates: a
  // repeated row may gain or lose an optional child while remaining the same
  // repeated responsibility.  Any stronger relationship must come from
  // evidence that is actually present in the observation contract.
  return target.token.family === candidate.token.family
}

function slotEvidence(
  slot: ControlObservation['token']['slots']['leading'],
  position: 'leading' | 'trailing'
): unknown {
  if (!slot) return null
  return {
    present: true,
    position,
    width: renderedPixel(slot.width, slot.width),
    height: renderedPixel(slot.height, slot.height),
    assetType: slot.assetType ?? 'unknown',
    surface: slot.surface
      ? renderedValue(slot.surface, Math.max(slot.surface.width, slot.surface.height, 1))
      : null
  }
}

/**
 * Text values and raw SVG paths are deliberately excluded. A slot's visible
 * category and geometry are useful state evidence, but the current observation
 * contract does not say which child Control owns a slot. We therefore do not
 * guess from DOM order here; ownership-aware exclusion needs evidence from an
 * upstream collector before it can be implemented safely.
 */
function visualDimensions(observation: ControlObservation): Record<VisualDimension, string> {
  const token = observation.token
  return {
    surface: stableJson(renderedValue({
      background: token.appearance.background,
      radius: token.geometry.radius,
      opacity: token.appearance.foreground.a
    }, Math.max(token.geometry.radius, 1))),
    border: stableJson(renderedValue({
      borderWidth: token.geometry.borderWidth,
      borderWidths: token.geometry.borderWidths ?? null,
      border: token.appearance.border,
      outline: token.appearance.outline,
      outlineWidth: token.appearance.outlineWidth,
      outlineOffset: token.appearance.outlineOffset,
      shadows: token.appearance.shadows
    }, Math.max(token.geometry.borderWidth, token.appearance.outlineWidth, 1))),
    typography: stableJson(renderedValue({
      typography: token.typography,
      foreground: token.appearance.foreground,
      supportingStyle: token.supportingStyle ?? null
    }, Math.max(token.typography.fontSizePx, 1))),
    slots: stableJson({
      leading: slotEvidence(token.slots.leading, 'leading'),
      trailing: slotEvidence(token.slots.trailing, 'trailing')
    })
  }
}

export function hasStateVisualDifference(
  left: ControlObservation,
  right: ControlObservation
): boolean {
  const leftDimensions = visualDimensions(left)
  const rightDimensions = visualDimensions(right)
  return (Object.keys(leftDimensions) as VisualDimension[]).some(dimension =>
    leftDimensions[dimension] !== rightDimensions[dimension]
  )
}

function directTransientState(observation: ControlObservation): boolean {
  const interaction = observation.ownership.interaction
  if (observation.token.state !== 'default') return true
  if (interaction.hasAttribute(HOVER_TARGET_ATTRIBUTE)) return true
  const active = interaction.ownerDocument.activeElement
  return Boolean(active && (active === interaction || interaction.contains(active)))
}

function probeSample(observation: ControlObservation): boolean {
  return observation.ownership.interaction
    .closest(`[${HOVER_PROBE_ATTRIBUTE}]`) !== null
}

function baselineForDimension(
  target: ControlObservation,
  peers: ControlObservation[],
  dimension: VisualDimension
): string | null {
  const counts = new Map<string, number>()
  for (const observation of [target, ...peers]) {
    const key = visualDimensions(observation)[dimension]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1])
  const baseline = ranked[0]
  if (!baseline) return null
  // A tied most-common value is ambiguous. No fixed peer count is required:
  // one standalone value and two mutually different values both remain
  // unresolved by their relative distribution alone.
  if (ranked[1] && ranked[1][1] === baseline[1]) return null
  return baseline[0]
}

function comparablePeers(
  target: ControlObservation,
  observations: ControlObservation[],
  view: Window,
  peerContext?: VisualSelectedPeerContext
): ControlObservation[] {
  if (target.token.state !== 'default') return []
  if (directTransientState(target) || probeSample(target)) return []
  const pedigreePeers = peerContext?.directOptionsByObservation.get(target)
  // When a pedigree was supplied, being outside it is intentionally unknown:
  // never fall back to generic-control counting for a product sample.
  if (peerContext && !pedigreePeers) return []
  const targetRoot = findProvenanceScopeRoot(
    target.ownership.interaction,
    view
  )
  return (pedigreePeers ?? observations).filter(candidate => {
    if (candidate === target) return false
    if (candidate.token.state !== 'default') return false
    if (directTransientState(candidate) || probeSample(candidate)) return false
    if (peerContext) return true
    if (!sameFunctionalStructure(candidate, target)) return false
    return findProvenanceScopeRoot(
      candidate.ownership.interaction,
      view
    ) === targetRoot
  })
}

export function visualSelectedEvidence(
  target: ControlObservation,
  observations: ControlObservation[],
  view: Window,
  peerContext?: VisualSelectedPeerContext
): VisualSelectedEvidence | null {
  const peers = comparablePeers(target, observations, view, peerContext)
  if (peers.length === 0) return null

  const targetDimensions = visualDimensions(target)
  const evidence: VisualSelectedEvidence = {}
  for (const dimension of Object.keys(targetDimensions) as VisualDimension[]) {
    const baseline = baselineForDimension(target, peers, dimension)
    if (baseline !== null && targetDimensions[dimension] !== baseline) {
      evidence[dimension] = targetDimensions[dimension]
    }
  }
  return Object.keys(evidence).length > 0 ? evidence : null
}

export function shouldRetainVisualSelected(
  observation: ControlObservation,
  prior: VisualSelectedRetention | undefined,
  peerContext?: VisualSelectedPeerContext
): boolean {
  if (!prior || directTransientState(observation)) return false
  // Cross-sample persistence is only valid while the current internal
  // Composite pedigree still identifies this exact observation as a direct
  // option of the same List boundary. Outside, unknown, or moved entries must
  // not inherit visual selected state from a prior sample.
  const currentGroup = peerContext?.directOptionGroupByObservation?.get(observation)
  if (!currentGroup || currentGroup !== prior.group) return false
  const dimensions = visualDimensions(observation)
  // Only the previously proven state dimensions must persist. Responsive
  // geometry, content classification, or an ownership wrapper may change
  // without erasing an independent persistent state surface.
  return Object.entries(prior.evidence).some(([dimension, value]) =>
    dimensions[dimension as VisualDimension] === value
  )
}

export function shouldInferVisualSelected(
  target: ControlObservation,
  observations: ControlObservation[],
  view: Window,
  peerContext?: VisualSelectedPeerContext
): boolean {
  // A supplied pedigree is authoritative. Never fall back to the former
  // generic-ancestor cohort when the current observation is outside it.
  if (peerContext && !peerContext.directOptionGroupByObservation?.has(target)) return false
  return visualSelectedEvidence(target, observations, view, peerContext) !== null
}
