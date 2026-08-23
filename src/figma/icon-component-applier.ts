import type { IconImportPlan, IconImportPlanEntry } from './icon-import-plan'
import {
  readIconOwnership,
  writeIconOwnership
} from './icon-variable-applier'

export const ICON_NODE_OWNERSHIP_KEY = 'smartScanIconOwnership'
export { readIconOwnership, writeIconOwnership }

type PluginDataPort = {
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
}

export type IconPaint = {
  type: 'SOLID'
  color: { r: number; g: number; b: number }
  opacity?: number
}

export type IconVectorPort = {
  type: 'VECTOR'
  name: string
  x: number
  y: number
  width: number
  height: number
  fills: readonly unknown[]
  strokes: readonly unknown[]
  remove?(): void
}

export type IconRectanglePort = {
  type: 'RECTANGLE'
  name: string
  x: number
  y: number
  width: number
  height: number
  cornerRadius: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomRightRadius?: number
  bottomLeftRadius?: number
  fills: readonly unknown[]
  resize(width: number, height: number): void
  remove?(): void
}

export type IconFramePort = {
  type: 'FRAME'
  children: Array<IconVectorPort | IconRectanglePort>
  remove?(): void
}

export type IconComponentPort = PluginDataPort & {
  id: string
  type: 'COMPONENT'
  name: string
  description: string
  x: number
  y: number
  width: number
  height: number
  fills: readonly unknown[]
  children: Array<IconVectorPort | IconRectanglePort>
  resize(width: number, height: number): void
  appendChild(child: IconVectorPort | IconRectanglePort): void
  remove(): void
}

export type IconComponentSetPort = PluginDataPort & {
  id: string
  type: 'COMPONENT_SET'
  name: string
  description: string
  children: IconComponentPort[]
  width?: number
  height?: number
  resize?(width: number, height: number): void
  appendChild(component: IconComponentPort): void
  remove(): void
}

export type IconVariableReference = { id: string }

export type IconComponentRepository = {
  createComponent(): IconComponentPort
  createRectangle(): IconRectanglePort
  createNodeFromSvg(svg: string): IconFramePort
  flatten(nodes: Array<IconVectorPort | IconRectanglePort>): IconVectorPort
  combineAsVariants(components: IconComponentPort[]): IconComponentSetPort
  getNodeById(
    id: string
  ): Promise<IconComponentPort | IconComponentSetPort | null>
  bindVectorColor(vector: IconVectorPort, variable: IconVariableReference): void
  bindRectangleColor(rectangle: IconRectanglePort, variable: IconVariableReference): void
}

export type AppliedIcon = {
  entry: IconImportPlanEntry
  asset: IconComponentPort | IconComponentSetPort
  componentSet: IconComponentSetPort | null
  components: IconComponentPort[]
}

const ICON_VARIANT_GAP = 16

export function reflowIconComponentSet(
  componentSet: IconComponentSetPort,
  fallbackComponents: IconComponentPort[] = []
): void {
  const components = componentSet.children.length > 0
    ? componentSet.children
    : fallbackComponents
  let x = 0
  let height = 0
  for (const component of components) {
    component.x = x
    component.y = 0
    x += component.width + ICON_VARIANT_GAP
    height = Math.max(height, component.height)
  }
  componentSet.resize?.(
    Math.max(1, x - (components.length > 0 ? ICON_VARIANT_GAP : 0)),
    Math.max(1, height)
  )
}

export function iconSvgKey(svg: string): string {
  return svg
    .replace(/currentcolor/gi, 'currentColor')
    .replace(
      /<svg\b([^>]*)>/i,
      (_match, attributes: string) =>
        `<svg${attributes.replace(/\s(?:width|height)="[^"]*"/gi, '')}>`
    )
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()
}

function sizedSvg(svg: string): string {
  return svg.replace(
    /<svg\b([^>]*)>/i,
    (_match, attributes: string) =>
      `<svg${attributes.replace(/\s(?:width|height)="[^"]*"/gi, '')} width="24" height="24">`
  )
}

function importVector(
  entry: IconImportPlanEntry,
  repository: IconComponentRepository,
  offset: { x: number; y: number },
  primary: IconVariableReference
): { vector: IconVectorPort; frame: IconFramePort } {
  const frame = repository.createNodeFromSvg(sizedSvg(entry.source.vectorSvg))
  const vector = repository.flatten([...frame.children])
  vector.name = 'Vector'
  vector.x += offset.x
  vector.y += offset.y
  repository.bindVectorColor(vector, primary)
  return { vector, frame }
}

