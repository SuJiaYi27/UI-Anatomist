import type {
  InteractiveColorToken,
  PrimitiveColorToken,
  ScanExport,
  SemanticColorToken
} from '../shared/schema'

export type ColorLayer = 'primitive' | 'semantic' | 'interactive'
export type ColorSource = PrimitiveColorToken | SemanticColorToken | InteractiveColorToken

export type ExistingColorCollection = {
  id: string
  name: string
  defaultModeId: string
  ownershipOrigin: string | null
}

export type ExistingColorVariable = {
  id: string
  name: string
  collectionId: string
  resolvedType: string
  ownershipId: string | null
}

export type ColorImportAction = 'create' | 'update' | 'skip_conflict'

export type ColorImportPlanEntry = {
  action: ColorImportAction
  layer: ColorLayer
  source: ColorSource
  targetName: string
  ownershipId: string
  existingVariableId: string | null
}

export type ColorCollectionPlan = {
  action: 'create' | 'update'
  targetName: string
  ownershipOrigin: string
  existingCollectionId: string | null
  defaultModeId: string | null
}

export type ColorImportPlan = {
  source: ScanExport['source']
  collection: ColorCollectionPlan
  entries: ColorImportPlanEntry[]
}

function safeName(value: string): string {
  return value.trim().replace(/[\\/]+/g, '／')
}

function baseTargetName(layer: ColorLayer, source: ColorSource): string {
  if (layer === 'primitive') {
    const primitive = source as PrimitiveColorToken
    return `Primitive/${safeName(primitive.family)}/${safeName(primitive.name)}`
  }
  if (layer === 'semantic') {
    const semantic = source as SemanticColorToken
    return `Semantic/${safeName(semantic.group)}/${safeName(semantic.name)}`
  }
  const interactive = source as InteractiveColorToken
  return `Interactive/${safeName(interactive.intent)}/${safeName(interactive.state)}/${safeName(interactive.usage)}`
}

function layeredSources(data: ScanExport): Array<{ layer: ColorLayer; source: ColorSource }> {
  return [
    ...data.colors.primitives.map(source => ({ layer: 'primitive' as const, source })),
    ...data.colors.semantic.map(source => ({ layer: 'semantic' as const, source })),
    ...data.colors.interactive.map(source => ({ layer: 'interactive' as const, source }))
  ]
}

function suffixTargetName(base: string, sourceId: string, reserved: Set<string>): string {
  const hash = sourceId.slice('sha256:'.length)
  let length = 6
  let candidate = `${base} · ${hash.slice(0, length)}`
  while (reserved.has(candidate) && length < hash.length) {
    length += 1
    candidate = `${base} · ${hash.slice(0, length)}`
  }
  return candidate
}

function allocateTargetNames(
  data: ScanExport,
  sources: Array<{ layer: ColorLayer; source: ColorSource }>,
  targetVariables: ExistingColorVariable[]
): Map<string, string> {
  const groups = new Map<string, Array<{ layer: ColorLayer; source: ColorSource }>>()
  for (const item of sources) {
    const base = baseTargetName(item.layer, item.source)
    groups.set(base, [...(groups.get(base) ?? []), item])
  }

  const allocated = new Map<string, string>()
  for (const [base, group] of groups) {
    const ordered = [...group].sort((left, right) => left.source.id.localeCompare(right.source.id))
    if (ordered.length === 1) {
      const source = ordered[0]!.source
      allocated.set(`${data.source.origin}|${source.id}`, base)
      continue
    }

    const reserved = new Set<string>()
    for (const { source } of ordered) {
      const ownershipId = `${data.source.origin}|${source.id}`
      const existing = targetVariables.find(variable => variable.ownershipId === ownershipId)
      if (!existing || (existing.name !== base && !existing.name.startsWith(`${base} · `)) ||
          reserved.has(existing.name)) continue
      allocated.set(ownershipId, existing.name)
      reserved.add(existing.name)
    }
    for (const [index, { source }] of ordered.entries()) {
      const ownershipId = `${data.source.origin}|${source.id}`
      if (allocated.has(ownershipId)) continue
      let targetName = index === 0 ? base : suffixTargetName(base, source.id, reserved)
      if (reserved.has(targetName)) targetName = suffixTargetName(base, source.id, reserved)
      allocated.set(ownershipId, targetName)
      reserved.add(targetName)
    }
  }
  return allocated
}

