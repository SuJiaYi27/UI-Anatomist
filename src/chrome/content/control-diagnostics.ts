import type {
  ControlDiagnostic,
  ControlDiagnosticStage,
  ControlFamily,
  ControlState
} from '../../shared/schema'
import {
  anonymousControlLogicalId,
  anonymousDiagnosticPageId
} from './control-identity'
import type {
  ControlAnatomyMergeTrace,
  ControlAnatomyTrace
} from './control-anatomy'
import type { ControlStateProvenanceTrace } from './control-state-provenance'

type TraceDistance = number | null

type ControlOwnershipTraceAncestor = {
  depth: number
  visible: boolean
  excludedVisualAsset: boolean
  onlyTargetControl: boolean
  otherVisibleControls: '0' | '1' | '2+'
  widthDeltaPx: TraceDistance
  heightDeltaPx: TraceDistance
  containsTargetWidth: boolean
  containsTargetHeight: boolean
  heightDeltaWithin48: boolean
  widthDeltaWithin96: boolean
  paint: {
    elementPaint: boolean
    beforePaint: boolean
    afterPaint: boolean
    background: boolean
    border: boolean
    outline: boolean
    shadow: boolean
  }
  observedInsets: { top: TraceDistance; right: TraceDistance; bottom: TraceDistance; left: TraceDistance }
  declaredPadding: { top: number; right: number; bottom: number; left: number }
  insetMatch: boolean
  overlayMatch: boolean
  slotLayout: 'flex' | 'grid' | 'other'
  renderedSiblingGraphics: '0' | '1' | '2' | '3+'
  ownsSiblingGraphic: boolean
  tightGraphicWrap: boolean
  ownsPaintedFrame: boolean
  ownsPaint: boolean
  ownsLayout: boolean
  ownsSlots: boolean
  decision: 'not-visible' | 'excluded-asset' | 'other-visible-control' |
    'bounds-smaller' | 'height-delta-over-48' | 'no-element-paint' |
    'painted-no-geometric-owner' | 'eligible-paint-owner'
}

export type ControlOwnershipTrace = {
  kind: 'control-ownership-trace-v1'
  family: 'input'
  stage: 'rejected-no-painted-frame'
  ownPaintedFrame: boolean
  selectedDepths: {
    layout: number | null
    paint: number | null
    slots: number | null
    compositeAnchor: number | null
  }
  moreAncestorsBeyondLimit: boolean
  ancestors: ControlOwnershipTraceAncestor[]
}

type ConsoleControlOwnershipTrace = ControlOwnershipTrace & {
  candidateId: string
  pageId: string
  occurrences: number
}

type ConsoleControlAnatomyTrace = ControlAnatomyTrace & {
  candidateId: string
  pageId: string
  occurrences: number
}

type ConsoleControlAnatomyMergeTrace = ControlAnatomyMergeTrace & {
  candidateId: string
  pageId: string
  occurrences: number
  logicalControlId?: string
  instanceId?: string
}

type ConsoleControlStateProvenanceTrace = ControlStateProvenanceTrace & {
  candidateId: string
  pageId: string
  occurrences: number
  postNormalizeState: ControlState | null
}

export type ControlDiagnosticRecorder = {
  record(
    element: HTMLElement,
    family: ControlFamily,
    stage: ControlDiagnosticStage
  ): void
  recordOwnershipTrace(element: HTMLElement, trace: ControlOwnershipTrace): void
  recordAnatomyTrace(element: HTMLElement, trace: ControlAnatomyTrace): void
  recordMergeTrace(
    element: HTMLElement,
    trace: ControlAnatomyMergeTrace & {
      logicalControlId?: string
      instanceId?: string
    }
  ): void
  recordStateProvenance?(
    element: HTMLElement,
    trace: ControlStateProvenanceTrace
  ): void
  recordNormalizedState?(instanceId: string, state: ControlState): void
  finalize(): Promise<ControlDiagnostic[]>
}

