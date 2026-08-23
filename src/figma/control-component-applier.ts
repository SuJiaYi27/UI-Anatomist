import type { ColorValue, ShadowLayer } from '../shared/schema'
import type {
  ControlImportPlan,
  ControlImportPlanEntry,
  ControlImportPlanGroup
} from './control-import-plan'
import type { AvailableFontName } from './font-resolver'
import { controlContentKind } from './control-presentation'

export const CONTROL_NODE_OWNERSHIP_KEY = 'smartScanControlOwnership'
export const CONTROL_GROUP_OWNERSHIP_KEY = 'smartScanControlGroupOwnership'
export const CONTROL_SHARED_NAMESPACE = 'smart.scan.controls'

type ControlOwnershipReader = {
  getPluginData(key: string): string
  getSharedPluginData?(namespace: string, key: string): string
}

type ControlOwnershipWriter = ControlOwnershipReader & {
  setPluginData(key: string, value: string): void
  setSharedPluginData?(namespace: string, key: string, value: string): void
}

export function readControlOwnership(
  port: ControlOwnershipReader,
  key: string
): string {
  let privateValue = ''
  try {
    privateValue = port.getPluginData(key)
  } catch {
    // Direct Figma execution cannot access private plugin data.
  }
  return privateValue ||
    port.getSharedPluginData?.(CONTROL_SHARED_NAMESPACE, key) ||
    ''
}

export function writeControlOwnership(
  port: ControlOwnershipWriter,
  key: string,
  value: string
): void {
  try {
    port.setPluginData(key, value)
  } catch {
    // Shared ownership remains available to direct Figma execution.
  }
  port.setSharedPluginData?.(CONTROL_SHARED_NAMESPACE, key, value)
}

export type ControlPaint = {
  type: 'SOLID'
  color: { r: number; g: number; b: number }
  opacity: number
}

export type ControlEffect = {
  type: 'DROP_SHADOW' | 'INNER_SHADOW'
  color: ColorValue
  offset: { x: number; y: number }
  radius: number
  spread: number
  visible: true
  blendMode: 'NORMAL'
  showShadowBehindNode?: boolean
}

export type ControlTextPort = {
  type: 'TEXT'
  name: string
  x?: number
  y?: number
  characters: string
  fontName: AvailableFontName | null
  fontSize: number
  lineHeight: { value: number; unit: 'PIXELS' } | null
  letterSpacing: number | { value: number; unit: 'PIXELS' }
  fills: ControlPaint[]
  width: number
  height: number
  textAutoResize: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'
  resize(width: number, height: number): void
  remove?(): void
}

export type ControlRectanglePort = {
  type: 'RECTANGLE'
  name: string
  width: number
  height: number
  fills: ControlPaint[]
  strokes: ControlPaint[]
  strokeWeight?: number
  dashPattern?: number[]
  cornerRadius?: number
  resize(width: number, height: number): void
  remove?(): void
}

export type ControlFramePort = {
  type: 'FRAME'
  name: string
  x?: number
  y?: number
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  primaryAxisSizingMode: 'FIXED' | 'AUTO'
  counterAxisSizingMode: 'FIXED' | 'AUTO'
  primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE'
  itemSpacing: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  fills: ControlPaint[]
  strokes: ControlPaint[]
  strokeWeight?: number
  strokeTopWeight?: number
  strokeRightWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  effects?: ControlEffect[]
  cornerRadius?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomRightRadius?: number
  bottomLeftRadius?: number
  clipsContent?: boolean
  width: number
  height: number
  layoutGrow?: number
  children: ControlChildPort[]
  appendChild(child: ControlChildPort): void
  resize(width: number, height: number): void
  remove?(): void
}

export type ControlIconInstancePort = {
  type: 'INSTANCE'
  name: string
  width: number
  height: number
  resize(width: number, height: number): void
  remove?(): void
}

export type ControlChildPort =
  | ControlTextPort
  | ControlRectanglePort
  | ControlFramePort
  | ControlIconInstancePort

