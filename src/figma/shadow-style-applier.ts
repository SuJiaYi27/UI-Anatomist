import type { ShadowLayer } from '../shared/schema'
import type { ShadowImportPlanEntry } from './shadow-import-plan'
import { readOwnership, writeOwnership } from './ownership'

export const SHADOW_OWNERSHIP_KEY = 'smartScanShadowOwnership'
export const SHADOW_SHARED_NAMESPACE = 'smart.scan.shadows'

export type FigmaShadowEffect = {
  type: 'DROP_SHADOW' | 'INNER_SHADOW'
  color: { r: number; g: number; b: number; a: number }
  offset: { x: number; y: number }
  radius: number
  spread: number
  visible: true
  blendMode: 'NORMAL'
}

export type EffectStylePort = {
  id: string
  name: string
  description: string
  effects: FigmaShadowEffect[]
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type EffectStyleRepository = {
  createEffectStyle(): EffectStylePort
  getEffectStyleById(id: string): Promise<EffectStylePort | null>
}

export type AppliedShadow = {
  entry: ShadowImportPlanEntry
  style: EffectStylePort
}

export type ApplyShadowResult = {
  created: EffectStylePort[]
  updated: EffectStylePort[]
  applied: AppliedShadow[]
  conflicts: string[]
}

type EffectStyleSnapshot = {
  style: EffectStylePort
  name: string
  description: string
  effects: FigmaShadowEffect[]
  ownershipId: string
}

function effectFor(layer: ShadowLayer): FigmaShadowEffect {
  return {
    type: layer.kind === 'inner' ? 'INNER_SHADOW' : 'DROP_SHADOW',
    color: { ...layer.color },
    offset: { x: layer.offsetX, y: layer.offsetY },
    radius: layer.blur,
    spread: layer.spread,
    visible: true,
    blendMode: 'NORMAL'
  }
}

function cloneEffects(effects: FigmaShadowEffect[]): FigmaShadowEffect[] {
  return effects.map(effect => ({
    ...effect,
    color: { ...effect.color },
    offset: { ...effect.offset }
  }))
}

function configure(style: EffectStylePort, entry: ShadowImportPlanEntry): void {
  style.name = entry.targetName
  style.description = [
    `UI-Anatomist · ${entry.source.layers.length} ${entry.source.layers.length === 1 ? 'layer' : 'layers'}`,
    `${entry.source.occurrences} occurrences`,
    entry.source.layers.map((layer, index) => [
      `${index + 1}. ${layer.kind}`,
      `x${layer.offsetX}`,
      `y${layer.offsetY}`,
      `blur${layer.blur}`,
      `spread${layer.spread}`,
      `alpha${layer.color.a}`
    ].join(' · ')).join('\n')
  ].join('\n')
  style.effects = entry.source.layers.map(effectFor)
  writeOwnership(style, SHADOW_SHARED_NAMESPACE, SHADOW_OWNERSHIP_KEY, entry.ownershipId)
}

function restore(snapshot: EffectStyleSnapshot): void {
  snapshot.style.name = snapshot.name
  snapshot.style.description = snapshot.description
  snapshot.style.effects = cloneEffects(snapshot.effects)
  writeOwnership(
    snapshot.style,
    SHADOW_SHARED_NAMESPACE,
    SHADOW_OWNERSHIP_KEY,
    snapshot.ownershipId
  )
}

export async function applyShadowImportPlan(
  entries: ShadowImportPlanEntry[],
  repository: EffectStyleRepository
): Promise<ApplyShadowResult> {
  const result: ApplyShadowResult = {
    created: [],
    updated: [],
    applied: [],
    conflicts: [...new Set(entries.flatMap(entry => entry.conflictName ? [entry.conflictName] : []))]
  }
  const snapshots: EffectStyleSnapshot[] = []

  try {
    for (const entry of entries) {
      if (entry.action === 'create') {
        const style = repository.createEffectStyle()
        try {
          configure(style, entry)
        } catch (error) {
          style.remove()
          throw error
        }
        result.created.push(style)
        result.applied.push({ entry, style })
        continue
      }

      if (!entry.existingStyleId) continue
      const style = await repository.getEffectStyleById(entry.existingStyleId)
      if (!style) continue
      snapshots.push({
        style,
        name: style.name,
        description: style.description,
        effects: cloneEffects(style.effects),
        ownershipId: readOwnership(style, SHADOW_SHARED_NAMESPACE, SHADOW_OWNERSHIP_KEY)
      })
      configure(style, entry)
      result.updated.push(style)
      result.applied.push({ entry, style })
    }
  } catch (error) {
    for (const style of result.created) {
      try { style.remove() } catch { /* outer Figma undo remains the final rollback boundary */ }
    }
    for (const snapshot of snapshots.reverse()) {
      try { restore(snapshot) } catch { /* continue restoring the rest of the batch */ }
    }
    throw error
  }

  return result
}
