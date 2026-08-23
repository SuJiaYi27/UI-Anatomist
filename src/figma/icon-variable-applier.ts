import type { ColorValue, ScanExport } from '../shared/schema'
import { sanitizeIconTokenForImport } from './icon-import-plan'

export const ICON_COLLECTION_OWNERSHIP_KEY = 'smartScanIconColorCollectionOrigin'
export const ICON_VARIABLE_OWNERSHIP_KEY = 'smartScanIconColorVariableOwnership'
export const ICON_SHARED_NAMESPACE = 'smart.scan.icons'

type IconOwnershipReader = {
  getPluginData(key: string): string
  getSharedPluginData?(namespace: string, key: string): string
}

type IconOwnershipWriter = IconOwnershipReader & {
  setPluginData(key: string, value: string): void
  setSharedPluginData?(namespace: string, key: string, value: string): void
}

export function readIconOwnership(port: IconOwnershipReader, key: string): string {
  let privateValue = ''
  try {
    privateValue = port.getPluginData(key)
  } catch {
    // Direct Figma execution cannot access another plugin's private data.
  }
  return privateValue || port.getSharedPluginData?.(ICON_SHARED_NAMESPACE, key) || ''
}

export function writeIconOwnership(
  port: IconOwnershipWriter,
  key: string,
  value: string
): void {
  try {
    port.setPluginData(key, value)
  } catch {
    // Shared ownership remains available to direct Figma execution.
  }
  port.setSharedPluginData?.(ICON_SHARED_NAMESPACE, key, value)
}

export type ExistingIconCollection = {
  id: string
  name: string
  defaultModeId: string
  modes: Array<{ modeId: string; name: string }>
  ownershipOrigin: string | null
}

export type ExistingIconVariable = {
  id: string
  name: string
  collectionId: string
  resolvedType: string
  ownershipId: string | null
}

export type IconColorRole =
  | 'primary'
  | 'default-background'
  | 'hover-background'
  | 'accent'

export type IconVariablePlanEntry = {
  action: 'create' | 'update' | 'skip_conflict'
  role: IconColorRole
  targetName: string
  iconId?: string
  ownershipId: string
  existingVariableId: string | null
  values: Partial<Record<'light' | 'dark', ColorValue>>
  provenance: 'observed' | 'observed-theme-fallback'
}

export type IconVariablePlan = {
  origin: string
  collection: {
    action: 'create' | 'update'
    targetName: string
    existingCollectionId: string | null
    defaultModeId: string | null
    modes: Array<{ modeId: string; name: string }>
  }
  entries: IconVariablePlanEntry[]
}

function strongestTheme(
  data: ScanExport,
  theme: 'light' | 'dark'
): ColorValue | null {
  if (!('icons' in data)) return null
  const evidence = data.icons.flatMap(icon =>
    icon.themes.filter(item => item.theme === theme)
  )
  return [...evidence].sort((left, right) =>
    right.occurrences - left.occurrences ||
    JSON.stringify(left.color).localeCompare(JSON.stringify(right.color))
  )[0]?.color ?? null
}

function sameColor(left: ColorValue | null, right: ColorValue | null): boolean {
  if (!left || !right) return false
  return left.r === right.r &&
    left.g === right.g &&
    left.b === right.b &&
    left.a === right.a
}