export type ControlNodePort = {
  id: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  name: string
  description: string
  children: Array<ControlComponentPort | ControlChildPort>
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type ControlComponentPort = ControlNodePort & {
  type: 'COMPONENT'
  x: number
  y: number
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  primaryAxisSizingMode: 'FIXED' | 'AUTO'
  counterAxisSizingMode: 'FIXED' | 'AUTO'
  primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE'
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
  itemSpacing: number
  cornerRadius: number
  fills: ControlPaint[]
  strokes: ControlPaint[]
  strokeWeight: number
  strokeTopWeight?: number
  strokeRightWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  effects: ControlEffect[]
  clipsContent?: boolean
  width: number
  height: number
  appendChild(child: ControlChildPort): void
  resize(width: number, height: number): void
}

export function primaryAxisAlignment(
  value: 'start' | 'center' | 'end' | 'space-between'
): ControlComponentPort['primaryAxisAlignItems'] {
  if (value === 'center') return 'CENTER'
  if (value === 'end') return 'MAX'
  if (value === 'space-between') return 'SPACE_BETWEEN'
  return 'MIN'
}

export type ComponentStrokeWeights = {
  top: number
  right: number
  bottom: number
  left: number
}

export function readComponentStrokeWeights(
  component: ControlComponentPort
): ComponentStrokeWeights {
  return {
    top: component.strokeTopWeight ?? component.strokeWeight,
    right: component.strokeRightWeight ?? component.strokeWeight,
    bottom: component.strokeBottomWeight ?? component.strokeWeight,
    left: component.strokeLeftWeight ?? component.strokeWeight
  }
}

export function applyComponentStrokeWeights(
  component: ControlComponentPort,
  value: ComponentStrokeWeights | undefined,
  fallback = component.strokeWeight
): void {
  const widths = value ?? {
    top: fallback,
    right: fallback,
    bottom: fallback,
    left: fallback
  }
  component.strokeTopWeight = widths.top
  component.strokeRightWeight = widths.right
  component.strokeBottomWeight = widths.bottom
  component.strokeLeftWeight = widths.left
}

export type ControlComponentSetPort = ControlNodePort & {
  type: 'COMPONENT_SET'
  width: number
  height: number
  children: ControlComponentPort[]
  resize(width: number, height: number): void
}

export type ControlRepository = {
  createComponent(): ControlComponentPort
  createText(): ControlTextPort
  createRectangle(): ControlRectanglePort
  createFrame?(): ControlFramePort
  createNodeFromSvg?(svg: string): ControlFramePort
  createIconInstance?(
    vectorSvg: string,
    foreground: ColorValue
  ): ControlIconInstancePort | null
  prepareForVariantCombine?(components: ControlComponentPort[]): void
  combineAsVariants(components: ControlComponentPort[]): ControlComponentSetPort
  appendToComponentSet?(set: ControlComponentSetPort, component: ControlComponentPort): void
  clearChildren?(component: ControlComponentPort): void
  backupChildren?(component: ControlComponentPort): unknown
  restoreChildren?(component: ControlComponentPort, backup: unknown): void
  discardChildrenBackup?(backup: unknown): void
  backupPlacement?(component: ControlComponentPort): unknown
  restorePlacement?(component: ControlComponentPort, backup: unknown): void
  getNodeById(id: string): Promise<ControlNodePort | null>
  loadFont(font: AvailableFontName): Promise<void>
}

export type AppliedControl = {
  group: ControlImportPlanGroup
  entry: ControlImportPlanEntry
  component: ControlComponentPort
  componentSet: ControlComponentSetPort | null
}

export type ApplyControlResult = {
  created: ControlComponentPort[]
  updated: ControlComponentPort[]
  componentSets: ControlComponentSetPort[]
  applied: AppliedControl[]
  conflicts: string[]
  missingFonts: string[]
}

const CONTROL_VARIANT_GAP = 16
const MAX_REUSABLE_FILL_WIDTH = 640
const CONTROL_VARIANT_STATE_ORDER = [
  'Default', 'Hover', 'Focus', 'Pressed', 'Selected', 'Expanded', 'Disabled'
]

function variantStateOrder(name: string): number {
  const state = /^State=([^,]+)/.exec(name)?.[1]
  const index = state ? CONTROL_VARIANT_STATE_ORDER.indexOf(state) : -1
  return index < 0 ? CONTROL_VARIANT_STATE_ORDER.length : index
}

export function reflowControlComponentSet(
  componentSet: ControlComponentSetPort
): void {
  let x = 0
  let height = 0
  const components = [...componentSet.children].sort((left, right) =>
    variantStateOrder(left.name) - variantStateOrder(right.name)
  )
  for (const component of components) {
    component.x = x
    component.y = 0
    x += component.width + CONTROL_VARIANT_GAP
    height = Math.max(height, component.height)
  }
  componentSet.resize(
    Math.max(1, x - (componentSet.children.length > 0 ? CONTROL_VARIANT_GAP : 0)),
    Math.max(1, height)
  )
}

export function reflowAppliedControlComponentSets(
  applied: AppliedControl[]
): void {
  const sets = new Map<string, ControlComponentSetPort>()
  for (const item of applied) {
    if (item.componentSet) sets.set(item.componentSet.id, item.componentSet)
  }
  for (const componentSet of sets.values()) {
    reflowControlComponentSet(componentSet)
  }
}

type ComponentSnapshot = {
  component: ControlComponentPort
  values: Omit<ComponentSnapshotValues, 'children'>
  childrenBackup: unknown
  placementBackup: unknown
}

type ComponentSnapshotValues = {
  name: string
  description: string
  layoutMode: ControlComponentPort['layoutMode']
  primaryAxisSizingMode: ControlComponentPort['primaryAxisSizingMode']
  counterAxisSizingMode: ControlComponentPort['counterAxisSizingMode']
  primaryAxisAlignItems: ControlComponentPort['primaryAxisAlignItems']
  counterAxisAlignItems: ControlComponentPort['counterAxisAlignItems']
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
  effects: ControlEffect[]
  clipsContent?: boolean
  width: number
  height: number
  x: number
  y: number
  ownershipId: string
  children: Array<ControlComponentPort | ControlChildPort>
}

type ControlComponentSetSnapshot = {
  componentSet: ControlComponentSetPort
  name: string
  description: string
  width: number
  height: number
  ownershipId: string
  children: Array<{
    component: ControlComponentPort
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

function outlineEffect(source: ControlImportPlanEntry['source']): ControlEffect | null {
  const { outline, outlineWidth, outlineOffset } = source.appearance
  if (outline.a <= 0 || outlineWidth <= 0) return null
  return {
    type: 'DROP_SHADOW',
    color: { ...outline },
    offset: { x: 0, y: 0 },
    radius: 0,
    spread: Math.max(outlineWidth, outlineWidth + outlineOffset),
    visible: true,
    blendMode: 'NORMAL',
    showShadowBehindNode: false
  }
}

function componentLabel(
  source: ControlImportPlanEntry['source'],
  kind: ReturnType<typeof controlContentKind>
): string | null {
  if (kind === 'icon-only' || kind === 'empty') return null
  return source.sampleText?.value ?? null
}

type MeasuredControlSize = {
  width: number
  height: number
}

function measureChildren(
  children: Array<ControlComponentPort | ControlChildPort>,
  layoutMode: 'HORIZONTAL' | 'VERTICAL',
  itemSpacing: number
): MeasuredControlSize {
  if (children.length === 0) return { width: 0, height: 0 }
  const sizes = children.map(measureControlNode)
  const gaps = Math.max(0, sizes.length - 1) * itemSpacing
  if (layoutMode === 'VERTICAL') {
    return {
      width: Math.max(...sizes.map(size => size.width)),
      height: sizes.reduce((sum, size) => sum + size.height, 0) + gaps
    }
  }
  return {
    width: sizes.reduce((sum, size) => sum + size.width, 0) + gaps,
    height: Math.max(...sizes.map(size => size.height))
  }
}

function measureControlNode(
  node: ControlComponentPort | ControlChildPort
): MeasuredControlSize {
  if (node.type === 'FRAME' && node.children.length > 0) {
    if (
      node.primaryAxisSizingMode === 'FIXED' &&
      node.counterAxisSizingMode === 'FIXED'
    ) {
      return {
        width: Math.max(0, node.width),
        height: Math.max(0, node.height)
      }
    }
    const layoutMode = node.layoutMode === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL'
    return measureChildren(node.children, layoutMode, node.itemSpacing)
  }
  return {
    width: Math.max(0, node.width),
    height: Math.max(0, node.height)
  }
}

function measuredComponentSize(
  component: ControlComponentPort,
  entry: ControlImportPlanEntry
): MeasuredControlSize {
  const source = entry.source
  const content = measureChildren(
    component.children,
    component.layoutMode === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL',
    component.itemSpacing
  )
  const intrinsicWidth = Math.max(
    source.geometry.height,
    component.paddingLeft + content.width + component.paddingRight
  )
  const rawObservedMinimum = source.geometry.minWidth ?? 0
  const observedMinimum = source.layout?.widthBehavior === 'fill'
    ? Math.min(rawObservedMinimum, MAX_REUSABLE_FILL_WIDTH)
    : rawObservedMinimum
  return {
    width: Math.max(intrinsicWidth, observedMinimum),
    height: Math.max(
      source.geometry.height,
      component.paddingTop + content.height + component.paddingBottom
    )
  }
}

function svgColor(value: ColorValue): string {
  const byte = (channel: number): string =>
    Math.round(Math.max(0, Math.min(1, channel)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(value.r)}${byte(value.g)}${byte(value.b)}`
}

function colorizedControlSvg(svg: string, foreground: ColorValue): string {
  const color = svgColor(foreground)
  const resolved = svg.replace(/currentcolor/gi, color)
  const opening = resolved.match(/<svg\b[^>]*>/i)?.[0]
  if (!opening || /\bfill\s*=/i.test(opening)) return resolved
  return resolved.replace(/<svg\b/i, `<svg fill="${color}"`)
}

function svgViewBox(svg: string): { width: number; height: number } | null {
  const raw = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(svg)?.[1]
  const values = raw?.trim().split(/[\s,]+/).map(Number) ?? []
  return values.length === 4 &&
    values.every(Number.isFinite) &&
    values[2]! > 0 &&
    values[3]! > 0
    ? { width: values[2]!, height: values[3]! }
    : null
}

function containSize(
  source: { width: number; height: number },
  slot: { width: number; height: number }
): { width: number; height: number } {
  const scale = Math.min(
    slot.width / source.width,
    slot.height / source.height
  )
  return {
    width: source.width * scale,
    height: source.height * scale
  }
}

function hasDifferentAspectRatio(
  source: { width: number; height: number },
  slot: { width: number; height: number }
): boolean {
  return Math.abs(
    source.width / source.height - slot.width / slot.height
  ) > 0.001
}

function removeCreatedChild(child: ControlChildPort): void {
  try { child.remove?.() } catch { /* retain the original configuration error */ }
}

function appendCreatedChild(
  parent: ControlComponentPort | ControlFramePort,
  child: ControlChildPort
): void {
  try {
    parent.appendChild(child)
  } catch (error) {
    removeCreatedChild(child)
    throw error
  }
}

function appendAspectFitUiVector(
  component: ControlComponentPort | ControlFramePort,
  repository: ControlRepository,
  slot: NonNullable<ControlImportPlanEntry['source']['slots']['leading']>,
  foreground: ColorValue,
  position: 'Leading' | 'Trailing',
  viewBox: { width: number; height: number }
): boolean {
  if (!repository.createFrame || !repository.createNodeFromSvg) return false
  const svg = slot.vectorSvg
    ? colorizedControlSvg(slot.vectorSvg, foreground)
    : null
  if (!svg) return false
  const vector = repository.createNodeFromSvg(svg)
  let container: ControlFramePort | null = null
  try {
    const fitted = containSize(viewBox, slot)
    vector.name = `${position} UI icon`
    vector.resize(fitted.width, fitted.height)

    container = repository.createFrame()
    container.name = `${position} UI icon slot`
    container.layoutMode = 'HORIZONTAL'
    container.primaryAxisSizingMode = 'FIXED'
    container.counterAxisSizingMode = 'FIXED'
    container.primaryAxisAlignItems = 'CENTER'
    container.counterAxisAlignItems = 'CENTER'
    container.itemSpacing = 0
    container.fills = []
    container.strokes = []
    container.resize(slot.width, slot.height)
    appendCreatedChild(container, vector)
    appendCreatedChild(component, container)
    return true
  } catch (error) {
    if (container) removeCreatedChild(container)
    removeCreatedChild(vector)
    throw error
  }
}

function appendUiVector(
  component: ControlComponentPort | ControlFramePort,
  repository: ControlRepository,
  slot: NonNullable<ControlImportPlanEntry['source']['slots']['leading']>,
  foreground: ColorValue,
  position: 'Leading' | 'Trailing' = 'Leading'
): boolean {
  if (
    slot.assetType !== 'ui-icon' ||
    !slot.vectorSvg
  ) return false
  const viewBox = svgViewBox(slot.vectorSvg)
  if (
    viewBox &&
    hasDifferentAspectRatio(viewBox, slot) &&
    appendAspectFitUiVector(
      component,
      repository,
      slot,
      foreground,
      position,
      viewBox
    )
  ) return true
  if (repository.createIconInstance) {
    const instance = repository.createIconInstance(slot.vectorSvg, foreground)
    if (!instance) {
      throw new Error(
        'Unable to resolve shared Icon Component for confirmed UI icon slot.'
      )
    }
    try {
      instance.name = `${position} UI icon instance`
      instance.resize(slot.width, slot.height)
      appendCreatedChild(component, instance)
      return true
    } catch (error) {
      removeCreatedChild(instance)
      throw error
    }
  }
  if (!repository.createNodeFromSvg) return false
  const svg = colorizedControlSvg(slot.vectorSvg, foreground)
  const vector = repository.createNodeFromSvg(svg)
  try {
    vector.name = `${position} UI icon`
    vector.resize(slot.width, slot.height)
    appendCreatedChild(component, vector)
    return true
  } catch (error) {
    removeCreatedChild(vector)
    throw error
  }
}

function excludedAssetSlotName(
  slot: ControlImportPlanEntry['source']['slots']['leading']
): string {
  return `Excluded asset slot · ${slot?.assetType ?? 'unknown'}`
}

function appendGraphicSlot(
  component: ControlComponentPort | ControlFramePort,
  repository: ControlRepository,
  size: { width: number; height: number } | null,
  name: string,
  _foreground: ColorValue
): void {
  if (!size) return
  const rectangle = repository.createRectangle()
  try {
    rectangle.name = name
    rectangle.resize(size.width, size.height)
    rectangle.fills = []
    rectangle.strokes = []
    rectangle.dashPattern = []
    appendCreatedChild(component, rectangle)
  } catch (error) {
    removeCreatedChild(rectangle)
    throw error
  }
}

function appendSingularSlot(
  component: ControlComponentPort | ControlFramePort,
  repository: ControlRepository,
  slot: NonNullable<ControlImportPlanEntry['source']['slots']['leading']>,
  foreground: ColorValue,
  position: 'Leading' | 'Trailing'
): boolean {
  const surface = slot.surface
  if (!surface) {
    return appendUiVector(component, repository, slot, foreground, position)
  }
  const surfaceFrame = repository.createFrame?.()
  if (!surfaceFrame) {
    return appendUiVector(component, repository, slot, foreground, position)
  }
  try {
    surfaceFrame.name = `${position} action surface`
    surfaceFrame.layoutMode = 'HORIZONTAL'
    surfaceFrame.primaryAxisSizingMode = 'FIXED'
    surfaceFrame.counterAxisSizingMode = 'FIXED'
    surfaceFrame.primaryAxisAlignItems = 'CENTER'
    surfaceFrame.counterAxisAlignItems = 'CENTER'
    surfaceFrame.itemSpacing = 0
    surfaceFrame.resize(surface.width, surface.height)
    surfaceFrame.fills = paint(surface.background)
    surfaceFrame.strokes = surface.borderWidth > 0
      ? paint(surface.border)
      : []
    surfaceFrame.strokeWeight = surface.borderWidth
    surfaceFrame.topLeftRadius = surface.radii.topLeft
    surfaceFrame.topRightRadius = surface.radii.topRight
    surfaceFrame.bottomRightRadius = surface.radii.bottomRight
    surfaceFrame.bottomLeftRadius = surface.radii.bottomLeft
    if (
      surface.radii.topLeft === surface.radii.topRight &&
      surface.radii.topLeft === surface.radii.bottomRight &&
      surface.radii.topLeft === surface.radii.bottomLeft
    ) {
      surfaceFrame.cornerRadius = surface.radii.topLeft
    }
    surfaceFrame.clipsContent = true

    const surfaceForeground = surface.foreground.a > 0
      ? surface.foreground
      : foreground
    if (!appendUiVector(
      surfaceFrame,
      repository,
      slot,
      surfaceForeground,
      position
    )) {
      appendGraphicSlot(
        surfaceFrame,
        repository,
        slot,
        excludedAssetSlotName(slot),
        surfaceForeground
      )
    }
    appendCreatedChild(component, surfaceFrame)
    return true
  } catch (error) {
    removeCreatedChild(surfaceFrame)
    throw error
  }
}

function createHorizontalFrame(
  repository: ControlRepository,
  name: string,
  itemSpacing: number
): ControlFramePort | null {
  const frame = repository.createFrame?.()
  if (!frame) return null
  try {
    frame.name = name
    frame.layoutMode = 'HORIZONTAL'
    frame.primaryAxisSizingMode = 'AUTO'
    frame.counterAxisSizingMode = 'AUTO'
    frame.primaryAxisAlignItems = 'MIN'
    frame.counterAxisAlignItems = 'CENTER'
    frame.itemSpacing = itemSpacing
    frame.fills = []
    frame.strokes = []
    return frame
  } catch (error) {
    removeCreatedChild(frame)
    throw error
  }
}

function appendActionGroup(
  component: ControlComponentPort,
  repository: ControlRepository,
  slots: NonNullable<ControlImportPlanEntry['source']['slotGroups']>['leading'],
  foreground: ColorValue,
  name: 'Leading actions' | 'Trailing actions'
): void {
  const appendActionSlot = (
    parent: ControlComponentPort | ControlFramePort,
    slot: (typeof slots)[number]
  ): void => {
    const position = name === 'Leading actions' ? 'Leading' : 'Trailing'
    if (!appendSingularSlot(parent, repository, slot, foreground, position)) {
      appendGraphicSlot(
        parent,
        repository,
        slot,
        excludedAssetSlotName(slot),
        foreground
      )
    }
  }

  const group = createHorizontalFrame(repository, name, 4)
  if (!group) {
    for (const slot of slots) {
      appendActionSlot(component, slot)
    }
    return
  }
  try {
    for (const slot of slots) {
      appendActionSlot(group, slot)
    }
    appendCreatedChild(component, group)
  } catch (error) {
    removeCreatedChild(group)
    throw error
  }
}

async function appendCompoundInputContent(
  component: ControlComponentPort,
  entry: ControlImportPlanEntry,
  repository: ControlRepository,
  missingFonts: string[]
): Promise<void> {
  const source = entry.source
  const groups = source.slotGroups
  if (!groups) return

  appendActionGroup(
    component,
    repository,
    groups.leading,
    source.appearance.foreground,
    'Leading actions'
  )

  const inputRegion = createHorizontalFrame(repository, 'Input region', 0)
  if (inputRegion) {
    try {
      inputRegion.layoutGrow = 1
      if (entry.fontName && source.sampleText) {
        appendCreatedChild(inputRegion, await createLabel(
          repository,
          entry.fontName,
          'Placeholder',
          source.sampleText.value,
          source.typography,
          source.appearance.foreground
        ))
      } else if (source.sampleText) {
        missingFonts.push(source.typography.fontFamilyStack[0] ?? 'unknown')
      }
      appendCreatedChild(component, inputRegion)
    } catch (error) {
      inputRegion.remove?.()
      throw error
    }
  }

  appendActionGroup(
    component,
    repository,
    groups.trailing,
    source.appearance.foreground,
    'Trailing actions'
  )
}

async function createLabel(
  repository: ControlRepository,
  fontName: AvailableFontName,
  name: string,
  value: string,
  typography: ControlImportPlanEntry['source']['typography'],
  foreground: ColorValue
): Promise<ControlTextPort> {
  await repository.loadFont(fontName)
  const text = repository.createText()
  try {
    text.name = name
    text.fontName = fontName
    text.textAutoResize = 'WIDTH_AND_HEIGHT'
    text.characters = value
    text.fontSize = typography.fontSizePx
    if (typography.lineHeightPx !== null) {
      text.lineHeight = { value: typography.lineHeightPx, unit: 'PIXELS' }
    }
    text.letterSpacing = {
      value: typography.letterSpacingPx,
      unit: 'PIXELS'
    }
    text.fills = paint(foreground)
    return text
  } catch (error) {
    text.remove?.()
    throw error
  }
}

async function appendCompoundContent(
  component: ControlComponentPort,
  entry: ControlImportPlanEntry,
  repository: ControlRepository,
  missingFonts: string[]
): Promise<void> {
  const source = entry.source
  const hasSafeText = Boolean(source.sampleText || source.supportingText)
  const leading = source.slots.leading
  if (
    !leading ||
    !appendSingularSlot(
      component,
      repository,
      leading,
      source.appearance.foreground,
      'Leading'
    )
  ) {
    appendGraphicSlot(
      component,
      repository,
      leading,
      excludedAssetSlotName(leading),
      source.appearance.foreground
    )
  }
  if (!entry.fontName || !repository.createFrame || !hasSafeText) {
    if (!entry.fontName && hasSafeText) {
      missingFonts.push(source.typography.fontFamilyStack[0] ?? 'unknown')
    }
  } else {
    const stack = repository.createFrame()
    try {
      stack.name = source.content?.kind === 'compound-row' &&
        source.content.textFlow === 'inline'
        ? 'Text group'
        : 'Text stack'
      stack.layoutMode = source.content?.kind === 'compound-row' &&
        source.content.textFlow === 'inline'
        ? 'HORIZONTAL'
        : 'VERTICAL'
      stack.primaryAxisSizingMode = 'AUTO'
      stack.counterAxisSizingMode = 'AUTO'
      stack.primaryAxisAlignItems = 'MIN'
      stack.counterAxisAlignItems =
        stack.layoutMode === 'HORIZONTAL' ? 'BASELINE' : 'MIN'
      stack.itemSpacing = source.content?.kind === 'compound-row'
        ? (
            Number.isFinite(source.content.textGap) &&
            source.content.textGap >= 0 &&
            source.content.textGap <= 64
              ? source.content.textGap
              : 8
          )
        : 0
      stack.fills = []
      stack.strokes = []
      stack.layoutGrow = 1
      if (source.sampleText) {
        appendCreatedChild(stack, await createLabel(
          repository,
          entry.fontName,
          'Primary label',
          source.sampleText.value,
          source.typography,
          source.appearance.foreground
        ))
      }
      if (source.supportingText && source.supportingStyle) {
        appendCreatedChild(stack, await createLabel(
          repository,
          entry.fontName,
          'Supporting label',
          source.supportingText.value,
          source.supportingStyle.typography,
          source.supportingStyle.foreground
        ))
      }
      if (stack.children.length > 0) appendCreatedChild(component, stack)
      else stack.remove?.()
    } catch (error) {
      stack.remove?.()
      throw error
    }
  }

  const trailing = source.slots.trailing
  if (
    !trailing ||
    !appendSingularSlot(
      component,
      repository,
      trailing,
      source.appearance.foreground,
      'Trailing'
    )
  ) {
    appendGraphicSlot(
      component,
      repository,
      trailing,
      excludedAssetSlotName(trailing),
      source.appearance.foreground
    )
  }
}

async function configureComponent(
  component: ControlComponentPort,
  entry: ControlImportPlanEntry,
  repository: ControlRepository,
  missingFonts: string[]
): Promise<void> {
  const source = entry.source
  const contentKind = controlContentKind(source)
  const label = componentLabel(source, contentKind)
  component.name = entry.targetName
  component.description = [
    `UI-Anatomist · ${source.family} · ${source.state} · ${contentKind}`,
    `${source.occurrences} occurrences · ${source.stateOccurrences} states`,
    ...(label
      ? ['Scanned safe sample label']
      : [])
  ].join('\n')
  component.layoutMode = source.family === 'textarea' ? 'VERTICAL' : 'HORIZONTAL'
  const isFillWidth = source.layout?.widthBehavior === 'fill'
  component.primaryAxisSizingMode = component.layoutMode === 'VERTICAL'
    ? 'FIXED'
    : isFillWidth ? 'FIXED' : 'AUTO'
  component.counterAxisSizingMode = component.layoutMode === 'VERTICAL'
    ? isFillWidth ? 'FIXED' : 'AUTO'
    : 'FIXED'
  const scannedAlignment = source.layout?.contentAlignment
  component.primaryAxisAlignItems = scannedAlignment
    ? primaryAxisAlignment(scannedAlignment)
    : source.family === 'button' && (
        contentKind === 'icon-only' ||
        source.appearance.background.a > 0 ||
        (
          source.geometry.borderWidth > 0 &&
          source.appearance.border.a > 0
        ) ||
        (
          source.appearance.outlineWidth > 0 &&
          source.appearance.outline.a > 0
        ) ||
        source.appearance.shadows.some(layer => layer.color.a > 0)
      )
      ? 'CENTER'
      : 'MIN'
  component.counterAxisAlignItems = 'CENTER'
  component.paddingTop = source.geometry.padding.top
  component.paddingRight = source.geometry.padding.right
  component.paddingBottom = source.geometry.padding.bottom
  component.paddingLeft = source.geometry.padding.left
  component.itemSpacing = source.geometry.gap
  component.cornerRadius = source.geometry.radius
  component.fills = paint(source.appearance.background)
  component.strokes = paint(source.appearance.border)
  component.strokeWeight = source.geometry.borderWidth
  applyComponentStrokeWeights(
    component,
    source.geometry.borderWidths,
    source.geometry.borderWidth
  )
  const ring = outlineEffect(source)
  component.effects = [
    ...source.appearance.shadows.map(effect),
    ...(ring ? [ring] : [])
  ]
  writeControlOwnership(component, CONTROL_NODE_OWNERSHIP_KEY, entry.ownershipId)
  repository.clearChildren?.(component)

  if (contentKind === 'compound-row') {
    await appendCompoundContent(
      component,
      entry,
      repository,
      missingFonts
    )
  } else if (contentKind === 'compound-input') {
    await appendCompoundInputContent(
      component,
      entry,
      repository,
      missingFonts
    )
  } else {
    const leadingImported = source.slots.leading
      ? appendSingularSlot(
          component,
          repository,
          source.slots.leading,
          source.appearance.foreground,
          'Leading'
        )
      : false
    appendGraphicSlot(
      component,
      repository,
      leadingImported ? null : source.slots.leading,
      excludedAssetSlotName(source.slots.leading),
      source.appearance.foreground
    )
    if (label && entry.fontName) {
      appendCreatedChild(component, await createLabel(
        repository,
        entry.fontName,
        'Label',
        label,
        source.typography,
        source.appearance.foreground
      ))
    } else if (label) {
      missingFonts.push(source.typography.fontFamilyStack[0] ?? 'unknown')
    }
    appendGraphicSlot(
      component,
      repository,
      source.slots.trailing && appendSingularSlot(
        component,
        repository,
        source.slots.trailing,
        source.appearance.foreground,
        'Trailing'
      ) ? null : source.slots.trailing,
      excludedAssetSlotName(source.slots.trailing),
      source.appearance.foreground
    )
  }

  const measured = measuredComponentSize(component, entry)
  component.resize(measured.width, measured.height)
  component.clipsContent = false
}

function snapshot(
  component: ControlComponentPort,
  repository: ControlRepository
): ComponentSnapshot {
  if (
    !repository.backupChildren ||
    !repository.restoreChildren ||
    !repository.discardChildrenBackup
  ) {
    throw new Error('Control repository cannot safely update existing children')
  }
  const values: ComponentSnapshot['values'] = {
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
    effects: [...component.effects],
    clipsContent: component.clipsContent,
    width: component.width,
    height: component.height,
    x: component.x,
    y: component.y,
    ownershipId: readControlOwnership(component, CONTROL_NODE_OWNERSHIP_KEY)
  }
  const placementBackup = repository.backupPlacement?.(component)
  const childrenBackup = repository.backupChildren(component)
  return {
    component,
    values,
    childrenBackup,
    placementBackup
  }
}

function restore(
  snapshotValue: ComponentSnapshot,
  repository: ControlRepository
): void {
  const { component, values } = snapshotValue
  repository.restoreChildren?.(component, snapshotValue.childrenBackup)
  component.name = values.name
  component.description = values.description
  component.layoutMode = values.layoutMode
  component.primaryAxisSizingMode = values.primaryAxisSizingMode
  component.counterAxisSizingMode = values.counterAxisSizingMode
  component.primaryAxisAlignItems = values.primaryAxisAlignItems
  component.counterAxisAlignItems = values.counterAxisAlignItems
  component.paddingTop = values.paddingTop
  component.paddingRight = values.paddingRight
  component.paddingBottom = values.paddingBottom
  component.paddingLeft = values.paddingLeft
  component.itemSpacing = values.itemSpacing
  component.cornerRadius = values.cornerRadius
  component.fills = values.fills
  component.strokes = values.strokes
  component.strokeWeight = values.strokeWeight
  applyComponentStrokeWeights(component, values.strokeWeights)
  component.effects = values.effects
  component.clipsContent = values.clipsContent ?? false
  component.resize(values.width, values.height)
  if (snapshotValue.placementBackup !== undefined && repository.restorePlacement) {
    repository.restorePlacement(component, snapshotValue.placementBackup)
  } else {
    component.x = values.x
    component.y = values.y
  }
  writeControlOwnership(component, CONTROL_NODE_OWNERSHIP_KEY, values.ownershipId)
}

function snapshotComponentSet(
  componentSet: ControlComponentSetPort
): ControlComponentSetSnapshot {
  return {
    componentSet,
    name: componentSet.name,
    description: componentSet.description,
    width: componentSet.width,
    height: componentSet.height,
    ownershipId: readControlOwnership(
      componentSet,
      CONTROL_GROUP_OWNERSHIP_KEY
    ),
    children: componentSet.children.map(component => ({
      component,
      x: component.x,
      y: component.y
    }))
  }
}

function restoreComponentSet(
  value: ControlComponentSetSnapshot,
  repository: ControlRepository
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
  writeControlOwnership(
    componentSet,
    CONTROL_GROUP_OWNERSHIP_KEY,
    value.ownershipId
  )
}

async function componentFor(
  entry: ControlImportPlanEntry,
  repository: ControlRepository,
  result: ApplyControlResult,
  snapshots: ComponentSnapshot[]
): Promise<ControlComponentPort> {
  if (entry.action === 'update' && entry.existingComponentId) {
    const existing = await repository.getNodeById(entry.existingComponentId)
    if (existing?.type === 'COMPONENT') {
      snapshots.push(snapshot(existing, repository))
      await configureComponent(existing, entry, repository, result.missingFonts)
      result.updated.push(existing)
      return existing
    }
  }
  const component = repository.createComponent()
  try {
    await configureComponent(component, entry, repository, result.missingFonts)
  } catch (error) {
    component.remove()
    throw error
  }
  result.created.push(component)
  return component
}

export async function applyControlImportPlan(
  plan: ControlImportPlan,
  repository: ControlRepository
): Promise<ApplyControlResult> {
  const result: ApplyControlResult = {
    created: [],
    updated: [],
    componentSets: [],
    applied: [],
    conflicts: [],
    missingFonts: []
  }
  const snapshots: ComponentSnapshot[] = []
  const componentSetSnapshots: ControlComponentSetSnapshot[] = []
  const createdComponentSets: ControlComponentSetPort[] = []

  try {
    for (const group of plan.groups) {
      if (group.action === 'skip_conflict') {
        result.conflicts.push(group.conflictName ?? group.targetName)
        continue
      }
      const components: ControlComponentPort[] = []
      for (const entry of group.entries) {
        components.push(await componentFor(entry, repository, result, snapshots))
      }

      let componentSet: ControlComponentSetPort | null = null
      if (group.kind === 'component_set') {
        const existing = group.existingGroupNodeId
          ? await repository.getNodeById(group.existingGroupNodeId)
          : null
        if (existing?.type === 'COMPONENT_SET') {
          if (!repository.appendToComponentSet) {
            throw new Error('Control repository cannot safely restore a Component Set')
          }
          componentSet = existing
          componentSetSnapshots.push(snapshotComponentSet(componentSet))
          for (const component of components) {
            if (!componentSet.children.includes(component)) {
              repository.appendToComponentSet?.(componentSet, component)
            }
          }
        } else {
          repository.prepareForVariantCombine?.(components)
          componentSet = repository.combineAsVariants(components)
          createdComponentSets.push(componentSet)
        }
        componentSet.name = group.targetName
        componentSet.description = `UI-Anatomist · ${group.entries.length} observed states`
        writeControlOwnership(
          componentSet,
          CONTROL_GROUP_OWNERSHIP_KEY,
          group.groupOwnershipId
        )
        reflowControlComponentSet(componentSet)
        result.componentSets.push(componentSet)
      }
      group.entries.forEach((entry, index) => {
        const component = components[index]
        if (component) result.applied.push({ group, entry, component, componentSet })
      })
    }
  } catch (error) {
    const restoredSnapshots: ComponentSnapshot[] = []
    for (const node of result.created.reverse()) {
      try { node.remove() } catch { /* outer transaction remains the final rollback boundary */ }
    }
    for (const previous of [...snapshots].reverse()) {
      try {
        restore(previous, repository)
        restoredSnapshots.push(previous)
      } catch { /* preserve this backup and restore remaining nodes */ }
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
  result.missingFonts = [...new Set(result.missingFonts)]
  return result
}