export function createColorImportPlan(
  data: ScanExport,
  existingCollections: ExistingColorCollection[],
  existingVariables: ExistingColorVariable[]
): ColorImportPlan {
  const baseName = `UI-Anatomist / ${safeName(data.source.siteLabel)} / Colors`
  const ownedCollection = existingCollections.find(item => item.ownershipOrigin === data.source.origin)
  let collectionName = ownedCollection?.name ?? baseName
  if (!ownedCollection) {
    const reservedCollections = new Set(existingCollections.map(item => item.name))
    if (reservedCollections.has(collectionName)) {
      collectionName = `${baseName} · UI-Anatomist`
      let suffix = 2
      while (reservedCollections.has(collectionName)) {
        collectionName = `${baseName} · UI-Anatomist ${suffix}`
        suffix += 1
      }
    }
  }

  const collection: ColorCollectionPlan = ownedCollection ? {
    action: 'update',
    targetName: collectionName,
    ownershipOrigin: data.source.origin,
    existingCollectionId: ownedCollection.id,
    defaultModeId: ownedCollection.defaultModeId
  } : {
    action: 'create',
    targetName: collectionName,
    ownershipOrigin: data.source.origin,
    existingCollectionId: null,
    defaultModeId: null
  }

  const targetVariables = ownedCollection
    ? existingVariables.filter(item => item.collectionId === ownedCollection.id)
    : []
  const claimedVariableIds = new Set<string>()
  const claimedNames = new Set<string>()
  const entries: ColorImportPlanEntry[] = []
  const sources = layeredSources(data)
  const allocatedTargetNames = allocateTargetNames(data, sources, targetVariables)
  const currentOwnershipIds = new Set(sources.map(({ source }) =>
    `${data.source.origin}|${source.id}`
  ))

  for (const { layer, source } of sources) {
    const ownershipId = `${data.source.origin}|${source.id}`
    const baseTarget = baseTargetName(layer, source)
    const targetName = allocatedTargetNames.get(ownershipId) ?? baseTarget

    const exactOwned = targetVariables.find(variable =>
      variable.ownershipId === ownershipId && !claimedVariableIds.has(variable.id)
    )
    const staleBaseOccupant = targetVariables.find(variable =>
      variable.name === baseTarget &&
      variable.id !== exactOwned?.id &&
      variable.ownershipId?.startsWith(`${data.source.origin}|`) &&
      !currentOwnershipIds.has(variable.ownershipId)
    )
    const migratableOwned = targetVariables.find(variable =>
      !claimedVariableIds.has(variable.id) &&
      variable.ownershipId?.startsWith(`${data.source.origin}|`) &&
      variable.name === targetName
    )
    const owned = exactOwned ?? migratableOwned
    const collision = targetVariables.find(variable =>
      variable.name === targetName &&
      variable.id !== owned?.id &&
      variable.id !== staleBaseOccupant?.id
    )
    if (owned) claimedVariableIds.add(owned.id)

    let action: ColorImportAction = 'create'
    let existingVariableId: string | null = null
    if ((owned && owned.resolvedType !== 'COLOR') || collision) {
      action = 'skip_conflict'
      existingVariableId = collision?.id ?? owned?.id ?? null
    } else if (owned) {
      action = 'update'
      existingVariableId = owned.id
    }
    if (action !== 'skip_conflict') claimedNames.add(targetName)
    entries.push({ action, layer, source, targetName, ownershipId, existingVariableId })
  }

  const actionablePrimitives = new Set(entries
    .filter(entry => entry.layer === 'primitive' && entry.action !== 'skip_conflict')
    .map(entry => entry.source.id))
  for (const entry of entries) {
    if (entry.layer === 'primitive' || entry.action === 'skip_conflict') continue
    const primitiveId = (entry.source as SemanticColorToken | InteractiveColorToken).primitiveId
    if (!actionablePrimitives.has(primitiveId)) {
      entry.action = 'skip_conflict'
      entry.existingVariableId = null
    }
  }

  return { source: data.source, collection, entries }
}
