import type { ScanExport } from '../shared/schema'
import {
  RADIUS_SHARED_NAMESPACE,
  RADIUS_VARIABLE_OWNERSHIP_KEY
} from './radius-variable-applier'
import { OWNERSHIP_KEY, TYPOGRAPHY_SHARED_NAMESPACE } from './style-applier'
import { SHADOW_OWNERSHIP_KEY, SHADOW_SHARED_NAMESPACE } from './shadow-style-applier'
import { COLOR_VARIABLE_OWNERSHIP_KEY, readColorOwnership } from './color-variable-applier'
import {
  SPACING_SHARED_NAMESPACE,
  SPACING_VARIABLE_OWNERSHIP_KEY
} from './spacing-variable-applier'
import {
  CONTROL_GROUP_OWNERSHIP_KEY,
  CONTROL_NODE_OWNERSHIP_KEY,
  readControlOwnership
} from './control-component-applier'
import {
  createIconVariablePlan,
  ICON_VARIABLE_OWNERSHIP_KEY,
  readIconOwnership
} from './icon-variable-applier'
import { ICON_NODE_OWNERSHIP_KEY } from './icon-component-applier'
import { readOwnership } from './ownership'
import { createControlImportPlan } from './control-import-plan'
import { createCompositeImportPlan } from './composite-import-plan'
import {
  COMPOSITE_GROUP_OWNERSHIP_KEY,
  COMPOSITE_NODE_OWNERSHIP_KEY,
  readCompositeOwnership
} from './composite-component-applier'

export type OwnedAssetSnapshot = {
  id: string
  ownershipId: string | null
}

export type StaleOwnedAsset = {
  id: string
  ownershipId: string
}

export type StaleAssetPlan = {
  typography: StaleOwnedAsset[]
  radiusVariables: StaleOwnedAsset[]
  shadows: StaleOwnedAsset[]
  colors: StaleOwnedAsset[]
  spacing: StaleOwnedAsset[]
  controls: StaleOwnedAsset[]
  composites?: StaleOwnedAsset[]
  iconVariables?: StaleOwnedAsset[]
  icons?: StaleOwnedAsset[]
}

