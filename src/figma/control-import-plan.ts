import type {
  ControlToken,
  ScanExport
} from '../shared/schema'
import { createControlComponentOwnershipResolver } from './control-component-ownership'
import { resolveFont, type AvailableFontName } from './font-resolver'
import { clusterControlImportTokens } from './control-presentation'

export type ExistingControlNode = {
  id: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  name: string
  ownershipId: string | null
  groupOwnershipId: string | null
}

export type ControlImportAction = 'create' | 'update' | 'skip_conflict'

export type ControlImportPlanEntry = {
  action: 'create' | 'update'
  source: ControlToken
  targetName: string
  ownershipId: string
  existingComponentId: string | null
  fontName: AvailableFontName | null
}

export type ControlImportPlanGroup = {
  action: ControlImportAction
  kind: 'component' | 'component_set'
  groupId: string
  templateId: string
  stateEvidenceId: string | null
  instances: ControlToken[]
  targetName: string
  groupOwnershipId: string
  existingGroupNodeId: string | null
  conflictName: string | null
  entries: ControlImportPlanEntry[]
}

export type ControlImportPlan = {
  source: ScanExport['source']
  groups: ControlImportPlanGroup[]
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function presentationSuffix(value: string): string {
  if (value.startsWith('reusable:')) {
    let hash = 0
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash, 31) + value.charCodeAt(index) | 0
    }
    return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6)
  }
  return /sha256:([0-9a-f]{64})/i.exec(value)?.[1]?.slice(0, 6) ??
    value.replace(/[^a-z0-9]/gi, '').slice(0, 6)
}

export function createControlImportPlan(
  data: ScanExport,
  existingNodes: ExistingControlNode[],
  availableFonts: AvailableFontName[]
): ControlImportPlan {
  const presentationGroups = clusterControlImportTokens(data.controls ?? [])
  const ownershipForControl = createControlComponentOwnershipResolver(
    data.source.origin,
    presentationGroups
  )
  const groups = presentationGroups.map(group => ({
    groupId: group.key,
    templateId: group.templateId,
    stateEvidenceId: group.stateEvidenceId,
    instances: group.instances,
    tokens: group.representatives,
    baseName: group.name
  }))
  const baseCounts = new Map<string, number>()
  for (const group of groups) {
    baseCounts.set(group.baseName, (baseCounts.get(group.baseName) ?? 0) + 1)
  }

  const existingByOwnership = new Map(
    existingNodes.filter(node => node.ownershipId).map(node => [node.ownershipId!, node])
  )
  const existingByGroupOwnership = new Map(
    existingNodes.filter(node => node.groupOwnershipId)
      .map(node => [node.groupOwnershipId!, node])
  )
  const sourceOwnershipPrefix = `${data.source.origin}|`
  const isManagedByCurrentSource = (node: ExistingControlNode): boolean =>
    Boolean(
      node.ownershipId?.startsWith(sourceOwnershipPrefix) ||
      node.groupOwnershipId?.startsWith(sourceOwnershipPrefix)
    )

  const planned: ControlImportPlanGroup[] = groups.map(group => {
    const kind = group.tokens.length > 1 ? 'component_set' as const : 'component' as const
    const targetName = (baseCounts.get(group.baseName) ?? 0) > 1
      ? `${group.baseName} · ${presentationSuffix(group.groupId)}`
      : group.baseName
    const groupOwnershipId = `${data.source.origin}|presentation:${group.groupId}`
    const singleOwnershipId = ownershipForControl(
      group.groupId,
      group.tokens[0]!.id
    )
    const existingPresentationGroup = existingByGroupOwnership.get(groupOwnershipId)
    const replacingComponentSet =
      kind === 'component' && existingPresentationGroup?.type === 'COMPONENT_SET'
    const exactGroup = kind === 'component_set'
      ? existingPresentationGroup
      : replacingComponentSet
        ? undefined
        : existingByOwnership.get(singleOwnershipId)
    const nameCollision = existingNodes.find(node =>
      node.name === targetName &&
      node.id !== exactGroup?.id &&
      node.id !== (replacingComponentSet ? existingPresentationGroup.id : null) &&
      !isManagedByCurrentSource(node)
    )
    const action: ControlImportAction = nameCollision
      ? 'skip_conflict'
      : exactGroup ? 'update' : 'create'

    const entries = group.tokens.map(token => {
      const ownershipId = ownershipForControl(group.groupId, token.id)
      const existingComponent = replacingComponentSet
        ? undefined
        : existingByOwnership.get(ownershipId)
      return {
        action: existingComponent ? 'update' as const : 'create' as const,
        source: token,
        targetName: kind === 'component_set' ? `State=${title(token.state)}` : targetName,
        ownershipId,
        existingComponentId: existingComponent?.type === 'COMPONENT'
          ? existingComponent.id
          : null,
        fontName: resolveFont(
          token.typography.fontFamilyStack,
          token.typography.fontWeight,
          token.typography.fontStyle,
          availableFonts,
          data.source.platform
        )
      }
    })
    return {
      action,
      kind,
      groupId: group.groupId,
      templateId: group.templateId,
      stateEvidenceId: group.stateEvidenceId,
      instances: group.instances,
      targetName,
      groupOwnershipId,
      existingGroupNodeId: exactGroup?.id ?? nameCollision?.id ?? null,
      conflictName: nameCollision?.name ?? null,
      entries
    }
  })

  return { source: data.source, groups: planned }
}
