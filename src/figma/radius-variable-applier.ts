import type { RadiusImportPlan, RadiusImportPlanEntry } from './radius-import-plan'
import { readOwnership, writeOwnership } from './ownership'

export const RADIUS_COLLECTION_OWNERSHIP_KEY = 'smartScanRadiusCollectionOrigin'
export const RADIUS_VARIABLE_OWNERSHIP_KEY = 'smartScanRadiusVariableOwnership'
export const RADIUS_SHARED_NAMESPACE = 'smart.scan.radii'

export type RadiusCollectionPort = {
  id: string
  name: string
  defaultModeId: string
  renameMode(modeId: string, name: string): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type RadiusVariablePort = {
  id: string
  name: string
  description: string
  resolvedType: string
  scopes: string[]
  valuesByMode?: Record<string, unknown>
  codeSyntax?: Partial<Record<'WEB' | 'ANDROID' | 'iOS', string>>
  setValueForMode(modeId: string, value: number): void
  setVariableCodeSyntax(platform: 'WEB' | 'ANDROID' | 'iOS', value: string): void
  removeVariableCodeSyntax(platform: 'WEB' | 'ANDROID' | 'iOS'): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type RadiusVariableRepository = {
  createCollection(name: string): RadiusCollectionPort
  createVariable(name: string, collectionId: string, resolvedType: 'FLOAT'): RadiusVariablePort
  getVariableById(id: string): Promise<RadiusVariablePort | null>
}

export type AppliedRadius = {
  entry: RadiusImportPlanEntry
  variable: RadiusVariablePort
}

export type ApplyRadiusResult = {
  collection: RadiusCollectionPort | null
  created: RadiusVariablePort[]
  updated: RadiusVariablePort[]
  applied: AppliedRadius[]
  skippedPercent: string[]
  conflicts: string[]
}

type VariableSnapshot = {
  variable: RadiusVariablePort
  name: string
  description: string
  scopes: string[]
  ownershipId: string
  modeId: string
  modeValue: unknown
  webCodeSyntax: string | undefined
}

function numericValue(entry: RadiusImportPlanEntry): number {
  if (entry.source.kind === 'full') return 9999
  if (entry.source.kind === 'px') return entry.source.value
  throw new Error('Percentage radii do not map to Figma FLOAT variables')
}

function configureVariable(variable: RadiusVariablePort, entry: RadiusImportPlanEntry, modeId: string): void {
  variable.name = entry.targetName
  variable.description = entry.source.kind === 'full'
    ? `UI-Anatomist · full radius · ${entry.source.occurrences} occurrences`
    : `UI-Anatomist · ${entry.source.value}px · ${entry.source.occurrences} occurrences`
  variable.scopes = ['CORNER_RADIUS']
  variable.setValueForMode(modeId, numericValue(entry))
  const codeLabel = entry.source.kind === 'full'
    ? 'full'
    : String(entry.source.value).replace('.', '-')
  variable.setVariableCodeSyntax('WEB', `var(--ui-anatomist-radius-${codeLabel})`)
  writeOwnership(
    variable,
    RADIUS_SHARED_NAMESPACE,
    RADIUS_VARIABLE_OWNERSHIP_KEY,
    entry.ownershipId
  )
}

export async function applyRadiusImportPlan(
  plan: RadiusImportPlan,
  repository: RadiusVariableRepository
): Promise<ApplyRadiusResult> {
  const result: ApplyRadiusResult = {
    collection: null,
    created: [],
    updated: [],
    applied: [],
    skippedPercent: [],
    conflicts: []
  }
  const actionable = plan.entries.filter(entry => entry.action === 'create' || entry.action === 'update')
  for (const entry of plan.entries) {
    if (entry.action === 'skip_percent') result.skippedPercent.push(entry.targetName)
    if (entry.action === 'skip_conflict') result.conflicts.push(entry.targetName)
  }
  if (actionable.length === 0) return result

  let collectionId = plan.collection.existingCollectionId
  let modeId = plan.collection.defaultModeId
  const snapshots: VariableSnapshot[] = []

  try {
    if (!collectionId || !modeId) {
      const collection = repository.createCollection(plan.collection.targetName)
      result.collection = collection
      collection.name = plan.collection.targetName
      collection.renameMode(collection.defaultModeId, 'Default')
      writeOwnership(
        collection,
        RADIUS_SHARED_NAMESPACE,
        RADIUS_COLLECTION_OWNERSHIP_KEY,
        plan.collection.ownershipOrigin
      )
      collectionId = collection.id
      modeId = collection.defaultModeId
    }

    for (const entry of actionable) {
      if (entry.action === 'create') {
        const variable = repository.createVariable(entry.targetName, collectionId, 'FLOAT')
        try {
          configureVariable(variable, entry, modeId)
        } catch (error) {
          variable.remove()
          throw error
        }
        result.created.push(variable)
        result.applied.push({ entry, variable })
        continue
      }

      if (!entry.existingVariableId) continue
      const variable = await repository.getVariableById(entry.existingVariableId)
      if (!variable || variable.resolvedType !== 'FLOAT') continue
      snapshots.push({
        variable,
        name: variable.name,
        description: variable.description,
        scopes: [...variable.scopes],
        ownershipId: readOwnership(
          variable,
          RADIUS_SHARED_NAMESPACE,
          RADIUS_VARIABLE_OWNERSHIP_KEY
        ),
        modeId,
        modeValue: variable.valuesByMode?.[modeId],
        webCodeSyntax: variable.codeSyntax?.WEB
      })
      configureVariable(variable, entry, modeId)
      result.updated.push(variable)
      result.applied.push({ entry, variable })
    }
  } catch (error) {
    for (const variable of result.created) variable.remove()
    for (const snapshot of snapshots.reverse()) {
      snapshot.variable.name = snapshot.name
      snapshot.variable.description = snapshot.description
      snapshot.variable.scopes = snapshot.scopes
      if (typeof snapshot.modeValue === 'number') {
        snapshot.variable.setValueForMode(snapshot.modeId, snapshot.modeValue)
      }
      if (snapshot.webCodeSyntax) {
        snapshot.variable.setVariableCodeSyntax('WEB', snapshot.webCodeSyntax)
      } else {
        snapshot.variable.removeVariableCodeSyntax('WEB')
      }
      writeOwnership(
        snapshot.variable,
        RADIUS_SHARED_NAMESPACE,
        RADIUS_VARIABLE_OWNERSHIP_KEY,
        snapshot.ownershipId
      )
    }
    result.collection?.remove()
    throw error
  }

  result.skippedPercent = [...new Set(result.skippedPercent)]
  result.conflicts = [...new Set(result.conflicts)]
  return result
}
