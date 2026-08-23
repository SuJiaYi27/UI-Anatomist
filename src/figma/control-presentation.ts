import type {
  ColorValue,
  ControlContentKind,
  ControlFamily,
  ControlIntent,
  ControlState,
  ControlToken
} from '../shared/schema'

export type ControlPresentationSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type ControlPresentationSurface =
  | 'ghost'
  | 'outline'
  | 'soft'
  | 'solid-light'
  | 'solid-dark'
  | 'accent'
export type ControlPresentationForeground = 'dark' | 'muted' | 'light' | 'accent'

export type ControlPresentationGroup = {
  key: string
  templateId: string
  name: string
  family: ControlFamily
  intent: ControlIntent
  size: ControlPresentationSize
  surface: ControlPresentationSurface
  foreground: ControlPresentationForeground
  structure: ControlContentKind
  sourceIds: string[]
  states: ControlToken[]
  instances: ControlToken[]
  stateEvidenceId: string | null
  representatives: ControlToken[]
}

const stateOrder: ControlState[] = [
  'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
]

function title(value: string): string {
  return value
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function luminance(value: ColorValue): number {
  return 0.2126 * value.r + 0.7152 * value.g + 0.0722 * value.b
}

export function controlPresentationSize(height: number): ControlPresentationSize {
  if (height <= 20) return 'xxs'
  if (height <= 30) return 'xs'
  if (height <= 38) return 'sm'
  if (height <= 44) return 'md'
  if (height <= 52.5) return 'lg'
  return 'xl'
}

export function controlPresentationSurface(
  token: ControlToken
): ControlPresentationSurface {
  const background = token.appearance.background
  const border = token.appearance.border
  if (background.a <= 0.05) {
    return token.geometry.borderWidth > 0 && border.a > 0.05 ? 'outline' : 'ghost'
  }
  if (
    background.b > background.r * 1.3 &&
    background.b > background.g * 1.15
  ) return 'accent'
  const value = luminance(background)
  if (value < 0.2) return 'solid-dark'
  if (value > 0.9) {
    return token.geometry.borderWidth > 0 && border.a > 0.05
      ? 'outline'
      : 'solid-light'
  }
  return 'soft'
}

export function controlPresentationForeground(
  value: ColorValue
): ControlPresentationForeground {
  if (value.b > value.r * 1.3 && value.b > value.g * 1.1) return 'accent'
  const lightness = luminance(value)
  if (lightness < 0.18) return 'dark'
  if (lightness > 0.82) return 'light'
  return 'muted'
}

export function controlContentKind(token: ControlToken): ControlContentKind {
  if (token.content) return token.content.kind
  if (token.slots.leading || token.slots.trailing) return 'icon-only'
  if (['toggle', 'checkbox', 'radio'].includes(token.family)) return 'empty'
  return 'text-only'
}

function evidenceOrder(left: ControlToken, right: ControlToken): number {
  if (
    controlContentKind(left) === 'compound-row' &&
    controlContentKind(right) === 'compound-row'
  ) {
    const compoundRank = (token: ControlToken): number[] => {
      const vector = token.slots.leading?.vectorSvg ?? ''
      const shapeCount = (vector.match(
        /<(?:path|line|polyline|polygon|circle|rect|ellipse)\b/gi
      ) ?? []).length
      return [
      token.content?.kind === 'compound-row' && token.content.trailing === 'none' ? 1 : 0,
      token.slots.leading?.assetType === 'ui-icon' &&
        Boolean(token.slots.leading.vectorSvg) ? 1 : 0,
      token.slots.leading?.assetType === 'ui-icon' ? 1 : 0,
      Boolean(token.sampleText && token.supportingText) ? 1 : 0,
      vector ? -shapeCount : Number.NEGATIVE_INFINITY,
      vector ? -vector.length : Number.NEGATIVE_INFINITY
      ]
    }
    const leftRank = compoundRank(left)
    const rightRank = compoundRank(right)
    for (let index = 0; index < leftRank.length; index += 1) {
      const difference = rightRank[index]! - leftRank[index]!
      if (difference !== 0) return difference
    }
  }
  if (
    controlContentKind(left) === 'icon-only' &&
    controlContentKind(right) === 'icon-only'
  ) {
    const iconRank = (token: ControlToken): number[] => {
      const slot = token.slots.leading ?? token.slots.trailing
      const vector = slot?.vectorSvg ?? ''
      const shapeCount = (vector.match(
        /<(?:path|line|polyline|polygon|circle|rect|ellipse)\b/gi
      ) ?? []).length
      return [
        slot?.assetType === 'ui-icon' && Boolean(vector) ? 1 : 0,
        slot?.assetType === 'ui-icon' ? 1 : 0,
        vector ? -shapeCount : Number.NEGATIVE_INFINITY,
        vector ? -vector.length : Number.NEGATIVE_INFINITY
      ]
    }
    const leftRank = iconRank(left)
    const rightRank = iconRank(right)
    for (let index = 0; index < leftRank.length; index += 1) {
      const leftValue = leftRank[index]!
      const rightValue = rightRank[index]!
      if (leftValue !== rightValue) return rightValue - leftValue
    }
  }
  const sampleDifference =
    Number(Boolean(right.sampleText)) - Number(Boolean(left.sampleText))
  if (sampleDifference !== 0) return sampleDifference
  if (left.sampleText && right.sampleText) {
    const surfaceDifference =
      substantiveSurfaceScore(right) - substantiveSurfaceScore(left)
    return surfaceDifference ||
      right.occurrences - left.occurrences ||
      right.stateOccurrences - left.stateOccurrences ||
      left.id.localeCompare(right.id)
  }
  return substantiveSurfaceScore(right) - substantiveSurfaceScore(left) ||
    right.stateOccurrences - left.stateOccurrences ||
    right.occurrences - left.occurrences ||
    left.id.localeCompare(right.id)
}

function substantiveSurfaceScore(token: ControlToken): number {
  const background = token.appearance.background.a > 0.05
    ? 400 + token.appearance.background.a * 100
    : 0
  const border = token.geometry.borderWidth > 0 &&
    token.appearance.border.a > 0.05
    ? 300 + token.appearance.border.a * 100
    : 0
  const outline = token.appearance.outlineWidth > 0 &&
    token.appearance.outline.a > 0.05
    ? 200 + token.appearance.outline.a * 100
    : 0
  const shadow = token.appearance.shadows.some(item => item.color.a > 0.05)
    ? 100
    : 0
  return Math.max(background, border, outline, shadow)
}

export function hasRenderableControlSurface(token: ControlToken): boolean {
  return substantiveSurfaceScore(token) > 0
}

export function isRenderableControlPresentation(token: ControlToken): boolean {
  if (token.sampleText || token.supportingText) return true
  if (hasRenderableControlSurface(token)) return true
  const hasGraphic = Boolean(token.slots.leading || token.slots.trailing) ||
    (token.slotGroups?.leading.length ?? 0) > 0 ||
    (token.slotGroups?.trailing.length ?? 0) > 0
  if (!hasGraphic || controlContentKind(token) !== 'icon-only') return false
  const observedWidth = token.geometry.minWidth ?? token.geometry.height
  return token.geometry.height <= 64 &&
    observedWidth <= token.geometry.height * 2
}

function presentationKey(token: ControlToken): string {
  return [
    token.family,
    token.intent,
    controlPresentationSize(token.geometry.height),
    controlPresentationSurface(token),
    controlPresentationForeground(token.appearance.foreground),
    controlContentKind(token)
  ].join('|')
}

function hasModernIdentity(token: ControlToken): token is ControlToken & {
  templateId: string
  logicalControlId: string
  instanceId: string
} {
  return Boolean(token.templateId && token.logicalControlId && token.instanceId)
}

function normalizedVisualSlot(
  slot: ControlToken['slots']['leading'],
  includeInstanceEvidence: boolean
) {
  if (!slot) return null
  return {
    width: slot.width,
    height: slot.height,
    surface: slot.surface ?? null,
    ...(includeInstanceEvidence
      ? {
          assetType: slot.assetType ?? null,
          vectorSvg: slot.assetType === 'ui-icon' ? slot.vectorSvg ?? null : null
        }
      : {})
  }
}

/**
 * A state-free rendering signature. Reusable-template grouping deliberately
 * excludes concrete copy and icon geometry; state collapsing includes them so
 * a genuinely different evidenced state is never discarded as "identical".
 */
function visualControlKey(
  token: ControlToken,
  includeInstanceEvidence: boolean
): string {
  return JSON.stringify({
    family: token.family,
    intent: token.intent,
    size: token.size,
    geometry: token.geometry,
    appearance: token.appearance,
    typography: token.typography,
    slots: {
      leading: normalizedVisualSlot(token.slots.leading, includeInstanceEvidence),
      trailing: normalizedVisualSlot(token.slots.trailing, includeInstanceEvidence)
    },
    slotGroups: token.slotGroups
      ? {
          leading: token.slotGroups.leading.map(slot =>
            normalizedVisualSlot(slot, includeInstanceEvidence)),
          trailing: token.slotGroups.trailing.map(slot =>
            normalizedVisualSlot(slot, includeInstanceEvidence))
        }
      : null,
    content: token.content ?? null,
    layout: token.layout ?? null,
    supportingStyle: token.supportingStyle ?? null,
    ...(includeInstanceEvidence
      ? {
          sampleText: token.sampleText?.value ?? null,
          supportingText: token.supportingText?.value ?? null
        }
      : {})
  })
}

export function controlRenderedVisualKey(token: ControlToken): string {
  return visualControlKey(token, true)
}

function hasConflictingSafeInstanceEvidence(tokens: ControlToken[]): boolean {
  const values = (select: (token: ControlToken) => string | null): boolean => {
    const observed = new Set(tokens.map(select).filter((value): value is string => Boolean(value)))
    return observed.size > 1
  }
  const slotVector = (
    token: ControlToken,
    side: 'leading' | 'trailing'
  ): string | null => {
    const slot = token.slots[side]
    return slot?.assetType === 'ui-icon' && slot.vectorSvg
      ? slot.vectorSvg
      : null
  }
  return values(token => token.sampleText?.value ?? null) ||
    values(token => token.supportingText?.value ?? null) ||
    values(token => slotVector(token, 'leading')) ||
    values(token => slotVector(token, 'trailing'))
}

function structuralCompatibilityKey(token: ControlToken): string {
  const content = token.content
  const kind = controlContentKind(token)
  return [
    kind,
    token.layout?.widthBehavior ?? 'hug',
    token.slots.leading ? 'leading' : 'no-leading',
    token.slots.trailing ? 'trailing' : 'no-trailing',
    `leading-group-${token.slotGroups?.leading.length ?? 0}`,
    `trailing-group-${token.slotGroups?.trailing.length ?? 0}`,
    token.supportingText ? 'supporting' : 'no-supporting',
    content?.kind === 'compound-row' ? content.textFlow : 'single',
    content?.kind === 'compound-row' ? content.trailing : 'none'
  ].join('|')
}

function structuralVariantName(token: ControlToken): string {
  const content = token.content
  return [
    title(token.layout?.widthBehavior ?? 'hug'),
    token.slots.leading ? 'Leading' : 'NoLeading',
    token.slots.trailing ? 'Trailing' : 'NoTrailing',
    `LeadingGroup${token.slotGroups?.leading.length ?? 0}`,
    `TrailingGroup${token.slotGroups?.trailing.length ?? 0}`,
    token.supportingText ? 'Supporting' : 'SingleLabel',
    ...(content?.kind === 'compound-row'
      ? [title(content.textFlow), title(content.trailing)]
      : [])
  ].join('-')
}

function groupName(
  family: ControlFamily,
  intent: ControlIntent,
  surface: ControlPresentationSurface,
  size: ControlPresentationSize,
  foreground: ControlPresentationForeground,
  structure: ControlContentKind
): string {
  const presentationFamily = structure === 'compound-row'
    ? 'MenuItem'
    : title(family)
  return [
    'Control',
    presentationFamily,
    title(intent),
    title(surface),
    title(size),
    title(foreground),
    title(structure)
  ].join('/')
}

function stateRepresentatives(values: ControlToken[]): ControlToken[] {
  const byState = new Map<ControlState, ControlToken[]>()
  for (const value of values) {
    const stateValues = byState.get(value.state) ?? []
    stateValues.push(value)
    byState.set(value.state, stateValues)
  }
  return [...byState.entries()]
    .sort((left, right) => stateOrder.indexOf(left[0]) - stateOrder.indexOf(right[0]))
    .map(([, stateValues]) => [...stateValues].sort(evidenceOrder)[0]!)
}

function splitConflictingStateVisuals(values: ControlToken[]): {
  family: ControlToken[]
  overflow: ControlToken[]
} {
  const byState = new Map<ControlState, ControlToken[]>()
  for (const value of values) {
    const stateValues = byState.get(value.state) ?? []
    stateValues.push(value)
    byState.set(value.state, stateValues)
  }
  const family: ControlToken[] = []
  const overflow: ControlToken[] = []
  for (const stateValues of byState.values()) {
    const byVisual = new Map<string, ControlToken[]>()
    for (const value of stateValues) {
      const key = visualControlKey(value, false)
      const visualValues = byVisual.get(key) ?? []
      visualValues.push(value)
      byVisual.set(key, visualValues)
    }
    const visualGroups = [...byVisual.entries()].sort((left, right) => {
      const leftBest = [...left[1]].sort(evidenceOrder)[0]!
      const rightBest = [...right[1]].sort(evidenceOrder)[0]!
      return evidenceOrder(leftBest, rightBest) || left[0].localeCompare(right[0])
    })
    family.push(...(visualGroups[0]?.[1] ?? []))
    for (const [, extras] of visualGroups.slice(1)) overflow.push(...extras)
  }
  return { family, overflow }
}

function distinctVisualRepresentatives(states: ControlToken[]): ControlToken[] {
  const observed = new Set<string>()
  return states.filter(token => {
    const key = controlRenderedVisualKey(token)
    if (observed.has(key)) return false
    observed.add(key)
    return true
  })
}

function createPresentationGroup(input: {
  key: string
  templateId: string
  values: ControlToken[]
  states: ControlToken[]
  representatives: ControlToken[]
  stateEvidenceId: string | null
  splitStructure: boolean
}): ControlPresentationGroup {
  const base = input.representatives.find(token => token.state === 'default') ??
    [...input.representatives].sort(evidenceOrder)[0]!
  const size = controlPresentationSize(base.geometry.height)
  const surface = controlPresentationSurface(base)
  const foreground = controlPresentationForeground(base.appearance.foreground)
  const structure = controlContentKind(base)
  const baseName = groupName(
    base.family,
    base.intent,
    surface,
    size,
    foreground,
    structure
  )
  return {
    key: input.key,
    templateId: input.templateId,
    name: input.splitStructure
      ? `${baseName}/${structuralVariantName(base)}`
      : baseName,
    family: base.family,
    intent: base.intent,
    size,
    surface,
    foreground,
    structure,
    sourceIds: [...new Set(input.values.map(value => value.id))].sort(),
    states: input.states,
    instances: [...input.values].sort((left, right) =>
      stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state) ||
      left.id.localeCompare(right.id)),
    stateEvidenceId: input.stateEvidenceId,
    representatives: input.representatives
  }
}

