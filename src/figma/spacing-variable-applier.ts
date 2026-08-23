import type { SpacingImportPlan, SpacingImportPlanEntry } from './spacing-import-plan'
import { readOwnership, writeOwnership } from './ownership'

export const SPACING_COLLECTION_OWNERSHIP_KEY = 'smartScanSpacingCollectionOrigin'
export const SPACING_VARIABLE_OWNERSHIP_KEY = 'smartScanSpacingVariableOwnership'
export const SPACING_SHARED_NAMESPACE = 'smart.scan.spacing'

export type SpacingCollectionPort = {
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

export type SpacingVariablePort = {
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

export type SpacingVariableRepository = {
  createCollection(name: string): SpacingCollectionPort
  createVariable(name: string, collectionId: string, resolvedType: 'FLOAT'): SpacingVariablePort
  getVariableById(id: string): Promise<SpacingVariablePort | null>
}

export type AppliedSpacing = {
  entry: SpacingImportPlanEntry
  variable: SpacingVariablePort
}

export type ApplySpacingResult = {
  collection: SpacingCollectionPort | null
  created: SpacingVariablePort[]
  updated: SpacingVariablePort[]
  applied: AppliedSpacing[]
  conflicts: string[]
}

type VariableSnapshot = {
  variable: SpacingVariablePort
  name: string
  description: string
  scopes: string[]
  ownershipId: string
  modeId: string
  modeValue: unknown
  webCodeSyntax: string | undefined
}

function codeLabel(value: number): string {
  return String(value).replace('.', '-')
}

function configureVariable(
  variable: SpacingVariablePort,
  entry: SpacingImportPlanEntry,
  modeId: string
): void {
  variable.name = entry.targetName
  variable.description = [
    `UI-Anatomist · ${entry.source.value}px`,
    `${entry.source.occurrences} occurrences`,
    `padding ${entry.source.evidence.padding}`,
    `gap ${entry.source.evidence.gap}`,
    `margin ${entry.source.evidence.margin}`
  ].join(' · ')
  variable.scopes = ['GAP']
  variable.setValueForMode(modeId, entry.source.value)
  variable.setVariableCodeSyntax(
    'WEB',
    `var(--ui-anatomist-spacing-${codeLabel(entry.source.value)})`
  )
  writeOwnership(
    variable,
    SPACING_SHARED_NAMESPACE,
    SPACING_VARIABLE_OWNERSHIP_KEY,
    entry.ownershipId
  )
}

export async function applySpacingImportPlan(
  plan: SpacingImportPlan,
  repository: SpacingVariableRepository
): Promise<ApplySpacingResult> {
  const result: ApplySpacingResult = {
    collection: null,
    created: [],
    updated: [],
    applied: [],
    conflicts: plan.entries
      .filter(entry => entry.action === 'skip_conflict')
      .map(entry => entry.targetName)
  }
  const actionable = plan.entries.filter(
    entry => entry.action === 'create' || entry.action === 'update'
  )
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
        SPACING_SHARED_NAMESPACE,
        SPACING_COLLECTION_OWNERSHIP_KEY,
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
          SPACING_SHARED_NAMESPACE,
          SPACING_VARIABLE_OWNERSHIP_KEY
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
        SPACING_SHARED_NAMESPACE,
        SPACING_VARIABLE_OWNERSHIP_KEY,
        snapshot.ownershipId
      )
    }
    result.collection?.remove()
    throw error
  }
  result.conflicts = [...new Set(result.conflicts)]
  return result
}
