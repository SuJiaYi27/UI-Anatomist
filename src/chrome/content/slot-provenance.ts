import type { ControlOwnership } from './control-ownership'

export type SlotSourceElements = {
  leading: HTMLElement | null
  trailing: HTMLElement | null
}

export type SlotProvenance =
  | 'parent-owned'
  | 'independent-control-owned'
  | 'unknown'

export type SlotProvenanceByPosition = {
  leading: SlotProvenance | null
  trailing: SlotProvenance | null
}

export type SlotProvenanceObservation = {
  ownership: ControlOwnership
  slotSources?: SlotSourceElements
}

function ownershipRoots(ownership: ControlOwnership): HTMLElement[] {
  return [
    ownership.interaction,
    ownership.layout,
    ownership.paint,
    ownership.slots,
    ownership.compositeAnchor
  ]
}

function containsSource(root: HTMLElement, source: HTMLElement): boolean {
  return root === source || root.contains(source)
}

export function classifySlotSourceOwnership(
  source: HTMLElement | null,
  targetOwnership: ControlOwnership,
  peerOwnership: ControlOwnership[]
): SlotProvenance | null {
  if (!source) return null

  const independentOwners = new Set<HTMLElement>()
  for (const ownership of peerOwnership) {
    const ownsSource = ownershipRoots(ownership).some(root =>
      containsSource(root, source)
    )
    if (ownsSource) independentOwners.add(ownership.interaction)
  }
  if (independentOwners.size === 1) return 'independent-control-owned'
  if (independentOwners.size > 1) return 'unknown'

  const parentOwnsSource = ownershipRoots(targetOwnership).some(root =>
    containsSource(root, source)
  )
  return parentOwnsSource ? 'parent-owned' : 'unknown'
}

export function attachSlotProvenance<T extends SlotProvenanceObservation>(
  observations: T[]
): Array<T & { slotProvenance: SlotProvenanceByPosition }> {
  return observations.map((observation, index) => {
    const peerOwnership = observations
      .filter((_, peerIndex) => peerIndex !== index)
      .map(peer => peer.ownership)
    const sources = observation.slotSources
    return {
      ...observation,
      slotProvenance: {
        leading: classifySlotSourceOwnership(
          sources?.leading ?? null,
          observation.ownership,
          peerOwnership
        ),
        trailing: classifySlotSourceOwnership(
          sources?.trailing ?? null,
          observation.ownership,
          peerOwnership
        )
      }
    }
  })
}
