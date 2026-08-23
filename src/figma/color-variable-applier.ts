import type { ColorValue, InteractiveColorToken, PrimitiveColorToken, SemanticColorToken } from '../shared/schema'
import type { ColorImportPlan, ColorImportPlanEntry } from './color-import-plan'
import { readOwnership, writeOwnership } from './ownership'

export const COLOR_COLLECTION_OWNERSHIP_KEY = 'smartScanColorCollectionOrigin'
export const COLOR_VARIABLE_OWNERSHIP_KEY = 'smartScanColorVariableOwnership'
export const COLOR_SHARED_NAMESPACE = 'smart.scan.colors'

type ColorOwnershipReader = {
  getPluginData(key: string): string
  getSharedPluginData?(namespace: string, key: string): string
}

type ColorOwnershipWriter = ColorOwnershipReader & {
  setPluginData(key: string, value: string): void
  setSharedPluginData?(namespace: string, key: string, value: string): void
}

export function readColorOwnership(port: ColorOwnershipReader, key: string): string {
  return readOwnership(port, COLOR_SHARED_NAMESPACE, key)
}

export function writeColorOwnership(
  port: ColorOwnershipWriter,
  key: string,
  value: string
): void {
  writeOwnership(port, COLOR_SHARED_NAMESPACE, key, value)
}

export type ColorVariableAlias = { type: 'VARIABLE_ALIAS'; id: string }

export type ColorCollectionPort = {
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

export type ColorVariablePort = {
  id: string
  name: string
  description: string
  resolvedType: string
  scopes: string[]
  valuesByMode?: Record<string, unknown>
  codeSyntax?: Partial<Record<'WEB' | 'ANDROID' | 'iOS', string>>
  setValueForMode(modeId: string, value: ColorValue | ColorVariableAlias): void
  setVariableCodeSyntax(platform: 'WEB' | 'ANDROID' | 'iOS', value: string): void
  removeVariableCodeSyntax(platform: 'WEB' | 'ANDROID' | 'iOS'): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type ColorVariableRepository = {
  createCollection(name: string): ColorCollectionPort
  createVariable(name: string, collectionId: string, resolvedType: 'COLOR'): ColorVariablePort
  getVariableById(id: string): Promise<ColorVariablePort | null>
}

export type AppliedColor = {
  entry: ColorImportPlanEntry
  variable: ColorVariablePort
}

export type ApplyColorResult = {
  collection: ColorCollectionPort | null
  created: ColorVariablePort[]
  updated: ColorVariablePort[]
  applied: AppliedColor[]
  conflicts: string[]
}

type VariableSnapshot = {
  variable: ColorVariablePort
  name: string
  description: string
  scopes: string[]
  ownershipId: string
  modeId: string
  modeValue: unknown
  webCodeSyntax: string | undefined
}

function codeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function descriptionFor(entry: ColorImportPlanEntry): string {
  return `UI-Anatomist · ${entry.layer} · ${entry.source.provenance} · ${entry.source.occurrences} occurrences`
}

function configureCommon(variable: ColorVariablePort, entry: ColorImportPlanEntry): void {
  variable.name = entry.targetName
  variable.description = descriptionFor(entry)
  variable.scopes = ['ALL_FILLS', 'STROKE_COLOR']
  variable.setVariableCodeSyntax('WEB', `var(--ui-anatomist-${codeSlug(entry.targetName)})`)
  writeColorOwnership(variable, COLOR_VARIABLE_OWNERSHIP_KEY, entry.ownershipId)
}

function primitiveReference(entry: ColorImportPlanEntry): string | null {
  if (entry.layer === 'primitive') return null
  return (entry.source as SemanticColorToken | InteractiveColorToken).primitiveId
}

export async function applyColorImportPlan(
  plan: ColorImportPlan,
  repository: ColorVariableRepository
): Promise<ApplyColorResult> {
  const result: ApplyColorResult = {
    collection: null,
    created: [],
    updated: [],
    applied: [],
    conflicts: [...new Set(plan.entries
      .filter(entry => entry.action === 'skip_conflict')
      .map(entry => entry.targetName))]
  }
  const actionable = plan.entries.filter(entry => entry.action === 'create' || entry.action === 'update')
  if (actionable.length === 0) return result

  let collectionId = plan.collection.existingCollectionId
  let modeId = plan.collection.defaultModeId
  const snapshots: VariableSnapshot[] = []
  const primitiveVariables = new Map<string, ColorVariablePort>()

  try {
    if (!collectionId || !modeId) {
      const collection = repository.createCollection(plan.collection.targetName)
      result.collection = collection
      collection.name = plan.collection.targetName
      collection.renameMode(collection.defaultModeId, 'Default')
      writeColorOwnership(collection, COLOR_COLLECTION_OWNERSHIP_KEY, plan.collection.ownershipOrigin)
      collectionId = collection.id
      modeId = collection.defaultModeId
    }

    for (const entry of actionable) {
      let variable: ColorVariablePort | null = null
      if (entry.action === 'create') {
        variable = repository.createVariable(entry.targetName, collectionId, 'COLOR')
        result.created.push(variable)
      } else if (entry.existingVariableId) {
        variable = await repository.getVariableById(entry.existingVariableId)
        if (variable && variable.resolvedType === 'COLOR') {
          snapshots.push({
            variable,
            name: variable.name,
            description: variable.description,
            scopes: [...variable.scopes],
            ownershipId: readColorOwnership(variable, COLOR_VARIABLE_OWNERSHIP_KEY),
            modeId,
            modeValue: variable.valuesByMode?.[modeId],
            webCodeSyntax: variable.codeSyntax?.WEB
          })
          result.updated.push(variable)
        } else {
          variable = null
        }
      }
      if (!variable) continue

      configureCommon(variable, entry)
      if (entry.layer === 'primitive') {
        variable.setValueForMode(modeId, (entry.source as PrimitiveColorToken).value)
        primitiveVariables.set(entry.source.id, variable)
      } else {
        const reference = primitiveReference(entry)
        const primitive = reference ? primitiveVariables.get(reference) : null
        if (!primitive) throw new Error(`无法找到颜色 Primitive：${entry.targetName}`)
        variable.setValueForMode(modeId, { type: 'VARIABLE_ALIAS', id: primitive.id })
      }
      result.applied.push({ entry, variable })
    }
  } catch (error) {
    for (const variable of [...result.created].reverse()) variable.remove()
    for (const snapshot of snapshots.reverse()) {
      snapshot.variable.name = snapshot.name
      snapshot.variable.description = snapshot.description
      snapshot.variable.scopes = snapshot.scopes
      if (snapshot.modeValue !== undefined) {
        snapshot.variable.setValueForMode(
          snapshot.modeId,
          snapshot.modeValue as ColorValue | ColorVariableAlias
        )
      }
      if (snapshot.webCodeSyntax) {
        snapshot.variable.setVariableCodeSyntax('WEB', snapshot.webCodeSyntax)
      } else {
        snapshot.variable.removeVariableCodeSyntax('WEB')
      }
      writeColorOwnership(snapshot.variable, COLOR_VARIABLE_OWNERSHIP_KEY, snapshot.ownershipId)
    }
    result.collection?.remove()
    throw error
  }

  return result
}
