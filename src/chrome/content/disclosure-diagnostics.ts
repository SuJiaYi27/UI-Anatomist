import type {
  DisclosureDiagnostic,
  DisclosureDiagnosticFileRisk,
  DisclosureDiagnosticRisk,
  DisclosureDiagnosticRiskReason,
  DisclosureDiagnosticStage
} from '../../shared/schema'
import {
  anonymousControlLogicalId,
  anonymousDiagnosticPageId
} from './control-identity'
import { nativeDetailsOwner } from './native-details'

export type DisclosureDiagnosticObservation = Omit<
  DisclosureDiagnostic,
  'candidateId' | 'pageId' | 'occurrences'
>

export type DisclosureDiagnosticRecorder = {
  record(element: HTMLElement, observation: DisclosureDiagnosticObservation): void
  finalize(): Promise<DisclosureDiagnostic[]>
}

export function disclosureDiagnosticTraits(
  element: HTMLElement,
  fileRisk: DisclosureDiagnosticFileRisk = 'none'
): Pick<
  DisclosureDiagnosticObservation,
  | 'elementKind'
  | 'popupKind'
  | 'hasExpanded'
  | 'hasControls'
  | 'nativeDetails'
  | 'fileRisk'
> {
  const nativeDetails = Boolean(nativeDetailsOwner(element))
  const role = element.getAttribute('role')?.trim().toLowerCase()
  const popup = element.getAttribute('aria-haspopup')?.trim().toLowerCase()
  return {
    elementKind: nativeDetails
      ? 'native-summary'
      : element.matches('button')
        ? 'native-button'
        : role === 'button'
          ? 'custom-button'
          : element.matches('a[href]')
            ? 'link'
            : 'other',
    popupKind: popup === undefined
      ? 'none'
      : popup === 'true' || popup === 'menu' || popup === 'listbox' ||
          popup === 'tree' || popup === 'grid' || popup === 'dialog'
        ? popup
        : 'other',
    hasExpanded: element.hasAttribute('aria-expanded'),
    hasControls: element.hasAttribute('aria-controls'),
    nativeDetails,
    fileRisk
  }
}

export function disclosureDiagnosticObservation(
  element: HTMLElement,
  input: {
    fileRisk?: DisclosureDiagnosticFileRisk
    risk?: DisclosureDiagnosticRisk
    riskReason?: DisclosureDiagnosticRiskReason
    stage: DisclosureDiagnosticStage
  }
): DisclosureDiagnosticObservation {
  return {
    ...disclosureDiagnosticTraits(element, input.fileRisk),
    risk: input.risk ?? 'not-classified',
    riskReason: input.riskReason ?? 'preflight',
    stage: input.stage
  }
}

export function createDisclosureDiagnosticRecorder(
  document: Document
): DisclosureDiagnosticRecorder {
  const pending: Array<Promise<Omit<DisclosureDiagnostic, 'occurrences'>>> = []
  const identities = new WeakMap<HTMLElement, Promise<string>>()
  const pageId = anonymousDiagnosticPageId(document)
  return {
    record(element, observation) {
      const candidateId = identities.get(element) ??
        anonymousControlLogicalId(document, element)
      identities.set(element, candidateId)
      pending.push(Promise.all([candidateId, pageId]).then(([id, page]) => ({
        candidateId: id,
        pageId: page,
        ...observation
      })))
    },
    async finalize() {
      const rows = new Map<string, DisclosureDiagnostic>()
      for (const incoming of await Promise.all(pending)) {
        const key = JSON.stringify(incoming)
        const existing = rows.get(key)
        rows.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...incoming, occurrences: 1 })
      }
      return [...rows.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        left.stage.localeCompare(right.stage) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )
    }
  }
}
