export type TypographySignature = {
  fontFamilyStack: string[]
  fontStyle: string
  fontSizePx: number
  fontWeight: number
  lineHeightPx: number | null
  letterSpacingPx: number
}

export type BorderRadiusSignature =
  | { kind: 'px' | 'percent'; value: number }
  | { kind: 'full'; value: null }

export type ShadowSignature = {
  layers: Array<{
    kind: 'outer' | 'inner'
    offsetX: number
    offsetY: number
    blur: number
    spread: number
    color: { r: number; g: number; b: number; a: number }
  }>
}

export type ColorValueSignature = { r: number; g: number; b: number; a: number }
export type SpacingSignature = { value: number }
export type ControlGeometrySignature = {
  height: number
  minWidth: number | null
  padding: { top: number; right: number; bottom: number; left: number }
  gap: number
  radius: number
  borderWidth: number
  borderWidths?: { top: number; right: number; bottom: number; left: number }
}
export type ControlAppearanceSignature = {
  background: ColorValueSignature
  foreground: ColorValueSignature
  border: ColorValueSignature
  outline: ColorValueSignature
  outlineWidth: number
  outlineOffset: number
  shadows: ShadowSignature['layers']
}
export type ControlSlotSignature = {
  width: number
  height: number
  assetType?: 'ui-icon' | 'brand-logo' | 'unknown'
  vectorSvg?: string
  surface?: {
    width: number
    height: number
    background: ColorValueSignature
    foreground: ColorValueSignature
    border: ColorValueSignature
    borderWidth: number
    radii: {
      topLeft: number
      topRight: number
      bottomRight: number
      bottomLeft: number
    }
  }
} | null
export type ControlSignature = {
  family: string
  state: string
  intent: string
  size: string
  geometry: ControlGeometrySignature
  appearance: ControlAppearanceSignature
  typography: TypographySignature
  slots: { leading: ControlSlotSignature; trailing: ControlSlotSignature }
  slotGroups?: {
    leading: Exclude<ControlSlotSignature, null>[]
    trailing: Exclude<ControlSlotSignature, null>[]
  }
  content?:
    | {
        kind: 'icon-only' | 'text-only' | 'icon-leading' | 'icon-trailing' |
          'icon-both' | 'empty'
      }
    | {
        kind: 'compound-row'
        trailing: 'none' | 'action'
        textFlow: 'inline' | 'stacked'
        textGap: number
      }
    | {
        kind: 'compound-input'
      }
  layout?: {
    widthBehavior: 'hug' | 'fill'
    contentAlignment?: 'start' | 'center' | 'end' | 'space-between'
  }
  supportingStyle?: {
    foreground: ColorValueSignature
    typography: TypographySignature
  }
}
export type ControlGroupSignature = ControlSignature
export type ControlLogicalSignature = {
  pageScope: string
  structuralLocator: string
}
export type ControlInstanceSignature = {
  templateId: string
  logicalControlId: string
  sampleText: string | null
  supportingText: string | null
  leadingIconId: string | null
  trailingIconId: string | null
}
export type StaticTextRegionTemplateSignature = {
  geometry: {
    width: number
    height: number
    padding: { top: number; right: number; bottom: number; left: number }
    gap: number
    radius: number
    borderWidth: number
    borderWidths?: { top: number; right: number; bottom: number; left: number }
  }
  appearance: ControlAppearanceSignature
}
export type StaticTextRegionInstanceSignature = {
  templateId: string
  value: string | null
}
export type StaticTextRegionReferenceSignature = {
  templateId: string
  instanceId: string
  placement: { x: number; y: number; width: number; height: number }
}
export type CompositeSignature = {
  kind: string
  state: string
  logicalCompositeId: string
  geometry: {
    width: number
    height: number
    padding: { top: number; right: number; bottom: number; left: number }
    gap: number
    radius: number
    borderWidth: number
    borderWidths?: { top: number; right: number; bottom: number; left: number }
  }
  appearance: ControlAppearanceSignature
  layout: {
    direction: string
    align: string
    justify: string
    wrap: boolean
    widthBehavior: string
  }
  childTemplateIds: string[]
  childInstanceIds: string[]
  childPlacements?: Array<{
    x: number
    y: number
    width: number
    height: number
  } | null>
  staticTextRegions?: StaticTextRegionReferenceSignature[]
}
export type IconSignature = { vectorSvg: string }

export type SemanticColorSignature = {
  name: string
  group: string
  value: ColorValueSignature
}

export type InteractiveColorSignature = {
  intent: string
  state: string
  usage: string
  value: ColorValueSignature
}

function normalizeFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

