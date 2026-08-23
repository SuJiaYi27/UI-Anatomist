import type { ScanExport, ShadowToken } from '../shared/schema'

export type ExistingEffectStyle = {
  id: string
  name: string
  ownershipId: string | null
}

export type ShadowImportAction = 'create' | 'update'

export type ShadowImportPlanEntry = {
  action: ShadowImportAction
  source: ShadowToken
  targetName: string
  ownershipId: string
  existingStyleId: string | null
  conflictName: string | null
}

export type ShadowImportPlan = {
  source: ScanExport['source']
  entries: ShadowImportPlanEntry[]
}

function safeName(value: string): string {
  return value.trim().replace(/[\\/]+/g, '／')
}

function managedName(styleName: string, baseName: string): boolean {
  if (styleName === baseName) return true
  const prefix = `${baseName} · `
  return styleName.startsWith(prefix) && /^[0-9a-f]{6,64}(?:-\d+)?$/.test(styleName.slice(prefix.length))
}

function allocateName(baseName: string, id: string, reserved: Set<string>): string {
  if (!reserved.has(baseName)) return baseName
  const hash = id.slice('sha256:'.length)
  for (let length = 6; length <= hash.length; length += 2) {
    const candidate = `${baseName} · ${hash.slice(0, length)}`
    if (!reserved.has(candidate)) return candidate
  }
  let index = 2
  while (reserved.has(`${baseName} · ${hash}-${index}`)) index += 1
  return `${baseName} · ${hash}-${index}`
}

export function createShadowImportPlan(
  data: ScanExport,
  existingStyles: ExistingEffectStyle[]
): ShadowImportPlan {
  const ownershipFor = (token: ShadowToken) => `${data.source.origin}|${token.id}`
  const baseNameFor = (token: ShadowToken) =>
    `UI-Anatomist/${safeName(data.source.siteLabel)}/${safeName(token.name)}`
  const existingByOwnership = new Map(
    existingStyles.flatMap(style => style.ownershipId ? [[style.ownershipId, style] as const] : [])
  )
  const currentOwnershipIds = new Set(data.shadows.map(ownershipFor))
  const sameOriginPrefix = `${data.source.origin}|`
  const reserved = new Set(existingStyles.map(style => style.name))
  const claimedStyleIds = new Set<string>()
  const entries: ShadowImportPlanEntry[] = []

  for (const source of data.shadows) {
    const ownershipId = ownershipFor(source)
    const baseName = baseNameFor(source)
    const exact = existingByOwnership.get(ownershipId)
    const migratable = existingStyles.find(style =>
      !claimedStyleIds.has(style.id) &&
      style.ownershipId?.startsWith(sameOriginPrefix) &&
      !currentOwnershipIds.has(style.ownershipId) &&
      managedName(style.name, baseName)
    )
    const owned = exact && !claimedStyleIds.has(exact.id) ? exact : migratable
    if (owned) {
      reserved.delete(owned.name)
      claimedStyleIds.add(owned.id)
    }

    const preferredName = owned && managedName(owned.name, baseName) ? owned.name : baseName
    const targetName = allocateName(preferredName, source.id, reserved)
    const conflictName = targetName === preferredName ? null : preferredName
    reserved.add(targetName)
    entries.push({
      action: owned ? 'update' : 'create',
      source,
      targetName,
      ownershipId,
      existingStyleId: owned?.id ?? null,
      conflictName
    })
  }

  return { source: data.source, entries }
}