type OwnedRemovable = {
  getPluginData(key: string): string
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type StaleAssetRepository = {
  getTextStyleById(id: string): Promise<OwnedRemovable | null>
  getRadiusVariableById(id: string): Promise<OwnedRemovable | null>
  getEffectStyleById(id: string): Promise<OwnedRemovable | null>
  getColorVariableById(id: string): Promise<OwnedRemovable | null>
  getSpacingVariableById(id: string): Promise<OwnedRemovable | null>
  getControlNodeById(id: string): Promise<OwnedRemovable | null>
  getCompositeNodeById?(id: string): Promise<OwnedRemovable | null>
  getIconVariableById?(id: string): Promise<OwnedRemovable | null>
  getIconNodeById?(id: string): Promise<OwnedRemovable | null>
}

export type StaleAssetRemovalResult = {
  typographyRemoved: number
  radiusRemoved: number
  shadowRemoved: number
  colorRemoved: number
  spacingRemoved: number
  controlRemoved: number
  compositeRemoved?: number
  iconVariableRemoved?: number
  iconRemoved?: number
}

function staleCandidates(
  assets: OwnedAssetSnapshot[],
  origin: string,
  currentOwnershipIds: Set<string>
): StaleOwnedAsset[] {
  const prefix = `${origin}|`
  return assets.flatMap(asset =>
    asset.ownershipId?.startsWith(prefix) && !currentOwnershipIds.has(asset.ownershipId)
      ? [{ id: asset.id, ownershipId: asset.ownershipId }]
      : []
  )
}

function staleOrDuplicateCandidates(
  assets: OwnedAssetSnapshot[],
  origin: string,
  currentOwnershipIds: Set<string>
): StaleOwnedAsset[] {
  const prefix = `${origin}|`
  const keeperIndex = new Map<string, number>()
  for (let index = 0; index < assets.length; index += 1) {
    const ownershipId = assets[index]?.ownershipId
    if (ownershipId?.startsWith(prefix) && currentOwnershipIds.has(ownershipId)) {
      // Import planning uses a Map with the same document-order snapshots, so
      // the final matching node is the asset that gets updated and retained.
      keeperIndex.set(ownershipId, index)
    }
  }
  return assets.flatMap((asset, index) => {
    const ownershipId = asset.ownershipId
    if (!ownershipId?.startsWith(prefix)) return []
    if (!currentOwnershipIds.has(ownershipId)) {
      return [{ id: asset.id, ownershipId }]
    }
    return keeperIndex.get(ownershipId) !== index
      ? [{ id: asset.id, ownershipId }]
      : []
  })
}

export function createStaleAssetPlan(
  data: ScanExport,
  existingTypography: OwnedAssetSnapshot[],
  existingRadiusVariables: OwnedAssetSnapshot[],
  existingShadows: OwnedAssetSnapshot[],
  existingColorVariables: OwnedAssetSnapshot[] = [],
  existingSpacingVariables: OwnedAssetSnapshot[] = [],
  existingControls: OwnedAssetSnapshot[] = [],
  existingIconVariables: OwnedAssetSnapshot[] = [],
  existingIcons: OwnedAssetSnapshot[] = [],
  existingComposites: OwnedAssetSnapshot[] = []
): StaleAssetPlan {
  if (data.traversal.failures > 0) {
    return {
      typography: [], radiusVariables: [], shadows: [], colors: [], spacing: [], controls: []
    }
  }
  const ownershipFor = (id: string) => `${data.source.origin}|${id}`
  const currentTypography = new Set(data.typography.map(token => ownershipFor(token.id)))
  const currentRadiusVariables = new Set(
    data.borderRadii
      .filter(token => token.kind !== 'percent')
      .map(token => ownershipFor(token.id))
  )
  const currentShadows = new Set(data.shadows.map(token => ownershipFor(token.id)))
  const currentColors = new Set([
    ...data.colors.primitives,
    ...data.colors.semantic,
    ...data.colors.interactive
  ].map(token => ownershipFor(token.id)))
  const currentSpacing = new Set(data.spacing.map(token => ownershipFor(token.id)))
  const controlPlan = createControlImportPlan(data, [], [])
  const currentControls = new Set(controlPlan.groups.flatMap(group => [
    ...group.entries.map(entry => entry.ownershipId),
    ...(group.kind === 'component_set' ? [group.groupOwnershipId] : [])
  ]))
  const plan: StaleAssetPlan = {
    typography: staleCandidates(existingTypography, data.source.origin, currentTypography),
    radiusVariables: data.schemaVersion === '1.0.0'
      ? []
      : staleCandidates(
          existingRadiusVariables,
          data.source.origin,
          currentRadiusVariables
        ),
    shadows: data.schemaVersion === '1.2.0' ||
      data.schemaVersion === '1.3.0' ||
      data.schemaVersion === '1.4.0' ||
      data.schemaVersion === '1.5.0' ||
      data.schemaVersion === '1.6.0' ||
      data.schemaVersion === '1.7.0' ||
      data.schemaVersion === '1.8.0' ||
      data.schemaVersion === '1.9.0' ||
      data.schemaVersion === '1.10.0'
      ? staleCandidates(existingShadows, data.source.origin, currentShadows)
      : [],
    colors: data.schemaVersion === '1.3.0' ||
      data.schemaVersion === '1.4.0' ||
      data.schemaVersion === '1.5.0' ||
      data.schemaVersion === '1.6.0' ||
      data.schemaVersion === '1.7.0' ||
      data.schemaVersion === '1.8.0' ||
      data.schemaVersion === '1.9.0' ||
      data.schemaVersion === '1.10.0'
      ? staleCandidates(existingColorVariables, data.source.origin, currentColors)
      : [],
    spacing: data.schemaVersion === '1.4.0' ||
      data.schemaVersion === '1.5.0' ||
      data.schemaVersion === '1.6.0' ||
      data.schemaVersion === '1.7.0' ||
      data.schemaVersion === '1.8.0' ||
      data.schemaVersion === '1.9.0' ||
      data.schemaVersion === '1.10.0'
      ? staleCandidates(existingSpacingVariables, data.source.origin, currentSpacing)
      : [],
    controls: data.schemaVersion === '1.5.0' ||
      data.schemaVersion === '1.6.0' ||
      data.schemaVersion === '1.7.0' ||
      data.schemaVersion === '1.8.0' ||
      data.schemaVersion === '1.9.0' ||
      data.schemaVersion === '1.10.0'
      ? staleOrDuplicateCandidates(
          existingControls,
          data.source.origin,
          currentControls
        )
      : []
  }
  if (
    data.schemaVersion === '1.8.0' ||
    data.schemaVersion === '1.9.0' ||
    data.schemaVersion === '1.10.0'
  ) {
    const currentIconVariables = new Set(
      createIconVariablePlan(data, [], []).entries.map(entry => entry.ownershipId)
    )
    const currentIcons = new Set(data.icons.map(token =>
      `${data.source.origin}|icon:${token.id}`
    ))
    plan.iconVariables = staleCandidates(
      existingIconVariables,
      data.source.origin,
      currentIconVariables
    )
    plan.icons = staleCandidates(existingIcons, data.source.origin, currentIcons)
  }
  if (data.schemaVersion === '1.9.0' || data.schemaVersion === '1.10.0') {
    const compositePlan = createCompositeImportPlan(
      data,
      controlPlan,
      []
    )
    const currentComposites = new Set(compositePlan.groups.flatMap(group => [
      ...group.entries.map(entry => entry.ownershipId),
      ...(group.kind === 'component_set' ? [group.groupOwnershipId] : [])
    ]))
    plan.composites = staleCandidates(
      existingComposites,
      data.source.origin,
      currentComposites
    )
  }
  return plan
}

async function removeIfStillOwned(
  candidate: StaleOwnedAsset,
  origin: string,
  ownershipKey: string,
  resolve: (id: string) => Promise<OwnedRemovable | null>,
  readOwnership: (asset: OwnedRemovable, key: string) => string =
    (asset, key) => asset.getPluginData(key)
): Promise<boolean> {
  const asset = await resolve(candidate.id)
  const currentOwnership = asset ? readOwnership(asset, ownershipKey) : ''
  if (
    !asset ||
    currentOwnership !== candidate.ownershipId ||
    !currentOwnership.startsWith(`${origin}|`)
  ) return false
  asset.remove()
  return true
}

export async function removeStaleAssets(
  plan: StaleAssetPlan,
  origin: string,
  repository: StaleAssetRepository
): Promise<StaleAssetRemovalResult> {
  let typographyRemoved = 0
  let radiusRemoved = 0
  let shadowRemoved = 0
  let colorRemoved = 0
  let spacingRemoved = 0
  let controlRemoved = 0
  let compositeRemoved = 0
  let iconVariableRemoved = 0
  let iconRemoved = 0
  for (const candidate of plan.typography) {
    if (await removeIfStillOwned(
      candidate,
      origin,
      OWNERSHIP_KEY,
      repository.getTextStyleById,
      (asset, key) => readOwnership(asset, TYPOGRAPHY_SHARED_NAMESPACE, key)
    )) typographyRemoved += 1
  }
  for (const candidate of plan.radiusVariables) {
    if (await removeIfStillOwned(
      candidate,
      origin,
      RADIUS_VARIABLE_OWNERSHIP_KEY,
      repository.getRadiusVariableById,
      (asset, key) => readOwnership(asset, RADIUS_SHARED_NAMESPACE, key)
    )) radiusRemoved += 1
  }
  for (const candidate of plan.shadows) {
    if (await removeIfStillOwned(
      candidate,
      origin,
      SHADOW_OWNERSHIP_KEY,
      repository.getEffectStyleById,
      (asset, key) => readOwnership(asset, SHADOW_SHARED_NAMESPACE, key)
    )) shadowRemoved += 1
  }
  for (const candidate of plan.colors) {
    if (await removeIfStillOwned(
      candidate,
      origin,
      COLOR_VARIABLE_OWNERSHIP_KEY,
      repository.getColorVariableById,
      readColorOwnership
    )) colorRemoved += 1
  }
  for (const candidate of plan.spacing) {
    if (await removeIfStillOwned(
      candidate,
      origin,
      SPACING_VARIABLE_OWNERSHIP_KEY,
      repository.getSpacingVariableById,
      (asset, key) => readOwnership(asset, SPACING_SHARED_NAMESPACE, key)
    )) spacingRemoved += 1
  }
  for (const candidate of plan.controls ?? []) {
    if (await removeIfStillOwned(
      candidate,
      origin,
      CONTROL_NODE_OWNERSHIP_KEY,
      repository.getControlNodeById,
      asset => readControlOwnership(asset, CONTROL_NODE_OWNERSHIP_KEY) ||
        readControlOwnership(asset, CONTROL_GROUP_OWNERSHIP_KEY)
    )) controlRemoved += 1
  }
  for (const candidate of plan.composites ?? []) {
    if (repository.getCompositeNodeById && await removeIfStillOwned(
      candidate,
      origin,
      COMPOSITE_NODE_OWNERSHIP_KEY,
      repository.getCompositeNodeById,
      asset => readCompositeOwnership(asset, COMPOSITE_NODE_OWNERSHIP_KEY) ||
        readCompositeOwnership(asset, COMPOSITE_GROUP_OWNERSHIP_KEY)
    )) compositeRemoved += 1
  }
  for (const candidate of plan.iconVariables ?? []) {
    if (repository.getIconVariableById && await removeIfStillOwned(
      candidate,
      origin,
      ICON_VARIABLE_OWNERSHIP_KEY,
      repository.getIconVariableById,
      readIconOwnership
    )) iconVariableRemoved += 1
  }
  for (const candidate of plan.icons ?? []) {
    if (repository.getIconNodeById && await removeIfStillOwned(
      candidate,
      origin,
      ICON_NODE_OWNERSHIP_KEY,
      repository.getIconNodeById,
      readIconOwnership
    )) iconRemoved += 1
  }
  const result: StaleAssetRemovalResult = {
    typographyRemoved,
    radiusRemoved,
    shadowRemoved,
    colorRemoved,
    spacingRemoved,
    controlRemoved
  }
  if (plan.composites) result.compositeRemoved = compositeRemoved
  if (plan.iconVariables) result.iconVariableRemoved = iconVariableRemoved
  if (plan.icons) result.iconRemoved = iconRemoved
  return result
}
