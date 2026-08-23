import type {
  ControlImportPlanEntry,
  ControlImportPlanGroup
} from './control-import-plan'

export type ExistingControlDependencyCandidate = {
  id: string
  ownershipId: string | null
  parentType: 'PAGE' | 'COMPONENT_SET' | 'OTHER'
  parentGroupOwnershipId: string | null
}

export function resolveExistingControlDependencyId(
  group: ControlImportPlanGroup,
  entry: ControlImportPlanEntry,
  candidates: ExistingControlDependencyCandidate[]
): string | null {
  const owned = candidates.filter(candidate =>
    candidate.ownershipId === entry.ownershipId
  )
  const structurallyCurrent = group.kind === 'component_set'
    ? owned.find(candidate =>
        candidate.parentType === 'COMPONENT_SET' &&
        candidate.parentGroupOwnershipId === group.groupOwnershipId
      )
    : owned.find(candidate => candidate.parentType === 'PAGE')
  if (structurallyCurrent) return structurallyCurrent.id
  if (entry.existingComponentId) {
    const exact = owned.find(candidate => candidate.id === entry.existingComponentId)
    if (exact) return exact.id
  }
  return owned[0]?.id ?? null
}
