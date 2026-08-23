import type {
  CompositeState,
  CompositeToken,
  ControlState,
  ControlToken,
  ScanExport,
  StaticTextRegionChild,
  TypographyStyle
} from '../shared/schema'
import type {
  ControlImportPlan,
  ControlImportPlanEntry,
  ControlImportPlanGroup
} from './control-import-plan'
import {
  controlRenderedVisualKey,
  isRenderableControlPresentation
} from './control-presentation'
import { designerFacingCompositeIds } from './composite-presentation'
import { resolveFont, type AvailableFontName } from './font-resolver'

export type ExistingCompositeNode = {
  id: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  name: string
  ownershipId: string | null
  groupOwnershipId: string | null
}

export type CompositePlanControlChild = {
  kind: 'control'
  controlId: string
  instanceId: string
  state: ControlState
  source: ControlToken
  controlGroupId: string
  controlOwnershipId: string
  sampleText: string | null
  supportingText: string | null
  placement?: NonNullable<CompositeToken['children'][number]['placement']>
}

export type CompositePlanCompositeChild = {
  kind: 'composite'
  compositeId: string
  compositeOwnershipId: string
  placement?: NonNullable<CompositeToken['children'][number]['placement']>
}

export type CompositePlanStaticTextRegionChild = {
  kind: 'static-text-region'
  source: StaticTextRegionChild
  typography: TypographyStyle | null
  fontName: AvailableFontName | null
  placement: StaticTextRegionChild['placement']
}

export type CompositePlanStructuralChild = {
  kind: 'structure'
  source: ControlToken | CompositeToken
  controlId?: string
  instanceId?: string
  compositeId?: string
  state: ControlState | CompositeState
  children?: Array<
    | CompositePlanStructuralChild
    | CompositePlanControlChild
    | CompositePlanStaticTextRegionChild
  >
  placement?: NonNullable<CompositeToken['children'][number]['placement']>
}

export type CompositePlanChild =
  | CompositePlanControlChild
  | CompositePlanCompositeChild
  | CompositePlanStructuralChild
  | CompositePlanStaticTextRegionChild

export type CompositeImportPlanEntry = {
  action: 'create' | 'update'
  source: CompositeToken
  layoutSource?: CompositeToken
  targetName: string
  ownershipId: string
  existingComponentId: string | null
  children: CompositePlanChild[]
}

export type CompositeImportPlanGroup = {
  action: 'create' | 'update' | 'skip_conflict'
  kind: 'component' | 'component_set'
  groupId: string
  templateId: string
  stateEvidenceId: string | null
  targetName: string
  groupOwnershipId: string
  existingGroupNodeId: string | null
  conflictName: string | null
  entries: CompositeImportPlanEntry[]
}

export type CompositeImportPlan = {
  source: ScanExport['source']
  groups: CompositeImportPlanGroup[]
}

const stateOrder: CompositeState[] = [
  'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
]

type CompositePresentationGroup = {
  key: string
  templateId: string
  stateEvidenceId: string | null
  instances: CompositeToken[]
  representatives: CompositeToken[]
}

type CompositeChildSize = { width: number; height: number }

const MAX_COMPOSITE_AXIS = 4096
const MAX_COMPOSITE_EXPANSION = 8

function controlSize(token: ControlToken): CompositeChildSize {
  return {
    width: Math.max(1, token.geometry.minWidth ?? token.geometry.height),
    height: Math.max(1, token.geometry.height)
  }
}

function naturalCompositeSize(
  token: CompositeToken,
  children: CompositeChildSize[],
  direction: CompositeToken['layout']['direction']
): CompositeChildSize {
  const gap = token.geometry.gap * Math.max(0, children.length - 1)
  const innerWidth = direction === 'horizontal'
    ? children.reduce((sum, child) => sum + child.width, 0) + gap
    : Math.max(0, ...children.map(child => child.width))
  const innerHeight = direction === 'vertical'
    ? children.reduce((sum, child) => sum + child.height, 0) + gap
    : Math.max(0, ...children.map(child => child.height))
  return {
    width: Math.max(
      1,
      token.geometry.padding.left + innerWidth + token.geometry.padding.right
    ),
    height: Math.max(
      1,
      token.geometry.padding.top + innerHeight + token.geometry.padding.bottom
    )
  }
}

