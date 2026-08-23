import type {
  CompositeDiagnostic,
  CompositeDiagnosticReason
} from '../../shared/schema'
import { anonymousDiagnosticPageId } from './control-identity'
import type { ControlObservation } from './controls'
import { stableControlLogicalId } from '../../shared/stable-id'

export type CompositeDiagnosticRecorder = {
  record(
    element: HTMLElement,
    observations: ControlObservation[],
    reason: CompositeDiagnosticReason
  ): void
  finalize(): Promise<CompositeDiagnostic[]>
}

function structuralSegment(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute('role')?.trim().toLowerCase()
  const semantic = role ? `${tag}[role=${role}]` : tag
  const siblings = element.parentElement
    ? Array.from(element.parentElement.children).filter(sibling =>
        sibling.tagName.toLowerCase() === tag &&
        sibling.getAttribute('role')?.trim().toLowerCase() === role
      )
    : [element]
  return `${semantic}:${Math.max(0, siblings.indexOf(element))}`
}

function structuralLocator(element: HTMLElement): string {
  const segments: string[] = []
  let current: Element | null = element
  for (let depth = 0; current && depth < 12; depth += 1) {
    segments.push(structuralSegment(current))
    if (current === element.ownerDocument.body) break
    current = current.parentElement
  }
  return segments.reverse().join('>')
}

export function createCompositeDiagnosticRecorder(
  document: Document
): CompositeDiagnosticRecorder {
  const pending: Array<Promise<Omit<CompositeDiagnostic, 'occurrences'>>> = []
  const identities = new WeakMap<HTMLElement, Promise<string>>()
  const pageId = anonymousDiagnosticPageId(document)
  return {
    record(element, observations, reason) {
      const controlIds = [...new Set(observations.map(item => item.token.id))].sort()
      if (controlIds.length === 0) return
      const candidateId = identities.get(element) ?? stableControlLogicalId({
        pageScope: `${document.location.origin}${document.location.pathname}`,
        structuralLocator: structuralLocator(element)
      })
      identities.set(element, candidateId)
      pending.push(Promise.all([candidateId, pageId]).then(([candidate, page]) => ({
        candidateId: candidate,
        pageId: page,
        controlIds,
        reason
      })))
    },
    async finalize() {
      const rows = new Map<string, CompositeDiagnostic>()
      for (const incoming of await Promise.all(pending)) {
        const key = JSON.stringify(incoming)
        const existing = rows.get(key)
        rows.set(key, existing
          ? { ...existing, occurrences: existing.occurrences + 1 }
          : { ...incoming, occurrences: 1 })
      }
      return [...rows.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        left.reason.localeCompare(right.reason) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )
    }
  }
}
