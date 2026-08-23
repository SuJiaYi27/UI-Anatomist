export type ControlOwnership = {
  interaction: HTMLElement
  layout: HTMLElement
  paint: HTMLElement
  slots: HTMLElement
  compositeAnchor: HTMLElement
}

export type ControlOwnershipEvidence = {
  element: HTMLElement
  ownsLayout: boolean
  ownsPaint: boolean
  ownsSlots: boolean
}

export function selectControlOwnership(
  interaction: HTMLElement,
  evidence: ControlOwnershipEvidence[]
): ControlOwnership {
  const layout = evidence.find(candidate => candidate.ownsLayout)?.element ??
    interaction
  const paint = evidence.find(candidate => candidate.ownsPaint)?.element ??
    interaction
  const slots = evidence.find(candidate => candidate.ownsSlots)?.element ??
    interaction
  let compositeAnchor = interaction

  for (const candidate of evidence) {
    if (
      (candidate.ownsLayout || candidate.ownsPaint || candidate.ownsSlots) &&
      candidate.element.contains(layout) &&
      candidate.element.contains(paint) &&
      candidate.element.contains(slots)
    ) compositeAnchor = candidate.element
  }

  return { interaction, layout, paint, slots, compositeAnchor }
}