function fitScore(observed: CompositeChildSize, natural: CompositeChildSize): number {
  return Math.abs(Math.log(Math.max(1, observed.width) / Math.max(1, natural.width))) +
    Math.abs(Math.log(Math.max(1, observed.height) / Math.max(1, natural.height)))
}

function boundedAxis(observed: number, natural: number): number {
  const maximum = Math.max(MAX_COMPOSITE_AXIS, natural * MAX_COMPOSITE_EXPANSION)
  return observed > maximum ? Number(natural.toFixed(4)) : observed
}

function normalizeCompositeTokens(
  tokens: CompositeToken[],
  controls: ControlToken[]
): CompositeToken[] {
  const controlsByBinding = new Map(controls.map(token => [
    controlBindingKey(token),
    token
  ]))
  const controlsById = new Map(controls.map(token => [token.id, token]))
  const sourceById = new Map(tokens.map(token => [token.id, token]))
  const normalizedById = new Map<string, CompositeToken>()
  const visiting = new Set<string>()

  const resolve = (source: CompositeToken): CompositeToken => {
    const existing = normalizedById.get(source.id)
    if (existing) return existing
    if (visiting.has(source.id)) return source
    visiting.add(source.id)
    const childSizes = source.children.map(child => {
      if (child.kind === 'control') {
        const control = controlsByBinding.get(controlBindingKey({
          id: child.controlId,
          instanceId: child.instanceId,
          state: child.state
        })) ?? controlsById.get(child.controlId)
        return control ? controlSize(control) : { width: 1, height: 1 }
      }
      if (child.kind === 'static-text-region') {
        return { width: child.placement.width, height: child.placement.height }
      }
      const dependency = sourceById.get(child.compositeId)
      const normalized = dependency ? resolve(dependency) : null
      return normalized
        ? { width: normalized.geometry.width, height: normalized.geometry.height }
        : { width: 1, height: 1 }
    })
    const horizontal = naturalCompositeSize(source, childSizes, 'horizontal')
    const vertical = naturalCompositeSize(source, childSizes, 'vertical')
    const observed = {
      width: source.geometry.width,
      height: source.geometry.height
    }
    const declared = source.layout.direction === 'horizontal' ? horizontal : vertical
    const alternative = source.layout.direction === 'horizontal' ? vertical : horizontal
    const alternativeDirection = source.layout.direction === 'horizontal'
      ? 'vertical' as const
      : 'horizontal' as const
    const axisUnbounded = observed.width > Math.max(
      MAX_COMPOSITE_AXIS,
      declared.width * MAX_COMPOSITE_EXPANSION
    ) || observed.height > Math.max(
      MAX_COMPOSITE_AXIS,
      declared.height * MAX_COMPOSITE_EXPANSION
    )
    const semanticVertical = source.kind === 'menu' || source.kind === 'popover'
    const alternateFitsBetter = fitScore(observed, alternative) + 0.75 <
      fitScore(observed, declared)
    const verticalFallback = axisUnbounded && semanticVertical &&
      alternativeDirection === 'vertical' &&
      fitScore(observed, alternative) <= fitScore(observed, declared) + 1.5
    const direction = alternateFitsBetter || verticalFallback
      ? alternativeDirection
      : source.layout.direction
    const natural = direction === 'horizontal' ? horizontal : vertical
    const normalized: CompositeToken = {
      ...source,
      geometry: {
        ...source.geometry,
        width: boundedAxis(source.geometry.width, natural.width),
        height: boundedAxis(source.geometry.height, natural.height)
      },
      layout: { ...source.layout, direction },
      name: `${source.kind}-${direction}`
    }
    visiting.delete(source.id)
    normalizedById.set(source.id, normalized)
    return normalized
  }

  return tokens.map(resolve)
}