function reusableControlProjectionKey(
  tokens: ControlToken[]
): string | null {
  if (tokens.length === 0 || !tokens.every(hasModernIdentity)) return null
  const templateIds = new Set(tokens.map(token => token.templateId))
  if (templateIds.size !== 1) return null
  const states = stateRepresentatives(tokens)
  if (states.length === 0) return null
  return JSON.stringify({
    templateId: states[0]!.templateId,
    structure: states[0]
      ? structuralCompatibilityKey(states[0])
      : '',
    states: states.map(token => ({
      state: token.state,
      visual: visualControlKey(token, false)
    }))
  })
}

export function reusableControlStateFamilyKey(
  tokens: ControlToken[]
): string | null {
  const states = stateRepresentatives(tokens)
  if (new Set(states.map(token => token.state)).size <= 1) return null
  return reusableControlProjectionKey(states)
}

function mergeReusableStateFamilies(
  groups: ControlPresentationGroup[]
): ControlPresentationGroup[] {
  const byReusableFamily = new Map<string, ControlPresentationGroup>()
  for (const group of groups) {
    const reusableKey = reusableControlProjectionKey(group.representatives)
    const familyKey = reusableKey ?? group.key
    if (reusableKey) {
      group.key = `reusable:${reusableKey}`
    }
    const existing = byReusableFamily.get(familyKey)
    if (!existing) {
      byReusableFamily.set(familyKey, group)
      continue
    }
    const instances = new Map<string, ControlToken>()
    for (const token of [...existing.instances, ...group.instances]) {
      instances.set(
        `${token.id}|${token.instanceId ?? token.id}|${token.state}`,
        token
      )
    }
    existing.key = [existing.key, group.key].sort()[0]!
    existing.sourceIds = [...new Set([
      ...existing.sourceIds,
      ...group.sourceIds
    ])].sort()
    existing.instances = [...instances.values()]
    existing.states = stateRepresentatives(existing.instances)
    existing.representatives = distinctVisualRepresentatives(existing.states)
    if (existing.stateEvidenceId !== group.stateEvidenceId) {
      existing.stateEvidenceId = null
    }
  }
  return [...byReusableFamily.values()]
}

