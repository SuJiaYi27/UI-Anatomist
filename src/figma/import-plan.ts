import { ScanExportSchema, type ScanExport, type TypographyStyle } from '../shared/schema'
import { resolveFont, type AvailableFontName } from './font-resolver'

export type ExistingTextStyle = {
  id: string
  name: string
  ownershipId: string | null
}

export type ImportAction = 'create' | 'update' | 'skip_missing_font' | 'skip_conflict'

export type ImportPlanEntry = {
  action: ImportAction
  source: TypographyStyle
  targetName: string
  ownershipId: string
  fontName: AvailableFontName | null
  existingStyleId: string | null
}

export type ImportPlan = {
  source: ScanExport['source']
  entries: ImportPlanEntry[]
}

function safeName(value: string): string {
  return value.trim().replace(/[\\/]+/g, '／')
}

export function parseScanExport(value: string): ScanExport {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('JSON 格式不正确，请重新从 Chrome 插件复制。')
  }
  const result = ScanExportSchema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.map(part => String(part)).join('.') || 'root'
    const detail = issue?.message ? `${path}: ${issue.message}` : path
    throw new Error(`JSON 内容不符合 UI-Anatomist 1.0–1.12 格式（${detail}）。`)
  }
  if (result.data.schemaVersion !== '1.11.0') return result.data
  const { diagnostics: _diagnostics, ...designEvidence } = result.data
  return {
    ...designEvidence,
    schemaVersion: '1.10.0'
  }
}

export function createImportPlan(
  data: ScanExport,
  availableFonts: AvailableFontName[],
  existingStyles: ExistingTextStyle[]
): ImportPlan {
  const baseNameFor = (source: TypographyStyle) =>
    `UI-Anatomist/${safeName(data.source.siteLabel)}/${safeName(source.name)}`
  const ownershipFor = (source: TypographyStyle) => `${data.source.origin}|${source.id}`
  const existingByOwnership = new Map(
    existingStyles.filter(style => style.ownershipId).map(style => [style.ownershipId as string, style])
  )
  const currentOwnershipIds = new Set(data.typography.map(ownershipFor))
  const sameOriginOwnershipPrefix = `${data.source.origin}|`
  const isSameOriginOwned = (style: ExistingTextStyle) =>
    style.ownershipId?.startsWith(sameOriginOwnershipPrefix) ?? false
  const isManagedNameFor = (styleName: string, baseName: string) => {
    if (styleName === baseName) return true
    const prefix = `${baseName} · `
    const suffix = styleName.startsWith(prefix) ? styleName.slice(prefix.length) : ''
    return /^[0-9a-f]{6,64}$/.test(suffix)
  }
  const protectedExactNames = new Set(
    data.typography.flatMap(source => {
      const style = existingByOwnership.get(ownershipFor(source))
      const baseName = baseNameFor(source)
      return style && isManagedNameFor(style.name, baseName) ? [style.name] : []
    })
  )
  const claimedNames = new Map<string, string>()
  const claimedExistingIds = new Set<string>()
  const reservedNames = new Set(existingStyles.map(style => style.name))
  const entries: ImportPlanEntry[] = []

  for (const source of data.typography) {
    const baseTargetName = baseNameFor(source)
    const ownershipId = `${data.source.origin}|${source.id}`
    const fontName = resolveFont(
      source.fontFamilyStack,
      source.fontWeight,
      source.fontStyle,
      availableFonts,
      data.source.platform
    )
    const exactOwned = existingByOwnership.get(ownershipId)
    const migratableOwned = existingStyles.find(style =>
      !claimedExistingIds.has(style.id) &&
      isSameOriginOwned(style) &&
      !currentOwnershipIds.has(style.ownershipId ?? '') &&
      isManagedNameFor(style.name, baseTargetName)
    )
    const owned = exactOwned && !claimedExistingIds.has(exactOwned.id) ? exactOwned : migratableOwned

    let action: ImportAction = 'create'
    let existingStyleId: string | null = null
    let targetName = owned && isManagedNameFor(owned.name, baseTargetName)
      ? owned.name
      : baseTargetName
    const targetCollision = existingStyles.find(style => style.name === targetName && style.id !== owned?.id)
    const claimedBy = claimedNames.get(targetName)
    if (!fontName) {
      action = 'skip_missing_font'
    } else if (owned && (targetCollision || (claimedBy && claimedBy !== ownershipId))) {
      action = 'skip_conflict'
      existingStyleId = targetCollision?.id ?? null
    } else if (owned) {
      action = 'update'
      existingStyleId = owned.id
    } else {
      const baseCollisions = existingStyles.filter(style => style.name === baseTargetName)
      const protectedCollision = baseCollisions.find(style => !isSameOriginOwned(style))
      if (protectedCollision) {
        action = 'skip_conflict'
        existingStyleId = protectedCollision.id
      }
      const hash = source.id.slice('sha256:'.length)
      if (action === 'create' && (reservedNames.has(targetName) || protectedExactNames.has(targetName))) {
        let length = 6
        do {
          targetName = `${baseTargetName} · ${hash.slice(0, length)}`
          length += 2
        } while (reservedNames.has(targetName) && length <= hash.length)
      }
    }

    if (action === 'create' || action === 'update') {
      reservedNames.add(targetName)
      claimedNames.set(targetName, ownershipId)
    }
    if (owned) claimedExistingIds.add(owned.id)
    entries.push({ action, source, targetName, ownershipId, fontName, existingStyleId })
  }

  return { source: data.source, entries }
}
