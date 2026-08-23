import type { IconToken, ScanExport } from '../shared/schema'
import { isSafeIconNameValue } from '../shared/safe-evidence'

export type ExistingIconNode = {
  id: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  name: string
  ownershipId: string | null
}

export type IconImportPlanEntry = {
  action: 'create' | 'update' | 'skip_conflict'
  assetKind: 'component' | 'component-set'
  states: Array<'Glyph' | 'Default' | 'Hover' | 'Pressed' | 'Selected' | 'Expanded'>
  source: IconToken
  targetName: string
  ownershipId: string
  existingNodeId: string | null
  existingComponentSetId: string | null
}

export type IconImportPlan = {
  source: ScanExport['source']
  entries: IconImportPlanEntry[]
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

function iconHash(id: string): string {
  return id.startsWith('sha256:') ? id.slice('sha256:'.length) : id
}

export function sanitizeIconTokenForImport(source: IconToken): IconToken {
  const fallbackName = `icon-${iconHash(source.id).slice(0, 6).toLowerCase()}`
  const normalizedName = source.name.normalize('NFKC').trim()
  const trustedTextSource =
    source.nameSource === 'svg-title' || source.nameSource === 'visible-text'
  const name = trustedTextSource && isSafeIconNameValue(normalizedName)
    ? normalizedName
    : fallbackName
  return {
    ...source,
    name,
    nameSource: name === fallbackName ? 'geometry' : source.nameSource
  }
}

function shortestUniqueIconId(source: IconToken, siblings: IconToken[]): string {
  const hash = iconHash(source.id)
  for (let length = 6; length <= hash.length; length += 2) {
    const prefix = hash.slice(0, length)
    if (siblings.every(sibling =>
      sibling === source || iconHash(sibling.id).slice(0, length) !== prefix
    )) return prefix
  }
  return hash
}

function targetNamesByIconId(icons: IconToken[]): Map<string, string> {
  const groups = new Map<string, IconToken[]>()
  for (const source of icons) {
    const baseName = `Icon/${title(source.category)}/${title(source.name)}`
    groups.set(baseName, [...(groups.get(baseName) ?? []), source])
  }

  const targetNames = new Map<string, string>()
  for (const [baseName, sources] of groups) {
    const ordered = [...sources].sort((left, right) => left.id.localeCompare(right.id))
    for (const source of ordered) {
      targetNames.set(
        source.id,
        ordered.length === 1
          ? baseName
          : `${baseName} · ${shortestUniqueIconId(source, ordered)}`
      )
    }
  }
  return targetNames
}

function observedStates(source: IconToken): IconImportPlanEntry['states'] {
  const order: IconImportPlanEntry['states'] = [
    'Default', 'Hover', 'Pressed', 'Selected', 'Expanded'
  ]
  const surfaces = source.interactionSurfaces ?? []
  if (surfaces.length === 0) return ['Default']

  const surfaceFingerprint = (state: IconImportPlanEntry['states'][number]) => {
    const sourceState = state.toLowerCase()
    const evidence = surfaces
      .filter(surface => surface.state === sourceState)
      .map(surface => JSON.stringify({
        theme: surface.theme,
        background: surface.background,
        width: surface.width,
        height: surface.height,
        radii: surface.radii
      }))
    return [...new Set(evidence)].sort().join('|')
  }
  const fingerprints = new Set<string>()
  const states: IconImportPlanEntry['states'] = []
  for (const state of order) {
    const fingerprint = surfaceFingerprint(state)
    if (!fingerprint || fingerprints.has(fingerprint)) continue
    fingerprints.add(fingerprint)
    states.push(state)
  }
  return states.length > 0 ? ['Glyph', ...states] : ['Default']
}

export function createIconImportPlan(
  data: ScanExport,
  existingNodes: ExistingIconNode[]
): IconImportPlan {
  const icons = ('icons' in data ? data.icons : []).map(sanitizeIconTokenForImport)
  const targetNames = targetNamesByIconId(icons)
  const entries = icons.map(source => {
    const targetName = targetNames.get(source.id) ??
      `Icon/${title(source.category)}/${title(source.name)}`
    const ownershipId = `${data.source.origin}|icon:${source.id}`
    const owned = existingNodes.find(node =>
      node.ownershipId === ownershipId
    )
    const collision = existingNodes.find(node =>
      node.name === targetName && node.id !== owned?.id
    )
    const states = observedStates(source)
    return {
      action: collision
        ? 'skip_conflict' as const
        : owned ? 'update' as const : 'create' as const,
      assetKind: states.length > 1 ? 'component-set' as const : 'component' as const,
      states,
      source,
      targetName,
      ownershipId,
      existingNodeId: owned?.id ?? null,
      existingComponentSetId: owned?.type === 'COMPONENT_SET' ? owned.id : null
    }
  })
  return { source: data.source, entries }
}