function clusterModernControlTokens(
  tokens: Array<ControlToken & {
    templateId: string
    logicalControlId: string
    instanceId: string
  }>
): ControlPresentationGroup[] {
  const byLogicalControl = new Map<string, typeof tokens>()
  for (const token of tokens) {
    const values = byLogicalControl.get(token.logicalControlId) ?? []
    values.push(token)
    byLogicalControl.set(token.logicalControlId, values)
  }

  const stateFamilies: ControlPresentationGroup[] = []
  const standalone: typeof tokens = []
  for (const [logicalControlId, values] of byLogicalControl) {
    const observedStates = new Set(values.map(token => token.state))
    if (observedStates.size <= 1) {
      standalone.push(...values)
      continue
    }
    const byStructure = new Map<string, typeof tokens>()
    for (const value of values) {
      const structureKey = structuralCompatibilityKey(value)
      const compatible = byStructure.get(structureKey) ?? []
      compatible.push(value)
      byStructure.set(structureKey, compatible)
    }
    const splitStructure = byStructure.size > 1
    for (const [structureKey, compatible] of byStructure) {
      const splitVisuals = splitConflictingStateVisuals(compatible)
      standalone.push(...splitVisuals.overflow)
      const states = stateRepresentatives(splitVisuals.family)
      if (new Set(states.map(token => token.state)).size <= 1) {
        standalone.push(...splitVisuals.family)
        continue
      }
      const representatives = distinctVisualRepresentatives(states)
      const base = representatives.find(token => token.state === 'default') ??
        representatives[0]!
      stateFamilies.push(createPresentationGroup({
        key: splitStructure
          ? `${logicalControlId}|structure:${structureKey}`
          : logicalControlId,
        templateId: base.templateId,
        values: splitVisuals.family,
        states,
        representatives,
        stateEvidenceId: logicalControlId,
        splitStructure
      }))
    }
  }
  const evidencedGroupBySourceId = new Map<string, ControlPresentationGroup>()
  const instanceKeysByGroup = new Map<ControlPresentationGroup, Set<string>>()
  for (const group of stateFamilies) {
    for (const source of group.instances) {
      evidencedGroupBySourceId.set(
        `${group.templateId}|${source.id}|${structuralCompatibilityKey(source)}|${visualControlKey(source, false)}`,
        group
      )
    }
    instanceKeysByGroup.set(group, new Set(group.instances.map(token =>
      `${token.id}|${token.instanceId ?? token.id}|${token.state}`
    )))
  }
  const standaloneByVisualForm = new Map<string, typeof tokens>()
  for (const token of standalone) {
    const evidencedGroup = evidencedGroupBySourceId.get(
      `${token.templateId}|${token.id}|${structuralCompatibilityKey(token)}|${visualControlKey(token, false)}`
    )
    if (evidencedGroup) {
      const key = `${token.id}|${token.instanceId ?? token.id}|${token.state}`
      const instanceKeys = instanceKeysByGroup.get(evidencedGroup)!
      if (!instanceKeys.has(key)) {
        evidencedGroup.instances.push(token)
        instanceKeys.add(key)
      }
      continue
    }
    const key = `${token.templateId}|${visualControlKey(token, false)}`
    const values = standaloneByVisualForm.get(key) ?? []
    values.push(token)
    standaloneByVisualForm.set(key, values)
  }
  for (const group of stateFamilies) {
    group.instances.sort((left, right) =>
      stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state) ||
      left.id.localeCompare(right.id) ||
      (left.instanceId ?? left.id).localeCompare(right.instanceId ?? right.id)
    )
  }
  const standaloneGroups = [...standaloneByVisualForm.values()].map(values => {
    const states = stateRepresentatives(values)
    const representatives = distinctVisualRepresentatives(states)
    const base = representatives.find(token => token.state === 'default') ??
      [...representatives].sort(evidenceOrder)[0]!
    return createPresentationGroup({
      key: base.id,
      templateId: base.templateId,
      values,
      states,
      representatives,
      stateEvidenceId: null,
      splitStructure: false
    })
  })

  return [...stateFamilies, ...standaloneGroups]
}

