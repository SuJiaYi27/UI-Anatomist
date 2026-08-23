import type { ControlPresentationGroup } from './control-presentation'

export type ControlComponentOwnershipResolver = (
  groupKey: string,
  controlId: string
) => string

export function createControlComponentOwnershipResolver(
  origin: string,
  groups: Pick<ControlPresentationGroup, 'key' | 'representatives'>[]
): ControlComponentOwnershipResolver {
  return (groupKey, controlId) => groups.some(group =>
    group.key !== groupKey &&
    group.representatives.some(token => token.id === controlId)
  )
    ? `${origin}|${controlId}|presentation:${groupKey}`
    : `${origin}|${controlId}`
}
