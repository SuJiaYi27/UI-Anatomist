import type { BorderRadiusToken, ScanExport } from '../shared/schema'

export type ExistingRadiusCollection = {
  id: string
  name: string
  defaultModeId: string
  ownershipOrigin: string | null
}

export type ExistingRadiusVariable = {
  id: string
  name: string
  collectionId: string
  resolvedType: string
  ownershipId: string | null
}

export type RadiusImportAction = 'create' | 'update' | 'skip_percent' | 'skip_conflict'

export type RadiusImportPlanEntry = {
  action: RadiusImportAction
  source: BorderRadiusToken
  targetName: string
  ownershipId: string
  existingVariableId: string | null
}

export type RadiusCollectionPlan = {
  action: 'create' | 'update'
  targetName: string
  ownershipOrigin: string
  existingCollectionId: string | null
  defaultModeId: string | null
}

export type RadiusImportPlan = {
  source: ScanExport['source']
  collection: RadiusCollectionPlan
  entries: RadiusImportPlanEntry[]
}

function safeName(value: string): string {
  return value.trim().replace(/[\\/]+/g, '／')
}

function valueLabel(token: BorderRadiusToken): string {
  if (token.kind === 'full') return 'Full'
  if (token.kind === 'percent') return `${token.value}%`
  return String(token.value)
}

export function createRadiusImportPlan(
  data: ScanExport,
  existingCollections: ExistingRadiusCollection[],
  existingVariables: ExistingRadiusVariable[]
): RadiusImportPlan {
  const baseName = `UI-Anatomist / ${safeName(data.source.siteLabel)} / Border Radii`
  const ownedCollection = existingCollections.find(item => item.ownershipOrigin === data.source.origin)
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

  const collection: RadiusCollectionPlan = ownedCollection
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
  const entries = data.borderRadii.map((source): RadiusImportPlanEntry => {
    const ownershipId = `${data.source.origin}|${source.id}`
    const entryTargetName = `Radius/${valueLabel(source)}`
    if (source.kind === 'percent') {
      return { action: 'skip_percent', source, targetName: entryTargetName, ownershipId, existingVariableId: null }
    }

    const exactOwned = targetVariables.find(item => item.ownershipId === ownershipId && !claimed.has(item.id))
    const migratableOwned = targetVariables.find(item =>
      !claimed.has(item.id) &&
      item.ownershipId?.startsWith(`${data.source.origin}|`) &&
      item.name === entryTargetName
    )
    const owned = exactOwned ?? migratableOwned
    const collision = targetVariables.find(item => item.name === entryTargetName && item.id !== owned?.id)
    if (owned) claimed.add(owned.id)

    if ((owned && owned.resolvedType !== 'FLOAT') || collision) {
      return {
        action: 'skip_conflict', source, targetName: entryTargetName, ownershipId,
        existingVariableId: collision?.id ?? owned?.id ?? null
      }
    }
    if (owned) {
      return {
        action: 'update', source, targetName: entryTargetName, ownershipId,
        existingVariableId: owned.id
      }
    }
    return { action: 'create', source, targetName: entryTargetName, ownershipId, existingVariableId: null }
  })

  return { source: data.source, collection, entries }
}