export function createControlDiagnosticRecorder(
  document: Document
): ControlDiagnosticRecorder {
  const pending: Array<Promise<Omit<ControlDiagnostic, 'occurrences'>>> = []
  const tracePending: Array<Promise<Omit<ConsoleControlOwnershipTrace, 'occurrences'>>> = []
  const anatomyTracePending: Array<Promise<Omit<ConsoleControlAnatomyTrace, 'occurrences'>>> = []
  const mergeTracePending: Array<Promise<Omit<ConsoleControlAnatomyMergeTrace, 'occurrences'>>> = []
  const stateTracePending: Array<Promise<Omit<ConsoleControlStateProvenanceTrace, 'occurrences'>>> = []
  const normalizedStates = new Map<string, Set<ControlState>>()
  const identities = new WeakMap<HTMLElement, Promise<string>>()
  const pageId = anonymousDiagnosticPageId(document)
  return {
    record(element, family, stage) {
      const candidateId = identities.get(element) ??
        anonymousControlLogicalId(document, element)
      identities.set(element, candidateId)
      pending.push(Promise.all([candidateId, pageId]).then(([candidate, page]) => ({
        candidateId: candidate,
        pageId: page,
        family,
        stage
      })))
    },
    recordOwnershipTrace(element, trace) {
      const candidateId = identities.get(element) ??
        anonymousControlLogicalId(document, element)
      identities.set(element, candidateId)
      tracePending.push(Promise.all([candidateId, pageId]).then(([candidate, page]) => ({
        ...trace,
        candidateId: candidate,
        pageId: page
      })))
    },
    recordAnatomyTrace(element, trace) {
      const candidateId = identities.get(element) ??
        anonymousControlLogicalId(document, element)
      identities.set(element, candidateId)
      anatomyTracePending.push(Promise.all([candidateId, pageId]).then(([candidate, page]) => ({
        ...trace,
        candidateId: candidate,
        pageId: page
      })))
    },
    recordMergeTrace(element, trace) {
      const candidateId = identities.get(element) ??
        anonymousControlLogicalId(document, element)
      identities.set(element, candidateId)
      mergeTracePending.push(Promise.all([candidateId, pageId]).then(([candidate, page]) => ({
        ...trace,
        candidateId: candidate,
        pageId: page
      })))
    },
    recordStateProvenance(element, trace) {
      const candidateId = identities.get(element) ??
        anonymousControlLogicalId(document, element)
      identities.set(element, candidateId)
      stateTracePending.push(Promise.all([candidateId, pageId]).then(([candidate, page]) => ({
        ...trace,
        candidateId: candidate,
        pageId: page,
        postNormalizeState: null
      })))
    },
    recordNormalizedState(instanceId, state) {
      const states = normalizedStates.get(instanceId) ?? new Set<ControlState>()
      states.add(state)
      normalizedStates.set(instanceId, states)
    },
    async finalize() {
      const rows = new Map<string, ControlDiagnostic>()
      for (const incoming of await Promise.all(pending)) {
        const key = JSON.stringify(incoming)
        const existing = rows.get(key)
        rows.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...incoming, occurrences: 1 })
      }
      const traces = new Map<string, ConsoleControlOwnershipTrace>()
      for (const incoming of await Promise.all(tracePending)) {
        const key = JSON.stringify(incoming)
        const existing = traces.get(key)
        traces.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...incoming, occurrences: 1 })
      }
      for (const trace of [...traces.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )) console.info(JSON.stringify(trace))
      const anatomyTraces = new Map<string, ConsoleControlAnatomyTrace>()
      for (const incoming of await Promise.all(anatomyTracePending)) {
        const key = JSON.stringify(incoming)
        const existing = anatomyTraces.get(key)
        anatomyTraces.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...incoming, occurrences: 1 })
      }
      for (const trace of [...anatomyTraces.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )) console.info(JSON.stringify(trace))
      const mergeTraces = new Map<string, ConsoleControlAnatomyMergeTrace>()
      for (const incoming of await Promise.all(mergeTracePending)) {
        const key = JSON.stringify(incoming)
        const existing = mergeTraces.get(key)
        mergeTraces.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...incoming, occurrences: 1 })
      }
      for (const trace of [...mergeTraces.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )) console.info(JSON.stringify(trace))
      const stateTraces = new Map<string, ConsoleControlStateProvenanceTrace>()
      for (const incoming of await Promise.all(stateTracePending)) {
        const states = normalizedStates.get(incoming.instanceId)
        const postNormalizeState = states && states.size === 1
          ? [...states][0] ?? null
          : null
        const enriched = { ...incoming, postNormalizeState }
        const key = JSON.stringify(enriched)
        const existing = stateTraces.get(key)
        stateTraces.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...enriched, occurrences: 1 })
      }
      for (const trace of [...stateTraces.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )) console.info(JSON.stringify(trace))
      return [...rows.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        left.stage.localeCompare(right.stage) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )
    }
  }
}