function clusterLegacyControlTokens(tokens: ControlToken[]): ControlPresentationGroup[] {
  const renderableTokens = tokens
  const statesByRawGroup = new Map<string, Set<ControlState>>()
  for (const token of renderableTokens) {
    const states = statesByRawGroup.get(token.groupId) ?? new Set<ControlState>()
    states.add(token.state)
    statesByRawGroup.set(token.groupId, states)
  }

  const linkedPresentationKeys = new Map<string, string>()
  for (const [groupId] of statesByRawGroup) {
    const members = renderableTokens.filter(token => token.groupId === groupId)
    if (members.length <= 1) continue
    if (hasConflictingSafeInstanceEvidence(members)) continue
    const defaultMembers = members.filter(token => token.state === 'default')
    const base = [...(defaultMembers.length > 0 ? defaultMembers : members)]
      .sort(evidenceOrder)[0]
    if (base) linkedPresentationKeys.set(groupId, presentationKey(base))
  }

  const candidates = renderableTokens.map(token => ({
    token,
    key: linkedPresentationKeys.get(token.groupId) ?? presentationKey(token),
    structureKey: structuralCompatibilityKey(token)
  }))
  const structuresByKey = new Map<string, Set<string>>()
  const statesByKey = new Map<string, Set<ControlState>>()
  for (const candidate of candidates) {
    const structures = structuresByKey.get(candidate.key) ?? new Set<string>()
    structures.add(candidate.structureKey)
    structuresByKey.set(candidate.key, structures)
    const states = statesByKey.get(candidate.key) ?? new Set<ControlState>()
    states.add(candidate.token.state)
    statesByKey.set(candidate.key, states)
  }

  const grouped = new Map<string, ControlToken[]>()
  for (const candidate of candidates) {
    const splitForVariantSafety =
      (statesByKey.get(candidate.key)?.size ?? 0) > 1 &&
      (structuresByKey.get(candidate.key)?.size ?? 0) > 1
    const key = splitForVariantSafety
      ? `${candidate.key}|structure:${candidate.structureKey}`
      : candidate.key
    const values = grouped.get(key) ?? []
    values.push(candidate.token)
    grouped.set(key, values)
  }

  return [...grouped.entries()].map(([key, values]) => {
    const states = stateRepresentatives(values)
    const evidenceIds = new Set(values
      .filter(value => linkedPresentationKeys.has(value.groupId))
      .map(value => value.groupId))
    return createPresentationGroup({
      key,
      templateId: states.find(token => token.state === 'default')?.groupId ??
        states[0]!.groupId,
      values,
      states,
      representatives: states,
      stateEvidenceId: evidenceIds.size === 1 && states.length > 1
        ? [...evidenceIds][0]!
        : null,
      splitStructure: key.includes('|structure:')
    })
  })
}

