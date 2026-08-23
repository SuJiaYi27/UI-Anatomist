import { describe, expect, it } from 'vitest'

import {
  resolveExistingControlDependencyId,
  type ExistingControlDependencyCandidate
} from '../../src/figma/control-dependency-resolver'
import type {
  ControlImportPlanEntry,
  ControlImportPlanGroup
} from '../../src/figma/control-import-plan'

function group(
  kind: ControlImportPlanGroup['kind'],
  groupOwnershipId = 'origin|presentation:current'
): ControlImportPlanGroup {
  return {
    action: 'create',
    kind,
    groupId: 'group',
    templateId: 'template',
    stateEvidenceId: null,
    instances: [],
    targetName: 'Control',
    groupOwnershipId,
    existingGroupNodeId: null,
    conflictName: null,
    entries: []
  }
}

function entry(existingComponentId: string | null): ControlImportPlanEntry {
  return {
    action: existingComponentId ? 'update' : 'create',
    source: {} as ControlImportPlanEntry['source'],
    targetName: 'Control',
    ownershipId: 'origin|control:current',
    existingComponentId,
    fontName: null
  }
}

const candidate = (
  id: string,
  parentType: ExistingControlDependencyCandidate['parentType'],
  parentGroupOwnershipId: string | null = null
): ExistingControlDependencyCandidate => ({
  id,
  ownershipId: 'origin|control:current',
  parentType,
  parentGroupOwnershipId
})

describe('resolveExistingControlDependencyId', () => {
  it('prefers the current root replacement over a stale component-set child', () => {
    expect(resolveExistingControlDependencyId(
      group('component'),
      entry(null),
      [
        candidate('stale-child', 'COMPONENT_SET', 'origin|presentation:old'),
        candidate('current-root', 'PAGE')
      ]
    )).toBe('current-root')
  })

  it('prefers the child belonging to the current component set', () => {
    expect(resolveExistingControlDependencyId(
      group('component_set'),
      entry(null),
      [
        candidate('stale-child', 'COMPONENT_SET', 'origin|presentation:old'),
        candidate('current-child', 'COMPONENT_SET', 'origin|presentation:current')
      ]
    )).toBe('current-child')
  })

  it('honors the plan exact id before ownership fallbacks', () => {
    expect(resolveExistingControlDependencyId(
      group('component'),
      entry('planned-child'),
      [
        candidate('planned-child', 'COMPONENT_SET', 'origin|presentation:current'),
        candidate('other-child', 'COMPONENT_SET', 'origin|presentation:old')
      ]
    )).toBe('planned-child')
  })
})