function title(value: string): string {
  return value
    .trim()
    .replace(/[\\/]+/g, ' ')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

type NamedIconRole = {
  role: IconColorRole
  targetName: string
  iconId?: string
}

function iconHash(iconId: string | undefined): string {
  return (iconId?.replace(/^sha256:/, '') || 'shared').toLowerCase()
}

function shortestUniqueIconId(
  role: NamedIconRole,
  siblings: NamedIconRole[]
): string {
  const hash = iconHash(role.iconId)
  for (let length = Math.min(6, hash.length); length <= hash.length; length += 1) {
    const prefix = hash.slice(0, length)
    if (siblings.every(sibling =>
      sibling === role ||
      iconHash(sibling.iconId).slice(0, length) !== prefix
    )) return prefix
  }
  return hash
}

function uniqueRoleName(
  role: NamedIconRole,
  siblings: NamedIconRole[]
): string {
  if (siblings.length < 2) return role.targetName
  const suffix = shortestUniqueIconId(role, siblings)
  if (
    role.role !== 'default-background' &&
    role.role !== 'hover-background'
  ) {
    return `${role.targetName}/${suffix}`
  }
  const segments = role.targetName.split('/')
  const leaf = segments.pop()
  return [...segments, suffix, leaf].filter(Boolean).join('/')
}

export function createIconVariablePlan(
  data: ScanExport,
  existingCollections: ExistingIconCollection[],
  existingVariables: ExistingIconVariable[]
): IconVariablePlan {
  const origin = data.source.origin
  const baseName = `UI-Anatomist / ${data.source.siteLabel.replace(/[\\/]+/g, '／')} / Icon Colors`
  const owned = existingCollections.find(item => item.ownershipOrigin === origin)
  let targetName = owned?.name ?? baseName
  if (!owned && existingCollections.some(item => item.name === targetName)) {
    targetName = `${baseName} · UI-Anatomist`
  }
  const targetVariables = owned
    ? existingVariables.filter(item => item.collectionId === owned.id)
    : []
  const light = strongestTheme(data, 'light')
  const dark = strongestTheme(data, 'dark')
  const roles: Array<NamedIconRole & {
    values: IconVariablePlanEntry['values']
    provenance: IconVariablePlanEntry['provenance']
  }> = []
  if (light || dark) {
    roles.push({
      role: 'primary',
      targetName: 'Icon/Primary',
      provenance: 'observed',
      values: {
        ...(light ? { light } : {}),
        ...(dark ? { dark } : {})
      }
    })
  }
  if ('icons' in data) {
    for (const rawIcon of data.icons) {
      const icon = sanitizeIconTokenForImport(rawIcon)
      for (const state of ['default', 'hover'] as const) {
        const surfaces = (icon.interactionSurfaces ?? [])
          .filter(surface => surface.state === state)
        const surfaceByTheme = (['light', 'dark'] as const).map(theme => [
          theme,
          [...surfaces]
            .filter(item => item.theme === theme)
            .sort((left, right) =>
              right.occurrences - left.occurrences
            )[0]
        ] as const)
        const values = Object.fromEntries(
          surfaceByTheme
            .filter((entry): entry is readonly [
              'light' | 'dark',
              NonNullable<typeof entry[1]>
            ] => Boolean(entry[1]))
            .map(([theme, surface]) => [theme, surface.background])
        ) as IconVariablePlanEntry['values']
        if (Object.keys(values).length > 0) {
          const role = `${state}-background` as
            'default-background' | 'hover-background'
          roles.push({
            role,
            iconId: icon.id,
            targetName:
              `Icon/Interaction/${title(icon.name) || icon.id.slice(-8)}/` +
              `${state === 'default' ? 'Default' : 'Hover'} Background`,
            provenance: 'observed',
            values
          })
        }
      }
      const iconLight = [...icon.themes]
        .filter(item => item.theme === 'light')
        .sort((left, right) => right.occurrences - left.occurrences)[0]?.color ?? null
      const iconDark = [...icon.themes]
        .filter(item => item.theme === 'dark')
        .sort((left, right) => right.occurrences - left.occurrences)[0]?.color ?? null
      const differsFromPrimary =
        (iconLight && !sameColor(iconLight, light)) ||
        (iconDark && !sameColor(iconDark, dark))
      if (!differsFromPrimary) continue
      const fallback = iconLight ?? iconDark
      if (!fallback) continue
      roles.push({
        role: 'accent',
        iconId: icon.id,
        targetName: `Icon/Accent/${title(icon.name) || icon.id.slice(-8)}`,
        provenance: iconLight && iconDark ? 'observed' : 'observed-theme-fallback',
        values: {
          ...(light || iconLight ? { light: iconLight ?? fallback } : {}),
          ...(dark || iconDark ? { dark: iconDark ?? fallback } : {})
        }
      })
    }
  }
  const roleNameGroups = new Map<string, NamedIconRole[]>()
  for (const role of roles) {
    const group = roleNameGroups.get(role.targetName) ?? []
    group.push(role)
    roleNameGroups.set(role.targetName, group)
  }
  const entries = roles.map(role => {
    const targetName = uniqueRoleName(
      role,
      roleNameGroups.get(role.targetName) ?? [role]
    )
    const ownershipId = role.role === 'accent'
      ? `${origin}|icon-color:accent:${role.iconId}`
      : (
          role.role === 'default-background' ||
          role.role === 'hover-background'
        ) && role.iconId
        ? `${origin}|icon-color:${role.role}:${role.iconId}`
        : `${origin}|icon-color:${role.role}`
    const exact = targetVariables.find(item => item.ownershipId === ownershipId)
    const collision = targetVariables.find(item =>
      item.name === targetName && item.id !== exact?.id
    )
    return {
      ...role,
      targetName,
      ownershipId,
      action: collision
        ? 'skip_conflict' as const
        : exact ? 'update' as const : 'create' as const,
      existingVariableId: exact?.id ?? null
    }
  })
  return {
    origin,
    collection: {
      action: owned ? 'update' : 'create',
      targetName,
      existingCollectionId: owned?.id ?? null,
      defaultModeId: owned?.defaultModeId ?? null,
      modes: owned?.modes ?? []
    },
    entries
  }
}

export type IconCollectionPort = {
  id: string
  name: string
  defaultModeId: string
  modes: Array<{ modeId: string; name: string }>
  renameMode(modeId: string, name: string): void
  addMode(name: string): string
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type IconVariablePort = {
  id: string
  name: string
  description: string
  resolvedType: string
  scopes: string[]
  setValueForMode(modeId: string, value: ColorValue): void
  setVariableCodeSyntax(platform: 'WEB', value: string): void
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type IconVariableRepository = {
  createCollection(name: string): IconCollectionPort
  createVariable(name: string, collectionId: string, resolvedType: 'COLOR'): IconVariablePort
  getVariableById(id: string): Promise<IconVariablePort | null>
}

export type AppliedIconVariable = {
  entry: IconVariablePlanEntry
  variable: IconVariablePort
}

export async function applyIconVariablePlan(
  plan: IconVariablePlan,
  repository: IconVariableRepository
) {
  const result: {
    collection: IconCollectionPort | null
    created: IconVariablePort[]
    updated: IconVariablePort[]
    applied: AppliedIconVariable[]
    conflicts: string[]
    modeIds: Partial<Record<'light' | 'dark', string>>
  } = {
    collection: null,
    created: [],
    updated: [],
    applied: [],
    conflicts: plan.entries
      .filter(entry => entry.action === 'skip_conflict')
      .map(entry => entry.targetName),
    modeIds: {}
  }
  const actionable = plan.entries.filter(entry => entry.action !== 'skip_conflict')
  if (actionable.length === 0) return result
  let collectionId = plan.collection.existingCollectionId
  let collection: IconCollectionPort | null = null
  const neededThemes = (['light', 'dark'] as const).filter(theme =>
    actionable.some(entry => entry.values[theme])
  )
  if (!collectionId) {
    collection = repository.createCollection(plan.collection.targetName)
    result.collection = collection
    collection.name = plan.collection.targetName
    writeIconOwnership(collection, ICON_COLLECTION_OWNERSHIP_KEY, plan.origin)
    collectionId = collection.id
    if (neededThemes[0]) {
      collection.renameMode(collection.defaultModeId,
        neededThemes[0] === 'light' ? 'Light' : 'Dark')
      result.modeIds[neededThemes[0]] = collection.defaultModeId
    }
    for (const theme of neededThemes.slice(1)) {
      result.modeIds[theme] = collection.addMode(theme === 'light' ? 'Light' : 'Dark')
    }
  } else {
    for (const theme of neededThemes) {
      const name = theme === 'light' ? 'Light' : 'Dark'
      const existing = plan.collection.modes.find(mode => mode.name === name)
      if (existing) {
        result.modeIds[theme] = existing.modeId
      }
    }
    if (!result.modeIds[neededThemes[0]!] && plan.collection.defaultModeId) {
      result.modeIds[neededThemes[0]!] = plan.collection.defaultModeId
    }
  }

  try {
    for (const entry of actionable) {
      const variable = entry.action === 'update' && entry.existingVariableId
        ? await repository.getVariableById(entry.existingVariableId)
        : repository.createVariable(entry.targetName, collectionId, 'COLOR')
      if (!variable || variable.resolvedType !== 'COLOR') continue
      if (entry.action === 'update') result.updated.push(variable)
      else result.created.push(variable)
      variable.name = entry.targetName
      variable.description = entry.provenance === 'observed'
        ? 'UI-Anatomist · evidence-backed icon semantic color'
        : 'UI-Anatomist · observed icon accent; reused only for an unsampled theme'
      variable.scopes = ['ALL_FILLS', 'STROKE_COLOR']
      writeIconOwnership(variable, ICON_VARIABLE_OWNERSHIP_KEY, entry.ownershipId)
      variable.setVariableCodeSyntax(
        'WEB',
        `var(--ui-anatomist-${entry.targetName.toLowerCase().replace(/[^a-z0-9]+/g, '-')})`
      )
      for (const theme of neededThemes) {
        const modeId = result.modeIds[theme]
        const value = entry.values[theme]
        if (modeId && value) variable.setValueForMode(modeId, value)
      }
      result.applied.push({ entry, variable })
    }
  } catch (error) {
    for (const variable of [...result.created].reverse()) variable.remove()
    collection?.remove()
    throw error
  }
  return result
}
