import type { ColorValue, ControlToken, ShadowLayer } from '../shared/schema'
import {
  applyComponentStrokeWeights,
  primaryAxisAlignment,
  readComponentStrokeWeights,
  type AppliedControl,
  type ComponentStrokeWeights,
  type ControlComponentPort,
  type ControlComponentSetPort,
  type ControlEffect,
  type ControlFramePort,
  type ControlIconInstancePort,
  type ControlPaint,
  type ControlTextPort
} from './control-component-applier'
import type {
  CompositeImportPlan,
  CompositeImportPlanEntry,
  CompositeImportPlanGroup,
  CompositePlanControlChild,
  CompositePlanStaticTextRegionChild,
  CompositePlanStructuralChild
} from './composite-import-plan'
import type { AvailableFontName } from './font-resolver'
import { planCompositeLayout } from './composite-layout'

export const COMPOSITE_NODE_OWNERSHIP_KEY = 'smartScanCompositeOwnership'
export const COMPOSITE_GROUP_OWNERSHIP_KEY = 'smartScanCompositeGroupOwnership'
export const COMPOSITE_SHARED_NAMESPACE = 'smart.scan.composites'

type CompositeOwnershipPort = {
  getPluginData(key: string): string
  setPluginData(key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
}

export function readCompositeOwnership(
  port: Pick<CompositeOwnershipPort, 'getPluginData' | 'getSharedPluginData'>,
  key: string
): string {
  let privateValue = ''
  try {
    privateValue = port.getPluginData(key)
  } catch {
    // Shared plugin data remains available in direct Figma execution.
  }
  return privateValue ||
    port.getSharedPluginData?.(COMPOSITE_SHARED_NAMESPACE, key) ||
    ''
}

export function writeCompositeOwnership(
  port: Pick<CompositeOwnershipPort, 'setPluginData' | 'setSharedPluginData'>,
  key: string,
  value: string
): void {
  try {
    port.setPluginData(key, value)
  } catch {
    // Shared plugin data remains the portable ownership channel.
  }
  port.setSharedPluginData?.(COMPOSITE_SHARED_NAMESPACE, key, value)
}

export type CompositeComponentPort = ControlComponentPort
export type CompositeComponentSetPort = ControlComponentSetPort

export type CompositeInstancePort = {
  id: string
  type: 'INSTANCE'
  name: string
  sourceComponentId: string
  width: number
  height: number
  x?: number
  y?: number
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  layoutGrow?: number
  overrides: Map<string, string>
  resize(width: number, height: number): void
  remove?(): void
}

export type CompositeRepository = {
  createComponent(): CompositeComponentPort
  createInstance(component: ControlComponentPort): CompositeInstancePort
  createFrame?(): ControlFramePort
  createText?(): ControlTextPort
  loadFont?(fontName: AvailableFontName): Promise<void>
  createIconInstance?(
    vectorSvg: string,
    foreground: ColorValue
  ): ControlIconInstancePort | null
  overrideText(
    instance: CompositeInstancePort,
    nodeName: string,
    value: string
  ): void | Promise<void>
  overrideIcon?(
    instance: CompositeInstancePort,
    nodeName: string,
    slot: NonNullable<ControlToken['slots']['leading']>,
    foreground: ColorValue
  ): void
  combineAsVariants(
    components: CompositeComponentPort[]
  ): CompositeComponentSetPort
  appendToComponentSet?(
    set: CompositeComponentSetPort,
    component: CompositeComponentPort
  ): void
  clearChildren?(component: CompositeComponentPort): void
  backupChildren?(component: CompositeComponentPort): unknown
  restoreChildren?(component: CompositeComponentPort, backup: unknown): void
  discardChildrenBackup?(backup: unknown): void
  backupPlacement?(component: CompositeComponentPort): unknown
  restorePlacement?(component: CompositeComponentPort, backup: unknown): void
  getNodeById(id: string): Promise<CompositeComponentPort | CompositeComponentSetPort | null>
}

export type AppliedComposite = {
  group: CompositeImportPlanGroup
  entry: CompositeImportPlanEntry
  component: CompositeComponentPort
  componentSet: CompositeComponentSetPort | null
}

export type ApplyCompositeResult = {
  created: CompositeComponentPort[]
  updated: CompositeComponentPort[]
  componentSets: CompositeComponentSetPort[]
  applied: AppliedComposite[]
  conflicts: string[]
  missingFonts: string[]
}

const COMPOSITE_VARIANT_GAP = 16

export function reflowCompositeComponentSet(
  componentSet: CompositeComponentSetPort
): void {
  let x = 0
  let height = 0
  for (const component of componentSet.children) {
    component.x = x
    component.y = 0
    x += component.width + COMPOSITE_VARIANT_GAP
    height = Math.max(height, component.height)
  }
  componentSet.resize(
    Math.max(1, x - (
      componentSet.children.length > 0 ? COMPOSITE_VARIANT_GAP : 0
    )),
    Math.max(1, height)
  )
}

export function reflowAppliedCompositeComponentSets(
  applied: AppliedComposite[]
): void {
  const sets = new Map<string, CompositeComponentSetPort>()
  for (const item of applied) {
    if (item.componentSet) sets.set(item.componentSet.id, item.componentSet)
  }
  for (const componentSet of sets.values()) {
    reflowCompositeComponentSet(componentSet)
  }
}

type CompositeSnapshot = {
  component: CompositeComponentPort
  name: string
  description: string
  layoutMode: CompositeComponentPort['layoutMode']
  primaryAxisSizingMode: CompositeComponentPort['primaryAxisSizingMode']
  counterAxisSizingMode: CompositeComponentPort['counterAxisSizingMode']
  primaryAxisAlignItems: CompositeComponentPort['primaryAxisAlignItems']
  counterAxisAlignItems: CompositeComponentPort['counterAxisAlignItems']
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
  itemSpacing: number
  cornerRadius: number
  fills: ControlPaint[]
  strokes: ControlPaint[]
  strokeWeight: number
  strokeWeights: ComponentStrokeWeights
  clipsContent?: boolean
  effects: ControlEffect[]
  width: number
  height: number
  x: number
  y: number
  ownershipId: string
  childrenBackup: unknown
  placementBackup: unknown
}

type CompositeComponentSetSnapshot = {
  componentSet: CompositeComponentSetPort
  name: string
  description: string
  width: number
  height: number
  ownershipId: string
  children: Array<{
    component: CompositeComponentPort
    x: number
    y: number
  }>
}

function paint(value: ColorValue): ControlPaint[] {
  if (value.a <= 0) return []
  return [{
    type: 'SOLID',
    color: { r: value.r, g: value.g, b: value.b },
    opacity: value.a
  }]
}

function effect(layer: ShadowLayer): ControlEffect {
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

function counterAlignment(
  value: CompositeImportPlanEntry['source']['layout']['align']
): CompositeComponentPort['counterAxisAlignItems'] {
  if (value === 'center') return 'CENTER'
  if (value === 'end') return 'MAX'
  return 'MIN'
}

function snapshot(
  component: CompositeComponentPort,
  repository: CompositeRepository
): CompositeSnapshot {
  if (
    !repository.backupChildren ||
    !repository.restoreChildren ||
    !repository.discardChildrenBackup
  ) {
    throw new Error('Composite repository cannot safely update existing children')
  }
  const values: Omit<CompositeSnapshot, 'childrenBackup' | 'placementBackup'> = {
    component,
    name: component.name,
    description: component.description,
    layoutMode: component.layoutMode,
    primaryAxisSizingMode: component.primaryAxisSizingMode,
    counterAxisSizingMode: component.counterAxisSizingMode,
    primaryAxisAlignItems: component.primaryAxisAlignItems,
    counterAxisAlignItems: component.counterAxisAlignItems,
    paddingTop: component.paddingTop,
    paddingRight: component.paddingRight,
    paddingBottom: component.paddingBottom,
    paddingLeft: component.paddingLeft,
    itemSpacing: component.itemSpacing,
    cornerRadius: component.cornerRadius,
    fills: [...component.fills],
    strokes: [...component.strokes],
    strokeWeight: component.strokeWeight,
    strokeWeights: readComponentStrokeWeights(component),
    clipsContent: component.clipsContent,
    effects: [...component.effects],
    width: component.width,
    height: component.height,
    x: component.x,
    y: component.y,
    ownershipId: readCompositeOwnership(component, COMPOSITE_NODE_OWNERSHIP_KEY)
  }
  const placementBackup = repository.backupPlacement?.(component)
  const childrenBackup = repository.backupChildren(component)
  return {
    ...values,
    childrenBackup,
    placementBackup
  }
}

function restore(
  value: CompositeSnapshot,
  repository: CompositeRepository
): void {
  const component = value.component
  repository.restoreChildren?.(component, value.childrenBackup)
  component.name = value.name
  component.description = value.description
  component.layoutMode = value.layoutMode
  component.primaryAxisSizingMode = value.primaryAxisSizingMode
  component.counterAxisSizingMode = value.counterAxisSizingMode
  component.primaryAxisAlignItems = value.primaryAxisAlignItems
  component.counterAxisAlignItems = value.counterAxisAlignItems
  component.paddingTop = value.paddingTop
  component.paddingRight = value.paddingRight
  component.paddingBottom = value.paddingBottom
  component.paddingLeft = value.paddingLeft
  component.itemSpacing = value.itemSpacing
  component.cornerRadius = value.cornerRadius
  component.fills = value.fills
  component.strokes = value.strokes
  component.strokeWeight = value.strokeWeight
  applyComponentStrokeWeights(component, value.strokeWeights)
  component.clipsContent = value.clipsContent ?? false
  component.effects = value.effects
  component.resize(value.width, value.height)
  if (value.placementBackup !== undefined && repository.restorePlacement) {
    repository.restorePlacement(component, value.placementBackup)
  } else {
    component.x = value.x
    component.y = value.y
  }
  writeCompositeOwnership(
    component,
    COMPOSITE_NODE_OWNERSHIP_KEY,
    value.ownershipId
  )
}

function snapshotComponentSet(
  componentSet: CompositeComponentSetPort
): CompositeComponentSetSnapshot {
  return {
    componentSet,
    name: componentSet.name,
    description: componentSet.description,
    width: componentSet.width,
    height: componentSet.height,
    ownershipId: readCompositeOwnership(
      componentSet,
      COMPOSITE_GROUP_OWNERSHIP_KEY
    ),
    children: componentSet.children.map(component => ({
      component,
      x: component.x,
      y: component.y
    }))
  }
}

function restoreComponentSet(
  value: CompositeComponentSetSnapshot,
  repository: CompositeRepository
): void {
  const componentSet = value.componentSet
  componentSet.name = value.name
  componentSet.description = value.description
  for (const child of value.children) {
    repository.appendToComponentSet?.(componentSet, child.component)
    child.component.x = child.x
    child.component.y = child.y
  }
  componentSet.resize(value.width, value.height)
  writeCompositeOwnership(
    componentSet,
    COMPOSITE_GROUP_OWNERSHIP_KEY,
    value.ownershipId
  )
}

function appliedControlByOwnership(
  applied: AppliedControl[]
): Map<string, AppliedControl> {
  return new Map(applied.map(item => [item.entry.ownershipId, item]))
}

async function applySafeControlOverrides(
  instance: CompositeInstancePort,
  child: CompositePlanControlChild,
  repository: CompositeRepository
): Promise<void> {
  const source = child.source
  if (source.content?.kind === 'compound-row') {
    if (child.sampleText) {
      await repository.overrideText(instance, 'Primary label', child.sampleText)
    }
    if (child.supportingText) {
      await repository.overrideText(instance, 'Supporting label', child.supportingText)
    }
  } else if (source.content?.kind === 'compound-input') {
    if (child.sampleText) {
      await repository.overrideText(instance, 'Placeholder', child.sampleText)
    }
  } else if (child.sampleText) {
    await repository.overrideText(instance, 'Label', child.sampleText)
  }

  const leading = source.slots.leading
  if (leading?.assetType === 'ui-icon' && leading.vectorSvg) {
    repository.overrideIcon?.(
      instance,
      'Leading UI icon instance',
      leading,
      source.appearance.foreground
    )
  }
  const trailing = source.slots.trailing
  if (trailing?.assetType === 'ui-icon' && trailing.vectorSvg) {
    repository.overrideIcon?.(
      instance,
      'Trailing UI icon instance',
      trailing,
      source.appearance.foreground
    )
  }
}

async function createStructuralChild(
  child: CompositePlanStructuralChild,
  repository: CompositeRepository,
  atomicByOwnership: Map<string, AppliedControl>,
  targetWidth?: number,
  missingFonts: string[] = []
): Promise<ControlFramePort> {
  const frame = repository.createFrame?.()
  if (!frame) throw new Error('Composite structural Frame factory is missing')
  try {
    const source = child.source
    const isControl = 'family' in source
    const safeLeading = isControl &&
      source.slots.leading?.assetType === 'ui-icon' &&
      source.slots.leading.vectorSvg
        ? source.slots.leading
        : null
    const safeTrailing = isControl &&
      source.slots.trailing?.assetType === 'ui-icon' &&
      source.slots.trailing.vectorSvg
        ? source.slots.trailing
        : null
    const hasSafeControlGraphic = Boolean(safeLeading || safeTrailing)
    const layoutPlan = isControl ? null : planCompositeLayout(source)
    const observedWidth = isControl
      ? Math.max(1, source.geometry.minWidth ?? source.geometry.height)
      : Math.max(1, source.geometry.width)
    const width = Math.max(1, targetWidth ?? observedWidth)
    frame.name = 'Anonymous structure'
    frame.layoutMode = isControl
      ? hasSafeControlGraphic ? 'HORIZONTAL' : 'NONE'
      : layoutPlan?.mode === 'fixed'
        ? 'NONE'
        : source.layout.direction === 'vertical' ? 'VERTICAL' : 'HORIZONTAL'
    frame.primaryAxisSizingMode = 'FIXED'
    frame.counterAxisSizingMode = 'FIXED'
    frame.primaryAxisAlignItems = isControl
      ? source.content?.kind === 'icon-only'
        ? 'CENTER'
        : safeLeading && safeTrailing
          ? 'SPACE_BETWEEN'
          : safeTrailing ? 'MAX' : 'MIN'
      : primaryAxisAlignment(source.layout.justify)
    frame.counterAxisAlignItems = isControl
      ? hasSafeControlGraphic ? 'CENTER' : 'MIN'
      : counterAlignment(
          layoutPlan?.mode === 'auto' ? layoutPlan.align : source.layout.align
        )
    const padding = !isControl && layoutPlan?.mode === 'auto'
      ? layoutPlan.padding
      : source.geometry.padding
    frame.itemSpacing = isControl
      ? 0
      : layoutPlan?.mode === 'auto' ? layoutPlan.gap : source.geometry.gap
    frame.paddingTop = isControl && !hasSafeControlGraphic ? 0 : padding.top
    frame.paddingRight = isControl && !hasSafeControlGraphic ? 0 : padding.right
    frame.paddingBottom = isControl && !hasSafeControlGraphic ? 0 : padding.bottom
    frame.paddingLeft = isControl && !hasSafeControlGraphic ? 0 : padding.left
    frame.fills = paint(source.appearance.background)
    frame.strokes = paint(source.appearance.border)
    frame.strokeWeight = source.geometry.borderWidth
    const widths = source.geometry.borderWidths
    frame.strokeTopWeight = widths?.top ?? source.geometry.borderWidth
    frame.strokeRightWeight = widths?.right ?? source.geometry.borderWidth
    frame.strokeBottomWeight = widths?.bottom ?? source.geometry.borderWidth
    frame.strokeLeftWeight = widths?.left ?? source.geometry.borderWidth
    frame.cornerRadius = source.geometry.radius
    frame.effects = source.appearance.shadows.map(effect)
    frame.clipsContent = isControl
      ? false
      : source.layout.clipsContent ?? false
    frame.layoutGrow = isControl && source.layout?.widthBehavior === 'fill'
      ? 1
      : 0
    frame.resize(width, Math.max(1, source.geometry.height))
    if (isControl && hasSafeControlGraphic) {
      const appendIcon = (
        slot: NonNullable<ControlToken['slots']['leading']>,
        name: 'Leading UI icon instance' | 'Trailing UI icon instance'
      ): void => {
        const icon = repository.createIconInstance?.(
          slot.vectorSvg!,
          source.appearance.foreground
        )
        if (!icon) {
          throw new Error(
            'Unable to resolve shared Icon Component for confirmed structural UI icon slot.'
          )
        }
        try {
          icon.name = name
          icon.resize(slot.width, slot.height)
          frame.appendChild(icon)
        } catch (error) {
          icon.remove?.()
          throw error
        }
      }
      if (safeLeading) appendIcon(safeLeading, 'Leading UI icon instance')
      if (safeTrailing) appendIcon(safeTrailing, 'Trailing UI icon instance')
    }
    if (!isControl) {
      for (let index = 0; index < (child.children?.length ?? 0); index += 1) {
        const nested = child.children![index]!
        const nestedWidthBehavior = nested.source.layout.widthBehavior
        const nestedWidth = stretchesAcrossVerticalParent(
          source,
          nestedWidthBehavior,
          true
        )
          ? Math.max(
              1,
              width - source.geometry.padding.left - source.geometry.padding.right
            )
          : undefined
        if (nested.kind === 'control') {
          const applied = atomicByOwnership.get(nested.controlOwnershipId)
          if (!applied) throw new Error('Composite atomic dependency is missing')
          const instance = repository.createInstance(applied.component)
          try {
            instance.name = `Control instance ${index + 1}`
            await applySafeControlOverrides(instance, nested, repository)
            if (layoutPlan?.mode !== 'legacy' && nested.placement) {
              instance.resize(nested.placement.width, nested.placement.height)
              if (layoutPlan?.mode === 'fixed') {
                instance.x = nested.placement.x
                instance.y = nested.placement.y
              }
            } else if (nestedWidth !== undefined) {
              instance.resize(nestedWidth, instance.height)
            }
            frame.appendChild(instance)
          } catch (error) {
            instance.remove?.()
            throw error
          }
          continue
        }
        if (nested.kind === 'static-text-region') {
          const region = await createStaticTextRegion(
            nested,
            repository,
            missingFonts
          )
          try {
            if (layoutPlan?.mode !== 'legacy') {
              region.resize(nested.placement.width, nested.placement.height)
              if (layoutPlan?.mode === 'fixed') {
                region.x = nested.placement.x
                region.y = nested.placement.y
              }
            }
            frame.appendChild(region)
          } catch (error) {
            region.remove?.()
            throw error
          }
          continue
        }
        const structure = await createStructuralChild(
          nested,
          repository,
          atomicByOwnership,
          nestedWidth,
          missingFonts
        )
        try {
          if (layoutPlan?.mode !== 'legacy' && nested.placement) {
            structure.resize(nested.placement.width, nested.placement.height)
            if (layoutPlan?.mode === 'fixed') {
              structure.x = nested.placement.x
              structure.y = nested.placement.y
            }
          }
          frame.appendChild(structure)
        } catch (error) {
          structure.remove?.()
          throw error
        }
      }
    }
    return frame
  } catch (error) {
    frame.remove?.()
    throw error
  }
}

async function createStaticTextRegion(
  child: CompositePlanStaticTextRegionChild,
  repository: CompositeRepository,
  missingFonts: string[]
): Promise<ControlFramePort> {
  const frame = repository.createFrame?.()
  if (!frame) throw new Error('Composite static region Frame factory is missing')
  try {
    const source = child.source
    frame.name = 'Static UI region'
    frame.layoutMode = 'NONE'
    frame.primaryAxisSizingMode = 'FIXED'
    frame.counterAxisSizingMode = 'FIXED'
    frame.primaryAxisAlignItems = 'MIN'
    frame.counterAxisAlignItems = 'MIN'
    frame.itemSpacing = source.geometry.gap
    frame.paddingTop = source.geometry.padding.top
    frame.paddingRight = source.geometry.padding.right
    frame.paddingBottom = source.geometry.padding.bottom
    frame.paddingLeft = source.geometry.padding.left
    frame.fills = paint(source.appearance.background)
    frame.strokes = paint(source.appearance.border)
    frame.strokeWeight = source.geometry.borderWidth
    const borderWidths = source.geometry.borderWidths
    frame.strokeTopWeight = borderWidths?.top ?? source.geometry.borderWidth
    frame.strokeRightWeight = borderWidths?.right ?? source.geometry.borderWidth
    frame.strokeBottomWeight = borderWidths?.bottom ?? source.geometry.borderWidth
    frame.strokeLeftWeight = borderWidths?.left ?? source.geometry.borderWidth
    frame.cornerRadius = source.geometry.radius
    frame.effects = source.appearance.shadows.map(effect)
    frame.clipsContent = false
    frame.resize(source.placement.width, source.placement.height)

    if (!source.text) return frame
    if (!child.typography) {
      throw new Error('Static UI copy typography cannot be resolved')
    }
    if (!child.fontName) {
      missingFonts.push(child.typography.name)
      return frame
    }
    if (!repository.createText || !repository.loadFont) {
      throw new Error('Composite static UI copy text factory is missing')
    }
    await repository.loadFont(child.fontName)
    const text = repository.createText()
    try {
      text.name = 'Static UI copy'
      text.fontName = child.fontName
      text.fontSize = child.typography.fontSizePx
      text.lineHeight = child.typography.lineHeightPx === null
        ? null
        : { value: child.typography.lineHeightPx, unit: 'PIXELS' }
      text.letterSpacing = { value: child.typography.letterSpacingPx, unit: 'PIXELS' }
      text.fills = paint(source.text.foreground)
      text.textAutoResize = 'NONE'
      text.resize(source.text.placement.width, source.text.placement.height)
      text.characters = source.text.value
      frame.appendChild(text)
      text.x = source.text.placement.x
      text.y = source.text.placement.y
    } catch (error) {
      text.remove?.()
      throw error
    }
    return frame
  } catch (error) {
    frame.remove?.()
    throw error
  }
}

function stretchesAcrossVerticalParent(
  parent: CompositeImportPlanEntry['source'],
  childWidthBehavior: 'hug' | 'fill',
  anonymousStructure = false
): boolean {
  return parent.layout.direction === 'vertical' && (
    parent.layout.align === 'stretch' ||
    childWidthBehavior === 'fill' ||
    (anonymousStructure && parent.layout.widthBehavior === 'fill')
  )
}

async function configureComponent(
  component: CompositeComponentPort,
  entry: CompositeImportPlanEntry,
  atomicByOwnership: Map<string, AppliedControl>,
  compositesByOwnership: Map<string, AppliedComposite>,
  repository: CompositeRepository,
  missingFonts: string[]
): Promise<void> {
  const source = entry.source
  const layoutSource = entry.layoutSource ?? source
  const layoutPlan = planCompositeLayout(layoutSource)
  component.name = entry.targetName
  component.description = [
    `UI-Anatomist · composite · ${source.kind} · ${source.state}`,
    `${source.children.length} observed children · ${source.occurrences} occurrences`
  ].join('\n')
  component.layoutMode = layoutPlan.mode === 'fixed'
    ? 'NONE'
    : source.layout.direction === 'vertical' ? 'VERTICAL' : 'HORIZONTAL'
  component.primaryAxisSizingMode = 'FIXED'
  component.counterAxisSizingMode = 'FIXED'
  component.primaryAxisAlignItems = primaryAxisAlignment(source.layout.justify)
  component.counterAxisAlignItems = counterAlignment(
    layoutPlan.mode === 'auto' ? layoutPlan.align : source.layout.align
  )
  const padding = layoutPlan.mode === 'auto'
    ? layoutPlan.padding
    : source.geometry.padding
  component.paddingTop = padding.top
  component.paddingRight = padding.right
  component.paddingBottom = padding.bottom
  component.paddingLeft = padding.left
  component.itemSpacing = layoutPlan.mode === 'auto'
    ? layoutPlan.gap
    : source.geometry.gap
  component.cornerRadius = source.geometry.radius
  component.fills = paint(source.appearance.background)
  component.strokes = paint(source.appearance.border)
  component.strokeWeight = source.geometry.borderWidth
  applyComponentStrokeWeights(
    component,
    source.geometry.borderWidths,
    source.geometry.borderWidth
  )
  component.effects = source.appearance.shadows.map(effect)
  writeCompositeOwnership(component, COMPOSITE_NODE_OWNERSHIP_KEY, entry.ownershipId)
  repository.clearChildren?.(component)

  for (let index = 0; index < entry.children.length; index += 1) {
    const child = entry.children[index]!
    if (child.kind === 'static-text-region') {
      const region = await createStaticTextRegion(child, repository, missingFonts)
      try {
        component.appendChild(region)
        region.x = child.placement.x
        region.y = child.placement.y
      } catch (error) {
        region.remove?.()
        throw error
      }
      continue
    }
    if (child.kind === 'structure') {
      const structureWidth = stretchesAcrossVerticalParent(
        source,
        child.source.layout.widthBehavior,
        true
      )
        ? Math.max(
            1,
            source.geometry.width -
              source.geometry.padding.left -
              source.geometry.padding.right
          )
        : undefined
      const structure = await createStructuralChild(
        child,
        repository,
        atomicByOwnership,
        structureWidth,
        missingFonts
      )
      try {
        if (layoutPlan.mode !== 'legacy' && child.placement) {
          structure.resize(child.placement.width, child.placement.height)
          if (layoutPlan.mode === 'fixed') {
            structure.x = child.placement.x
            structure.y = child.placement.y
          }
        }
        component.appendChild(structure)
      } catch (error) {
        structure.remove?.()
        throw error
      }
      continue
    }
    const applied = child.kind === 'control'
      ? atomicByOwnership.get(child.controlOwnershipId)
      : compositesByOwnership.get(child.compositeOwnershipId)
    if (!applied) {
      throw new Error(
        child.kind === 'control'
          ? 'Composite atomic dependency is missing'
          : 'Composite nested dependency is missing'
      )
    }
    const instance = repository.createInstance(applied.component)
    try {
      instance.name = child.kind === 'control'
        ? `Control instance ${index + 1}`
        : `Composite instance ${index + 1}`
      if (child.kind === 'control') {
        await applySafeControlOverrides(instance, child, repository)
      }
      const childWidthBehavior = child.kind === 'control'
        ? child.source.layout.widthBehavior
        : applied.entry.source.layout.widthBehavior
      if (layoutPlan.mode !== 'legacy' && child.placement) {
        instance.resize(child.placement.width, child.placement.height)
        if (layoutPlan.mode === 'fixed') {
          instance.x = child.placement.x
          instance.y = child.placement.y
        }
      } else if (stretchesAcrossVerticalParent(source, childWidthBehavior)) {
        instance.resize(
          Math.max(
            1,
            source.geometry.width -
              source.geometry.padding.left -
              source.geometry.padding.right
          ),
          instance.height
        )
      }
      component.appendChild(instance)
    } catch (error) {
      instance.remove?.()
      throw error
    }
  }
  component.resize(source.geometry.width, source.geometry.height)
  component.clipsContent = source.layout.clipsContent ?? false
}

async function componentFor(
  entry: CompositeImportPlanEntry,
  atomicByOwnership: Map<string, AppliedControl>,
  compositesByOwnership: Map<string, AppliedComposite>,
  repository: CompositeRepository,
  result: ApplyCompositeResult,
  snapshots: CompositeSnapshot[]
): Promise<CompositeComponentPort> {
  if (entry.action === 'update' && entry.existingComponentId) {
    const existing = await repository.getNodeById(entry.existingComponentId)
    if (existing?.type === 'COMPONENT') {
      snapshots.push(snapshot(existing, repository))
      await configureComponent(
        existing,
        entry,
        atomicByOwnership,
        compositesByOwnership,
        repository,
        result.missingFonts
      )
      result.updated.push(existing)
      return existing
    }
  }
  const component = repository.createComponent()
  try {
    await configureComponent(
      component,
      entry,
      atomicByOwnership,
      compositesByOwnership,
      repository,
      result.missingFonts
    )
  } catch (error) {
    component.remove()
    throw error
  }
  result.created.push(component)
  return component
}

export async function applyCompositeImportPlan(
  plan: CompositeImportPlan,
  appliedControls: AppliedControl[],
  repository: CompositeRepository
): Promise<ApplyCompositeResult> {
  const result: ApplyCompositeResult = {
    created: [],
    updated: [],
    componentSets: [],
    applied: [],
    conflicts: [],
    missingFonts: []
  }
  const atomicByOwnership = appliedControlByOwnership(appliedControls)
  const compositesByOwnership = new Map<string, AppliedComposite>()
  const snapshots: CompositeSnapshot[] = []
  const componentSetSnapshots: CompositeComponentSetSnapshot[] = []
  const createdComponentSets: CompositeComponentSetPort[] = []

  try {
    for (const group of plan.groups) {
      if (group.action === 'skip_conflict') {
        result.conflicts.push(group.conflictName ?? group.targetName)
        continue
      }
      const components: CompositeComponentPort[] = []
      for (const entry of group.entries) {
        components.push(await componentFor(
          entry,
          atomicByOwnership,
          compositesByOwnership,
          repository,
          result,
          snapshots
        ))
      }
      let componentSet: CompositeComponentSetPort | null = null
      if (group.kind === 'component_set') {
        const existing = group.existingGroupNodeId
          ? await repository.getNodeById(group.existingGroupNodeId)
          : null
        if (existing?.type === 'COMPONENT_SET') {
          if (!repository.appendToComponentSet) {
            throw new Error('Composite repository cannot safely restore a Component Set')
          }
          componentSet = existing
          componentSetSnapshots.push(snapshotComponentSet(componentSet))
          for (const component of components) {
            if (!componentSet.children.includes(component)) {
              repository.appendToComponentSet?.(componentSet, component)
            }
          }
        } else {
          componentSet = repository.combineAsVariants(components)
          createdComponentSets.push(componentSet)
        }
        componentSet.name = group.targetName
        componentSet.description =
          `UI-Anatomist · ${group.entries.length} observed composite states`
        writeCompositeOwnership(
          componentSet,
          COMPOSITE_GROUP_OWNERSHIP_KEY,
          group.groupOwnershipId
        )
        reflowCompositeComponentSet(componentSet)
        result.componentSets.push(componentSet)
      }
      group.entries.forEach((entry, index) => {
        const component = components[index]
        if (!component) return
        const applied: AppliedComposite = { group, entry, component, componentSet }
        result.applied.push(applied)
        compositesByOwnership.set(entry.ownershipId, applied)
      })
    }
  } catch (error) {
    const restoredSnapshots: CompositeSnapshot[] = []
    for (const node of result.created.reverse()) {
      try { node.remove() } catch { /* outer transaction is the final boundary */ }
    }
    for (const previous of [...snapshots].reverse()) {
      try {
        restore(previous, repository)
        restoredSnapshots.push(previous)
      } catch { /* preserve this backup and restore remaining owned components */ }
    }
    for (const componentSet of createdComponentSets.reverse()) {
      try { componentSet.remove() } catch { /* remove only sets created by this transaction */ }
    }
    for (const previous of componentSetSnapshots.reverse()) {
      try { restoreComponentSet(previous, repository) } catch { /* restore remaining sets */ }
    }
    for (const previous of restoredSnapshots) {
      try {
        repository.discardChildrenBackup?.(previous.childrenBackup)
      } catch { /* discard remaining successfully restored scaffolds */ }
    }
    throw error
  }

  for (const previous of snapshots) {
    try {
      repository.discardChildrenBackup?.(previous.childrenBackup)
    } catch { /* committed imports must not fail during backup disposal */ }
  }

  result.conflicts = [...new Set(result.conflicts)]
  return result
}
