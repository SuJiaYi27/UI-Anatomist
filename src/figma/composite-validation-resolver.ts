import type { ControlToken, ScanExport } from '../shared/schema'
import {
  COMPOSITE_GROUP_OWNERSHIP_KEY,
  COMPOSITE_NODE_OWNERSHIP_KEY,
  readCompositeOwnership,
  type AppliedComposite,
  type CompositeComponentPort,
  type CompositeComponentSetPort
} from './composite-component-applier'
import type {
  CompositeImportPlanEntry,
  CompositeImportPlanGroup
} from './composite-import-plan'

type OwnedNode = {
  id: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  name: string
  parent?: unknown
  getPluginData(key: string): string
  getSharedPluginData?(namespace: string, key: string): string
}

function ownedNode(value: unknown): OwnedNode | null {
  if (!value || typeof value !== 'object') return null
  const node = value as Partial<OwnedNode>
  return (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
    typeof node.id === 'string' &&
    typeof node.name === 'string' &&
    typeof node.getPluginData === 'function'
    ? node as OwnedNode
    : null
}

function controlBindingKey(token: {
  id: string
  instanceId?: string
  state: string
}): string {
  return `${token.id}|${token.instanceId ?? token.id}|${token.state}`
}

export function resolveAppliedCompositeNodes(
  data: ScanExport,
  values: readonly unknown[]
): AppliedComposite[] {
  const prefix = `${data.source.origin}|composite:`
  const compositesById = new Map(data.composites.map(token => [token.id, token]))
  const controlsByBinding = new Map(data.controls.map(token => [
    controlBindingKey(token),
    token
  ]))

  return values.flatMap(value => {
    const node = ownedNode(value)
    if (!node || node.type !== 'COMPONENT') return []
    const ownershipId = readCompositeOwnership(node, COMPOSITE_NODE_OWNERSHIP_KEY)
    if (!ownershipId.startsWith(prefix)) return []
    const source = compositesById.get(ownershipId.slice(prefix.length))
    if (!source) return []
    const parent = ownedNode(node.parent)
    const componentSet = parent?.type === 'COMPONENT_SET'
      ? parent as unknown as CompositeComponentSetPort
      : null
    const groupOwnershipId = componentSet
      ? readCompositeOwnership(parent!, COMPOSITE_GROUP_OWNERSHIP_KEY)
      : ''
    const groupId = groupOwnershipId || ownershipId
    const children: CompositeImportPlanEntry['children'] = source.children.flatMap(
      child => {
        if (child.kind === 'composite') {
          return [{
            kind: 'composite' as const,
            compositeId: child.compositeId,
            compositeOwnershipId:
              `${data.source.origin}|composite:${child.compositeId}`,
            ...(child.placement ? { placement: child.placement } : {})
          }]
        }
        const control = controlsByBinding.get(controlBindingKey({
          id: child.controlId,
          instanceId: child.instanceId,
          state: child.state
        })) as ControlToken | undefined
        if (!control) return []
        return [{
          kind: 'control' as const,
          controlId: child.controlId,
          instanceId: child.instanceId,
          state: child.state,
          source: control,
          controlGroupId: control.groupId,
          controlOwnershipId: `${data.source.origin}|${control.id}`,
          sampleText: control.sampleText?.value ?? null,
          supportingText: control.supportingText?.value ?? null,
          ...(child.placement ? { placement: child.placement } : {})
        }]
      }
    )
    const entry: CompositeImportPlanEntry = {
      action: 'update',
      source,
      targetName: node.name,
      ownershipId,
      existingComponentId: node.id,
      children
    }
    const group: CompositeImportPlanGroup = {
      action: 'update',
      kind: componentSet ? 'component_set' : 'component',
      groupId,
      templateId: source.templateId,
      stateEvidenceId: source.logicalCompositeId,
      targetName: componentSet?.name ?? node.name,
      groupOwnershipId: groupId,
      existingGroupNodeId: componentSet?.id ?? null,
      conflictName: null,
      entries: [entry]
    }
    return [{
      group,
      entry,
      component: node as unknown as CompositeComponentPort,
      componentSet
    }]
  })
}