export async function stableTypographyId(value: TypographySignature): Promise<string> {
  const canonical = JSON.stringify({
    fontFamilyStack: value.fontFamilyStack.map(normalizeFamily),
    fontStyle: value.fontStyle.toLowerCase(),
    fontSizePx: value.fontSizePx,
    fontWeight: value.fontWeight,
    lineHeightPx: value.lineHeightPx,
    letterSpacingPx: value.letterSpacingPx
  })
  return stableHash(canonical)
}

async function stableHash(canonical: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hash}`
}

export async function stableBorderRadiusId(value: BorderRadiusSignature): Promise<string> {
  return stableHash(JSON.stringify({ kind: value.kind, value: value.value }))
}

export async function stableSpacingId(value: SpacingSignature): Promise<string> {
  return stableHash(JSON.stringify({ value: value.value }))
}

export async function stableShadowId(value: ShadowSignature): Promise<string> {
  const layers = value.layers.map(layer => ({
    kind: layer.kind,
    offsetX: layer.offsetX,
    offsetY: layer.offsetY,
    blur: layer.blur,
    spread: layer.spread,
    color: {
      r: layer.color.r,
      g: layer.color.g,
      b: layer.color.b,
      a: layer.color.a
    }
  }))
  return stableHash(JSON.stringify({ layers }))
}

function normalizedColor(value: ColorValueSignature): ColorValueSignature {
  return { r: value.r, g: value.g, b: value.b, a: value.a }
}

function normalizeTokenName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function stablePrimitiveColorId(value: ColorValueSignature): Promise<string> {
  return stableHash(JSON.stringify({ value: normalizedColor(value) }))
}

export async function stableSemanticColorId(value: SemanticColorSignature): Promise<string> {
  return stableHash(JSON.stringify({
    name: normalizeTokenName(value.name),
    group: value.group.toLowerCase(),
    value: normalizedColor(value.value)
  }))
}

export async function stableInteractiveColorId(value: InteractiveColorSignature): Promise<string> {
  return stableHash(JSON.stringify({
    intent: value.intent.toLowerCase(),
    state: value.state.toLowerCase(),
    usage: value.usage.toLowerCase(),
    value: normalizedColor(value.value)
  }))
}

function normalizedTypography(value: TypographySignature): TypographySignature {
  return {
    fontFamilyStack: value.fontFamilyStack.map(normalizeFamily),
    fontStyle: value.fontStyle.toLowerCase(),
    fontSizePx: value.fontSizePx,
    fontWeight: value.fontWeight,
    lineHeightPx: value.lineHeightPx,
    letterSpacingPx: value.letterSpacingPx
  }
}

function normalizedControlStructure(value: ControlSignature) {
  const normalizedSlot = (slot: ControlSlotSignature) => slot
    ? {
        width: slot.width,
        height: slot.height,
        surface: slot.surface
          ? {
              width: slot.surface.width,
              height: slot.surface.height,
              borderWidth: slot.surface.borderWidth,
              radii: slot.surface.radii
            }
          : null
      }
    : null
  return {
    family: value.family.toLowerCase(),
    intent: value.intent.toLowerCase(),
    size: value.size.toLowerCase(),
    geometry: value.geometry,
    typography: normalizedTypography(value.typography),
    slots: {
      leading: normalizedSlot(value.slots.leading),
      trailing: normalizedSlot(value.slots.trailing)
    },
    slotGroups: value.slotGroups
      ? {
          leading: value.slotGroups.leading.map(normalizedSlot),
          trailing: value.slotGroups.trailing.map(normalizedSlot)
        }
      : null,
    content: value.content ?? {
      kind: value.slots.leading || value.slots.trailing ? 'icon-only' : 'text-only'
    },
    layout: value.layout ?? { widthBehavior: 'hug' },
    supportingStyle: value.supportingStyle
      ? {
          foreground: normalizedColor(value.supportingStyle.foreground),
          typography: normalizedTypography(value.supportingStyle.typography)
        }
      : null
  }
}

export async function stableControlId(value: ControlSignature): Promise<string> {
  return stableHash(JSON.stringify({
    ...normalizedControlStructure(value),
    state: value.state.toLowerCase(),
    appearance: {
      background: normalizedColor(value.appearance.background),
      foreground: normalizedColor(value.appearance.foreground),
      border: normalizedColor(value.appearance.border),
      outline: normalizedColor(value.appearance.outline),
      outlineWidth: value.appearance.outlineWidth,
      outlineOffset: value.appearance.outlineOffset,
      shadows: value.appearance.shadows
    }
  }))
}

export async function stableControlGroupId(value: ControlGroupSignature): Promise<string> {
  return stableHash(JSON.stringify(normalizedControlStructure(value)))
}

export async function stableControlTemplateId(value: ControlGroupSignature): Promise<string> {
  return stableControlGroupId(value)
}

export async function stableControlLogicalId(value: ControlLogicalSignature): Promise<string> {
  return stableHash(JSON.stringify({
    pageScope: value.pageScope.trim().toLowerCase(),
    structuralLocator: value.structuralLocator.trim().toLowerCase()
  }))
}

function normalizedSafeInstanceText(value: string | null): string | null {
  return value === null
    ? null
    : value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export async function stableControlInstanceId(value: ControlInstanceSignature): Promise<string> {
  return stableHash(JSON.stringify({
    templateId: value.templateId.trim().toLowerCase(),
    logicalControlId: value.logicalControlId.trim().toLowerCase(),
    sampleText: normalizedSafeInstanceText(value.sampleText),
    supportingText: normalizedSafeInstanceText(value.supportingText),
    leadingIconId: value.leadingIconId?.trim().toLowerCase() ?? null,
    trailingIconId: value.trailingIconId?.trim().toLowerCase() ?? null
  }))
}

function normalizedCompositeTemplate(value: CompositeSignature) {
  const childPlacements = value.childPlacements?.map(placement => placement
    ? {
        x: Math.round(placement.x * 2) / 2,
        y: Math.round(placement.y * 2) / 2,
        width: Math.round(placement.width * 2) / 2,
        height: Math.round(placement.height * 2) / 2
      }
    : null
  )
  return {
    kind: value.kind.trim().toLowerCase(),
    geometry: value.geometry,
    layout: {
      direction: value.layout.direction.trim().toLowerCase(),
      align: value.layout.align.trim().toLowerCase(),
      justify: value.layout.justify.trim().toLowerCase(),
      wrap: value.layout.wrap,
      widthBehavior: value.layout.widthBehavior.trim().toLowerCase()
    },
    childTemplateIds: value.childTemplateIds.map(id => id.trim().toLowerCase()),
    ...(childPlacements ? { childPlacements } : {}),
    ...(value.staticTextRegions
      ? {
          staticTextRegions: value.staticTextRegions.map(region => ({
            templateId: region.templateId.trim().toLowerCase(),
            placement: {
              x: Math.round(region.placement.x * 2) / 2,
              y: Math.round(region.placement.y * 2) / 2,
              width: Math.round(region.placement.width * 2) / 2,
              height: Math.round(region.placement.height * 2) / 2
            }
          }))
        }
      : {})
  }
}

export async function stableCompositeTemplateId(value: CompositeSignature): Promise<string> {
  return stableHash(JSON.stringify(normalizedCompositeTemplate(value)))
}

export async function stableCompositeLogicalId(value: ControlLogicalSignature): Promise<string> {
  return stableHash(JSON.stringify({
    kind: 'composite',
    pageScope: value.pageScope.trim().toLowerCase(),
    structuralLocator: value.structuralLocator.trim().toLowerCase()
  }))
}

export async function stableStaticTextRegionTemplateId(
  value: StaticTextRegionTemplateSignature
): Promise<string> {
  return stableHash(JSON.stringify({
    kind: 'static-text-region',
    geometry: value.geometry,
    appearance: {
      background: normalizedColor(value.appearance.background),
      foreground: normalizedColor(value.appearance.foreground),
      border: normalizedColor(value.appearance.border),
      outline: normalizedColor(value.appearance.outline),
      outlineWidth: value.appearance.outlineWidth,
      outlineOffset: value.appearance.outlineOffset,
      shadows: value.appearance.shadows
    }
  }))
}

export async function stableStaticTextRegionInstanceId(
  value: StaticTextRegionInstanceSignature
): Promise<string> {
  return stableHash(JSON.stringify({
    templateId: value.templateId.trim().toLowerCase(),
    value: normalizedSafeInstanceText(value.value)
  }))
}

export async function stableCompositeId(value: CompositeSignature): Promise<string> {
  return stableHash(JSON.stringify({
    ...normalizedCompositeTemplate(value),
    logicalCompositeId: value.logicalCompositeId.trim().toLowerCase(),
    childInstanceIds: value.childInstanceIds.map(id => id.trim().toLowerCase()),
    ...(value.staticTextRegions
      ? {
          staticTextRegionInstanceIds: value.staticTextRegions.map(region =>
            region.instanceId.trim().toLowerCase()
          )
        }
      : {}),
    state: value.state.trim().toLowerCase(),
    appearance: {
      background: normalizedColor(value.appearance.background),
      foreground: normalizedColor(value.appearance.foreground),
      border: normalizedColor(value.appearance.border),
      outline: normalizedColor(value.appearance.outline),
      outlineWidth: value.appearance.outlineWidth,
      outlineOffset: value.appearance.outlineOffset,
      shadows: value.appearance.shadows
    }
  }))
}

function normalizeSvgGeometry(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
}

export async function stableIconId(value: IconSignature): Promise<string> {
  return stableHash(JSON.stringify({
    vectorSvg: normalizeSvgGeometry(value.vectorSvg)
  }))
}
