import type { ScanExport, SpacingToken } from '../shared/schema'

export type ExistingSpacingCollection = {
  id: string
  name: string
  defaultModeId: string
  ownershipOrigin: string | null
}

export type ExistingSpacingVariable = {
  id: string
  name: string
  collectionId: string
  resolvedType: string
  ownershipId: string | null
}

export type SpacingImportAction = 'create' | 'update' | 'skip_conflict'

export type SpacingImportPlanEntry = {
  action: SpacingImportAction
  source: SpacingToken
  targetName: string
  ownershipId: string
  existingVariableId: string | null
}

export type SpacingCollectionPlan = {
  action: 'create' | 'update'
  targetName: string
  ownershipOrigin: string
  existingCollectionId: string | null
  defaultModeId: string | null
}

export type SpacingImportPlan = {
  source: ScanExport['source']
  collection: SpacingCollectionPlan
  entries: SpacingImportPlanEntry[]
}

function safeName(value: string): string {
  return value.trim().replace(/[\\/]+/g, '／')
}

function safeValueSegment(value: number): string {
  return String(value).replace('.', '-')
}

export function createSpacingImportPlan(
  data: ScanExport,
  existingCollections: ExistingSpacingCollection[],
  existingVariables: ExistingSpacingVariable[]
): SpacingImportPlan {
  const baseName = `UI-Anatomist / ${safeName(data.source.siteLabel)} / Spacing`
  const ownedCollection = existingCollections.find(
    item => item.ownershipOrigin === data.source.origin
  )
  let targetName = ownedCollection?.name ?? baseName
  if (!ownedCollection) {
    const reserved = new Set(existingCollections.map(item => item.name))
    if (reserved.has(targetName)) {
      targetName = `${baseName} · UI-Anatomist`
      let suffix = 2
      while (reserved.has(targetName)) {
        targetName = `${baseName} · UI-Anatomist ${suffix}`
        suffix += 1
      }
    }
  }

  const collection: SpacingCollectionPlan = ownedCollection
    ? {
        action: 'update',
        targetName,
        ownershipOrigin: data.source.origin,
        existingCollectionId: ownedCollection.id,
        defaultModeId: ownedCollection.defaultModeId
      }
    : {
        action: 'create',
        targetName,
        ownershipOrigin: data.source.origin,
        existingCollectionId: null,
        defaultModeId: null
      }

  const targetVariables = ownedCollection
    ? existingVariables.filter(item => item.collectionId === ownedCollection.id)
    : []
  const claimed = new Set<string>()
  const entries = data.spacing.map((source): SpacingImportPlanEntry => {
    const ownershipId = `${data.source.origin}|${source.id}`
    const entryTargetName = `Spacing/${safeValueSegment(source.value)}`
    const exactOwned = targetVariables.find(
      item => item.ownershipId === ownershipId && !claimed.has(item.id)
    )
    const migratableOwned = targetVariables.find(item =>
      !claimed.has(item.id) &&
      item.ownershipId?.startsWith(`${data.source.origin}|`) &&
      item.name === entryTargetName
    )
    const owned = exactOwned ?? migratableOwned
    const collision = targetVariables.find(
      item => item.name === entryTargetName && item.id !== owned?.id
    )
    if (owned) claimed.add(owned.id)

    if ((owned && owned.resolvedType !== 'FLOAT') || collision) {
      return {
        action: 'skip_conflict',
        source,
        targetName: entryTargetName,
        ownershipId,
        existingVariableId: collision?.id ?? owned?.id ?? null
      }
    }
    return {
      action: owned ? 'update' : 'create',
      source,
      targetName: entryTargetName,
      ownershipId,
      existingVariableId: owned?.id ?? null
    }
  })

  return { source: data.source, collection, entries }
}