export function clusterControlTokens(tokens: ControlToken[]): ControlPresentationGroup[] {
  const renderableTokens = tokens.filter(isRenderableControlPresentation)
  const modern = renderableTokens.filter(hasModernIdentity)
  const legacy = renderableTokens.filter(token => !hasModernIdentity(token))
  return [
    ...clusterModernControlTokens(modern),
    ...clusterLegacyControlTokens(legacy)
  ].sort((left, right) =>
    left.family.localeCompare(right.family) ||
    left.name.localeCompare(right.name) ||
    left.key.localeCompare(right.key)
  )
}

export function clusterControlImportTokens(
  tokens: ControlToken[]
): ControlPresentationGroup[] {
  const groups = clusterControlTokens(tokens)
  const reusable = groups.filter(group =>
    group.stateEvidenceId !== null &&
    group.instances.every(hasModernIdentity)
  )
  const preserved = groups.filter(group => !reusable.includes(group))
  return [...mergeReusableStateFamilies(reusable), ...preserved].sort((left, right) =>
    left.family.localeCompare(right.family) ||
    left.name.localeCompare(right.name) ||
    left.key.localeCompare(right.key)
  )
}

export function clusterControlCatalogTokens(
  tokens: ControlToken[]
): ControlPresentationGroup[] {
  return clusterControlImportTokens(tokens)
}