function preferredInteractionSurface(
  entry: IconImportPlanEntry,
  state: IconImportPlanEntry['states'][number]
) {
  const sourceState = state.toLowerCase()
  return [...(entry.source.interactionSurfaces ?? [])]
    .filter(surface => surface.state === sourceState)
    .sort((left, right) =>
    right.occurrences - left.occurrences ||
    left.theme.localeCompare(right.theme)
  )[0] ?? null
}

function interactionFootprint(entry: IconImportPlanEntry) {
  const surfaces = [...(entry.source.interactionSurfaces ?? [])]
  if (surfaces.length === 0) return null
  return {
    width: Math.max(...surfaces.map(surface => surface.width)),
    height: Math.max(...surfaces.map(surface => surface.height))
  }
}

function configureComponent(
  component: IconComponentPort,
  entry: IconImportPlanEntry,
  state: IconImportPlanEntry['states'][number],
  repository: IconComponentRepository,
  variables: {
    primary: IconVariableReference
    defaultBackgroundByIconId?: ReadonlyMap<string, IconVariableReference>
    hoverBackgroundByIconId: ReadonlyMap<string, IconVariableReference>
    accentByIconId?: ReadonlyMap<string, IconVariableReference>
  }
): void {
  const surface = preferredInteractionSurface(
    entry,
    state
  )
  const footprint = state === 'Glyph' ? null : interactionFootprint(entry)
  const width = Math.max(24, footprint?.width ?? 24)
  const height = Math.max(24, footprint?.height ?? 24)
  component.name = `State=${state}`
  component.description = `UI-Anatomist · original SVG · ${entry.source.occurrences} occurrences`
  component.fills = []
  component.resize(width, height)
  const backgroundVariable = state === 'Default'
    ? variables.defaultBackgroundByIconId?.get(entry.source.id)
    : state === 'Hover'
      ? variables.hoverBackgroundByIconId.get(entry.source.id)
      : undefined
  if (surface && backgroundVariable) {
    const background = repository.createRectangle()
    background.name = `${state} background`
    background.x = (width - surface.width) / 2
    background.y = (height - surface.height) / 2
    background.resize(surface.width, surface.height)
    const radii = surface.radii
    background.cornerRadius = radii.topLeft
    background.topLeftRadius = radii.topLeft
    background.topRightRadius = radii.topRight
    background.bottomRightRadius = radii.bottomRight
    background.bottomLeftRadius = radii.bottomLeft
    repository.bindRectangleColor(background, backgroundVariable)
    component.appendChild(background)
  }
  const imported = importVector(
    entry,
    repository,
    {
      x: (width - 24) / 2,
      y: (height - 24) / 2
    },
    variables.accentByIconId?.get(entry.source.id) ?? variables.primary
  )
  component.appendChild(imported.vector)
  // Figma keeps the flattened Vector parented to the temporary SVG frame.
  // Detach it into the component before deleting that frame, otherwise the
  // frame removal also deletes the Vector and combineAsVariants fails.
  imported.frame.remove?.()
}