function title(value: string): string {
  return value
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function groupName(token: CompositeToken): string {
  return [
    'Composite',
    title(token.kind),
    title(token.layout.direction),
    title(token.layout.widthBehavior)
  ].join('/')
}

function shellVisualKey(token: CompositeToken): string {
  return JSON.stringify({
    kind: token.kind,
    geometry: token.geometry,
    appearance: token.appearance,
    layout: token.layout
  })
}

function stateVisualKey(token: CompositeToken): string {
  return JSON.stringify({
    shell: shellVisualKey(token),
    children: token.children
  })
}

function compositeLeafCount(
  token: CompositeToken,
  byId: Map<string, CompositeToken>,
  visiting = new Set<string>()
): number {
  if (visiting.has(token.id)) return 0
  const next = new Set(visiting)
  next.add(token.id)
  return token.children.reduce((sum, child) => sum + (
    child.kind === 'control'
      ? 1
      : child.kind === 'static-text-region'
        ? 1
      : byId.has(child.compositeId)
        ? compositeLeafCount(byId.get(child.compositeId)!, byId, next)
        : 0
  ), 0)
}

function snapshotCompletenessOrder(
  left: CompositeToken,
  right: CompositeToken,
  byId: Map<string, CompositeToken>
): number {
  const leftPlaced = left.children.filter(child => child.placement).length
  const rightPlaced = right.children.filter(child => child.placement).length
  return compositeLeafCount(right, byId) - compositeLeafCount(left, byId) ||
    rightPlaced - leftPlaced ||
    right.geometry.width * right.geometry.height -
      left.geometry.width * left.geometry.height ||
    right.children.length - left.children.length ||
    right.stateOccurrences - left.stateOccurrences ||
    right.occurrences - left.occurrences ||
    left.id.localeCompare(right.id)
}

function orderedStateRepresentatives(
  tokens: CompositeToken[],
  byId = new Map(tokens.map(token => [token.id, token]))
): CompositeToken[] {
  const byState = new Map<CompositeState, CompositeToken[]>()
  for (const token of tokens) {
    const values = byState.get(token.state) ?? []
    values.push(token)
    byState.set(token.state, values)
  }
  return [...byState.entries()]
    .sort((left, right) => stateOrder.indexOf(left[0]) - stateOrder.indexOf(right[0]))
    .map(([, values]) => [...values].sort((left, right) =>
      snapshotCompletenessOrder(left, right, byId))[0]!)
}

function collapseVisualStates(states: CompositeToken[]): CompositeToken[] {
  const observed = new Set<string>()
  return states.filter(token => {
    const key = stateVisualKey(token)
    if (observed.has(key)) return false
    observed.add(key)
    return true
  })
}

function reusableCompositeVisualKey(
  token: CompositeToken,
  byId: Map<string, CompositeToken>,
  visiting = new Set<string>()
): string {
  if (visiting.has(token.id)) return `cycle:${token.templateId}`
  const next = new Set(visiting)
  next.add(token.id)
  return JSON.stringify({
    templateId: token.templateId,
    state: token.state,
    shell: shellVisualKey(token),
    children: token.children.map(child => child.kind === 'control'
      ? {
          kind: 'control',
          controlId: child.controlId,
          instanceId: child.instanceId,
          state: child.state,
          placement: child.placement ?? null
        }
      : child.kind === 'static-text-region'
        ? {
            kind: child.kind,
            templateId: child.templateId,
            instanceId: child.instanceId,
            placement: child.placement,
            geometry: child.geometry,
            appearance: child.appearance,
            text: child.text ?? null
          }
      : {
          kind: 'composite',
          placement: child.placement ?? null,
          visual: byId.has(child.compositeId)
            ? reusableCompositeVisualKey(byId.get(child.compositeId)!, byId, next)
            : null
        })
  })
}

function deduplicatePresentationGroups(
  groups: CompositePresentationGroup[],
  tokens: CompositeToken[]
): CompositePresentationGroup[] {
  const byId = new Map(tokens.map(token => [token.id, token]))
  const byPresentation = new Map<string, CompositePresentationGroup>()
  for (const group of [...groups].sort((left, right) => left.key.localeCompare(right.key))) {
    const key = JSON.stringify(group.representatives.map(token =>
      reusableCompositeVisualKey(token, byId)
    ))
    const existing = byPresentation.get(key)
    if (!existing) {
      byPresentation.set(key, group)
      continue
    }
    existing.instances.push(...group.instances)
    existing.representatives = existing.representatives.map(representative => {
      const matching = existing.instances.filter(token => token.state === representative.state)
      return {
        ...representative,
        occurrences: matching.reduce((sum, token) => sum + token.occurrences, 0),
        stateOccurrences: matching.reduce(
          (sum, token) => sum + token.stateOccurrences,
          0
        )
      }
    })
  }
  return [...byPresentation.values()]
}

function clusterCompositeTokens(tokens: CompositeToken[]): CompositePresentationGroup[] {
  const byId = new Map(tokens.map(token => [token.id, token]))
  const byLogical = new Map<string, CompositeToken[]>()
  for (const token of tokens) {
    const values = byLogical.get(token.logicalCompositeId) ?? []
    values.push(token)
    byLogical.set(token.logicalCompositeId, values)
  }

  const groups: CompositePresentationGroup[] = []
  for (const [logicalCompositeId, values] of byLogical) {
    const states = orderedStateRepresentatives(values, byId)
    const representatives = collapseVisualStates(states)
    const base = representatives.find(token => token.state === 'default') ??
      representatives[0]!
    groups.push({
      key: logicalCompositeId,
      templateId: base.templateId,
      stateEvidenceId: logicalCompositeId,
      instances: values,
      representatives
    })
  }
  return deduplicatePresentationGroups(groups, tokens)
}

function controlBindingKey(input: {
  id: string
  instanceId?: string
  state: string
}): string {
  return `${input.id}|${input.instanceId ?? input.id}|${input.state}`
}

function controlBindings(controlPlan: ControlImportPlan): Map<string, {
  group: ControlImportPlanGroup
  entry: ControlImportPlanEntry
  source: ControlToken
}> {
  const result = new Map<string, {
    group: ControlImportPlanGroup
    entry: ControlImportPlanEntry
    source: ControlToken
  }>()
  for (const group of controlPlan.groups) {
    for (const source of group.instances) {
      const matchingState = group.entries.find(entry => entry.source.state === source.state)
      const equivalentSource = matchingState ? undefined : group.instances.find(candidate =>
        candidate.state !== source.state &&
        (
          !source.instanceId ||
          candidate.instanceId === source.instanceId
        ) &&
        controlRenderedVisualKey(candidate) === controlRenderedVisualKey(source) &&
        group.entries.some(entry => entry.source.state === candidate.state)
      )
      const matchingVisual = equivalentSource
        ? group.entries.find(entry => entry.source.state === equivalentSource.state)
        : undefined
      const entry = matchingState ?? matchingVisual
      if (!entry) {
        throw new Error(`Control presentation has no equivalent entry for ${source.id}`)
      }
      result.set(controlBindingKey({
        id: source.id,
        instanceId: source.instanceId,
        state: source.state
      }), { group, entry, source })
    }
  }
  return result
}

function topologicalGroups(
  groups: CompositePresentationGroup[],
  groupByCompositeId: Map<string, CompositePresentationGroup>,
  knownCompositeIds: Set<string>
): CompositePresentationGroup[] {
  const result: CompositePresentationGroup[] = []
  const visiting = new Set<CompositePresentationGroup>()
  const visited = new Set<CompositePresentationGroup>()
  const visit = (group: CompositePresentationGroup): void => {
    if (visited.has(group)) return
    if (visiting.has(group)) throw new Error('Composite graph contains a cycle')
    visiting.add(group)
    for (const source of group.instances) {
      for (const child of source.children) {
        if (child.kind !== 'composite') continue
        const dependency = groupByCompositeId.get(child.compositeId)
        if (!dependency) {
          if (knownCompositeIds.has(child.compositeId)) continue
          throw new Error('Composite child cannot be resolved')
        }
        visit(dependency)
      }
    }
    visiting.delete(group)
    visited.add(group)
    result.push(group)
  }
  for (const group of groups) visit(group)
  return result
}

export function createCompositeImportPlan(
  data: ScanExport,
  controlPlan: ControlImportPlan,
  existingNodes: ExistingCompositeNode[],
  availableFonts: AvailableFontName[] = []
): CompositeImportPlan {
  if (data.composites.length === 0) return { source: data.source, groups: [] }
  const normalized = normalizeCompositeTokens(data.composites, data.controls)
  const designerFacing = designerFacingCompositeIds(normalized, data.controls)
  const presentations = clusterCompositeTokens(
    normalized.filter(token => designerFacing.has(token.id))
  )
  if (presentations.length === 0) return { source: data.source, groups: [] }
  const normalizedById = new Map(normalized.map(token => [token.id, token]))
  const controlsByBinding = new Map(data.controls.map(token => [
    controlBindingKey(token),
    token
  ]))
  const controlsById = new Map<string, ControlToken[]>()
  for (const token of data.controls) {
    const values = controlsById.get(token.id) ?? []
    values.push(token)
    controlsById.set(token.id, values)
  }
  const controls = controlBindings(controlPlan)
  const typographyById = new Map(data.typography.map(token => [token.id, token]))
  const staticTextRegionChild = (
    child: StaticTextRegionChild
  ): CompositePlanStaticTextRegionChild => {
    const typography = child.text
      ? typographyById.get(child.text.typographyId) ?? null
      : null
    if (child.text && !typography) {
      throw new Error('Static UI copy typography cannot be resolved')
    }
    return {
      kind: 'static-text-region',
      source: child,
      typography,
      fontName: typography
        ? resolveFont(
            typography.fontFamilyStack,
            typography.fontWeight,
            typography.fontStyle,
            availableFonts,
            data.source.platform
          )
        : null,
      placement: child.placement
    }
  }
  const controlChild = (
    child: Extract<CompositeToken['children'][number], { kind: 'control' }>
  ): CompositePlanControlChild | CompositePlanStructuralChild => {
    const bindingKey = controlBindingKey({
      id: child.controlId,
      instanceId: child.instanceId,
      state: child.state
    })
    const binding = controls.get(bindingKey)
    if (binding) {
      return {
        kind: 'control',
        controlId: child.controlId,
        instanceId: child.instanceId,
        state: child.state,
        source: binding.source,
        controlGroupId: binding.group.groupId,
        controlOwnershipId: binding.entry.ownershipId,
        sampleText: binding.source.sampleText?.value ?? null,
        supportingText: binding.source.supportingText?.value ?? null,
        ...(child.placement ? { placement: child.placement } : {})
      }
    }
    const structuralSource = controlsByBinding.get(bindingKey) ??
      (controlsById.get(child.controlId) ?? []).find(source =>
        !isRenderableControlPresentation(source)
      )
    if (!structuralSource || isRenderableControlPresentation(structuralSource)) {
      throw new Error('Composite control child cannot be resolved')
    }
    return {
      kind: 'structure',
      controlId: child.controlId,
      instanceId: child.instanceId,
      state: child.state,
      source: structuralSource,
      ...(child.placement ? { placement: child.placement } : {})
    }
  }
  const structuralChildren = (
    source: CompositeToken,
    visiting = new Set<string>()
  ): Array<
    | CompositePlanStructuralChild
    | CompositePlanControlChild
    | CompositePlanStaticTextRegionChild
  > => {
    if (visiting.has(source.id)) return []
    const nextVisiting = new Set(visiting)
    nextVisiting.add(source.id)
    return source.children.map(child => {
      if (child.kind === 'control') return controlChild(child)
      if (child.kind === 'static-text-region') return staticTextRegionChild(child)
      const structuralSource = normalizedById.get(child.compositeId)
      if (!structuralSource) {
        throw new Error('Composite structural child cannot be resolved')
      }
      return {
        kind: 'structure' as const,
        compositeId: child.compositeId,
        state: structuralSource.state,
        source: structuralSource,
        children: structuralChildren(structuralSource, nextVisiting),
        ...(child.placement ? { placement: child.placement } : {})
      }
    })
  }
  const groupByCompositeId = new Map<string, CompositePresentationGroup>()
  for (const group of presentations) {
    for (const instance of group.instances) groupByCompositeId.set(instance.id, group)
  }
  const ordered = topologicalGroups(
    presentations,
    groupByCompositeId,
    new Set(normalizedById.keys())
  )
  const entryOwnershipByCompositeId = new Map<string, string>()
  for (const group of ordered) {
    for (const source of group.instances) {
      const matchingState = group.representatives.find(item => item.state === source.state)
      const equivalentSource = matchingState ? undefined : group.instances.find(candidate =>
        candidate.state !== source.state &&
        (
          !source.logicalCompositeId ||
          candidate.logicalCompositeId === source.logicalCompositeId
        ) &&
        stateVisualKey(candidate) === stateVisualKey(source) &&
        group.representatives.some(item => item.state === candidate.state)
      )
      const representative = matchingState ?? (equivalentSource
        ? group.representatives.find(item => item.state === equivalentSource.state)
        : undefined)
      if (!representative) {
        throw new Error(`Composite presentation has no equivalent entry for ${source.id}`)
      }
      entryOwnershipByCompositeId.set(
        source.id,
        `${data.source.origin}|composite:${representative.id}`
      )
    }
  }

  const baseNames = ordered.map(group => groupName(
    group.representatives.find(token => token.state === 'default') ??
      group.representatives[0]!
  ))
  const baseCounts = new Map<string, number>()
  for (const name of baseNames) baseCounts.set(name, (baseCounts.get(name) ?? 0) + 1)
  const existingByOwnership = new Map(existingNodes
    .filter(node => node.ownershipId)
    .map(node => [node.ownershipId!, node]))
  const existingByGroupOwnership = new Map(existingNodes
    .filter(node => node.groupOwnershipId)
    .map(node => [node.groupOwnershipId!, node]))
  const originPrefix = `${data.source.origin}|`

  const plans = ordered.map((group, groupIndex): CompositeImportPlanGroup => {
    const kind = group.representatives.length > 1
      ? 'component_set' as const
      : 'component' as const
    const baseName = baseNames[groupIndex]!
    const targetName = (baseCounts.get(baseName) ?? 0) > 1
      ? `${baseName} · ${group.key.slice('sha256:'.length, 'sha256:'.length + 6)}`
      : baseName
    const groupOwnershipId =
      `${data.source.origin}|composite-presentation:${group.key}`
    const groupNode = existingByGroupOwnership.get(groupOwnershipId)
    const singleOwnershipId =
      `${data.source.origin}|composite:${group.representatives[0]!.id}`
    const obsoleteSetAtTarget = kind === 'component'
      ? existingNodes.find(node =>
          node.type === 'COMPONENT_SET' &&
          node.name === targetName &&
          (
            node.ownershipId?.startsWith(originPrefix) ||
            node.groupOwnershipId?.startsWith(originPrefix)
          )
        )
      : undefined
    const replacingComponentSet = Boolean(obsoleteSetAtTarget)
    const exact = kind === 'component_set'
      ? groupNode
      : replacingComponentSet
        ? undefined
        : existingByOwnership.get(singleOwnershipId)
    const collision = existingNodes.find(node =>
      node.name === targetName &&
      node.id !== exact?.id &&
      !node.ownershipId?.startsWith(originPrefix) &&
      !node.groupOwnershipId?.startsWith(originPrefix)
    )
    const action = collision ? 'skip_conflict' as const
      : exact ? 'update' as const
        : 'create' as const

    const entries = group.representatives.map(source => {
      const ownershipId = `${data.source.origin}|composite:${source.id}`
      const existing = replacingComponentSet
        ? undefined
        : existingByOwnership.get(ownershipId)
      const plannedChildren = source.children.map(child => {
        if (child.kind === 'static-text-region') {
          return { sourceChild: child, planChild: staticTextRegionChild(child) }
        }
        if (child.kind === 'composite') {
          const compositeOwnershipId = entryOwnershipByCompositeId.get(child.compositeId)
          if (!compositeOwnershipId) {
            const structuralSource = normalizedById.get(child.compositeId)
            if (!structuralSource) throw new Error('Composite child cannot be resolved')
            return {
              sourceChild: child,
              planChild: {
              kind: 'structure',
              compositeId: child.compositeId,
              state: structuralSource.state,
              source: structuralSource,
              children: structuralChildren(structuralSource),
              ...(child.placement ? { placement: child.placement } : {})
              } satisfies CompositePlanStructuralChild
            }
          }
          return {
            sourceChild: child,
            planChild: {
              kind: 'composite',
              compositeId: child.compositeId,
              compositeOwnershipId,
              ...(child.placement ? { placement: child.placement } : {})
            } satisfies CompositePlanCompositeChild
          }
        }
        return { sourceChild: child, planChild: controlChild(child) }
      })
      const hasMeasuredChildren = source.children.some(child => child.placement)
      const retainedChildren = plannedChildren.filter(({ sourceChild, planChild }) => !(
        hasMeasuredChildren &&
        !sourceChild.placement &&
        sourceChild.kind === 'control' &&
        planChild.kind === 'structure'
      ))
      const children: CompositePlanChild[] = retainedChildren.map(item => item.planChild)
      const layoutSource = retainedChildren.length === source.children.length
        ? undefined
        : {
            ...source,
            children: retainedChildren.map(item => item.sourceChild)
          }
      return {
        action: existing ? 'update' as const : 'create' as const,
        source,
        ...(layoutSource ? { layoutSource } : {}),
        targetName: kind === 'component_set'
          ? `State=${title(source.state)}`
          : targetName,
        ownershipId,
        existingComponentId: existing?.type === 'COMPONENT' ? existing.id : null,
        children
      }
    })
    return {
      action,
      kind,
      groupId: group.key,
      templateId: group.templateId,
      stateEvidenceId: group.stateEvidenceId,
      targetName,
      groupOwnershipId,
      existingGroupNodeId: exact?.id ?? collision?.id ?? null,
      conflictName: collision?.name ?? null,
      entries
    }
  })
  const unavailableControlGroups = new Set(controlPlan.groups
    .filter(group => group.action === 'skip_conflict')
    .map(group => group.groupId))
  const unavailableCompositeOwnerships = new Set<string>()
  const childHasUnavailableDependency = (child: CompositePlanChild): boolean => {
    if (child.kind === 'control') {
      return unavailableControlGroups.has(child.controlGroupId)
    }
    if (child.kind === 'composite') {
      return unavailableCompositeOwnerships.has(child.compositeOwnershipId)
    }
    if (child.kind === 'static-text-region') return false
    return child.children?.some(childHasUnavailableDependency) ?? false
  }
  for (const plan of plans) {
    if (
      plan.action !== 'skip_conflict' &&
      plan.entries.some(entry => entry.children.some(childHasUnavailableDependency))
    ) {
      plan.action = 'skip_conflict'
    }
    if (plan.action === 'skip_conflict') {
      for (const entry of plan.entries) {
        unavailableCompositeOwnerships.add(entry.ownershipId)
      }
    }
  }
  return { source: data.source, groups: plans }
}