export async function applyIconImportPlan(
  plan: IconImportPlan,
  repository: IconComponentRepository,
  variables: {
    primary: IconVariableReference | null
    defaultBackgroundByIconId?: ReadonlyMap<string, IconVariableReference>
    hoverBackgroundByIconId: ReadonlyMap<string, IconVariableReference>
    accentByIconId?: ReadonlyMap<string, IconVariableReference>
  }
) {
  const result: {
    created: Array<IconComponentPort | IconComponentSetPort>
    updated: Array<IconComponentPort | IconComponentSetPort>
    assets: Array<IconComponentPort | IconComponentSetPort>
    componentSets: IconComponentSetPort[]
    applied: AppliedIcon[]
    conflicts: string[]
  } = {
    created: [],
    updated: [],
    assets: [],
    componentSets: [],
    applied: [],
    conflicts: plan.entries
      .filter(entry => entry.action === 'skip_conflict')
      .map(entry => entry.targetName)
  }
  if (!variables.primary) {
    if (plan.entries.some(entry => entry.action !== 'skip_conflict')) {
      throw new Error('缺少 Icon/Primary 变量。')
    }
    return result
  }
  for (const entry of plan.entries) {
    if (entry.action === 'skip_conflict') continue
    const replacements = entry.states.map(() => repository.createComponent())
    try {
      replacements.forEach((component, index) => {
        configureComponent(component, entry, entry.states[index]!, repository, {
          primary: variables.primary!,
          defaultBackgroundByIconId: variables.defaultBackgroundByIconId,
          hoverBackgroundByIconId: variables.hoverBackgroundByIconId,
          accentByIconId: variables.accentByIconId
        })
      })
      const existing = entry.existingNodeId
        ? await repository.getNodeById(entry.existingNodeId)
        : null

      if (entry.assetKind === 'component') {
        const replacement = replacements[0]!
        replacement.name = entry.targetName
        replacement.description =
          `UI-Anatomist · observed ${entry.states[0]} geometry · original SVG · ` +
          `${entry.source.occurrences} occurrences`
        writeIconOwnership(
          replacement,
          ICON_NODE_OWNERSHIP_KEY,
          entry.ownershipId
        )
        let asset: IconComponentPort
        if (existing?.type === 'COMPONENT') {
          const previousChildren = [...existing.children]
          const nextChildren = [...replacement.children]
          const previous = {
            name: existing.name,
            description: existing.description,
            fills: existing.fills,
            width: existing.width,
            height: existing.height
          }
          try {
            existing.name = entry.targetName
            existing.description = replacement.description
            existing.fills = replacement.fills
            existing.resize(replacement.width, replacement.height)
            for (const child of nextChildren) existing.appendChild(child)
            for (const child of previousChildren) child.remove?.()
            writeIconOwnership(
              existing,
              ICON_NODE_OWNERSHIP_KEY,
              entry.ownershipId
            )
            replacement.remove()
            asset = existing
          } catch (error) {
            for (const child of nextChildren) child.remove?.()
            existing.name = previous.name
            existing.description = previous.description
            existing.fills = previous.fills
            existing.resize(previous.width, previous.height)
            throw error
          }
        } else {
          if (existing?.type === 'COMPONENT_SET') existing.remove()
          asset = replacement
        }
        if (existing) result.updated.push(asset)
        else result.created.push(asset)
        result.assets.push(asset)
        result.applied.push({
          entry,
          asset,
          componentSet: null,
          components: [asset]
        })
      } else {
        if (replacements.length < 2) {
          throw new Error('Icon Component Set 缺少至少两个已观察状态。')
        }
        let set: IconComponentSetPort
        if (existing?.type === 'COMPONENT_SET') {
          const previousChildren = [...existing.children]
          const previousNames = new Map(
            previousChildren.map(child => [child, child.name])
          )
          const reservedNames = new Set([
            ...previousChildren.map(child => child.name),
            ...replacements.map(child => child.name)
          ])
          let legacyIndex = 1
          try {
            for (const child of previousChildren) {
              let legacyName = `State=__SmartScanLegacy-${legacyIndex}`
              while (reservedNames.has(legacyName)) {
                legacyIndex += 1
                legacyName = `State=__SmartScanLegacy-${legacyIndex}`
              }
              child.name = legacyName
              reservedNames.add(legacyName)
              legacyIndex += 1
            }
            // A real Component Set must never cross the one-child boundary.
            // Append every replacement first; only then remove legacy states.
            for (const component of replacements) {
              existing.appendChild(component)
            }
            for (const child of previousChildren) child.remove()
            set = existing
          } catch (error) {
            for (const [child, name] of previousNames) child.name = name
            throw error
          }
        } else {
          set = repository.combineAsVariants(replacements)
          if (existing?.type === 'COMPONENT') existing.remove()
        }
        set.name = entry.targetName
        set.description =
          'UI-Anatomist · evidence-backed interaction states · original SVG'
        writeIconOwnership(set, ICON_NODE_OWNERSHIP_KEY, entry.ownershipId)
        reflowIconComponentSet(set, replacements)
        if (existing) result.updated.push(set)
        else result.created.push(set)
        result.assets.push(set)
        result.componentSets.push(set)
        result.applied.push({
          entry,
          asset: set,
          componentSet: set,
          components: replacements
        })
      }
    } catch (error) {
      for (const component of replacements) component.remove()
      throw error
    }
  }
  return result
}
