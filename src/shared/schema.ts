import { z } from 'zod'
import {
  isSafeControlSampleTextValue,
  isSafeIconNameValue
} from './safe-evidence'

export {
  isSafeControlSampleTextValue,
  isSafeIconNameValue
} from './safe-evidence'

const StableIdSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const PositiveIntegerSchema = z.number().int().positive()
const NonnegativeIntegerSchema = z.number().int().nonnegative()

export const TypographyStyleSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  fontFamilyStack: z.array(z.string().min(1)).min(1),
  fontStyle: z.enum(['normal', 'italic', 'oblique']),
  fontSizePx: z.number().positive(),
  fontWeight: z.number().int().min(1).max(1000),
  lineHeightPx: z.number().positive().nullable(),
  letterSpacingPx: z.number(),
  role: z.enum(['heading', 'body', 'caption', 'footnote', 'control', 'unknown']),
  occurrences: PositiveIntegerSchema
}).strict()

export const BorderRadiusTokenSchema = z.discriminatedUnion('kind', [
  z.object({
    id: StableIdSchema,
    name: z.string().min(1),
    kind: z.literal('px'),
    value: z.number().positive(),
    occurrences: PositiveIntegerSchema
  }).strict(),
  z.object({
    id: StableIdSchema,
    name: z.string().min(1),
    kind: z.literal('percent'),
    value: z.number().positive().max(100),
    occurrences: PositiveIntegerSchema
  }).strict(),
  z.object({
    id: StableIdSchema,
    name: z.string().min(1),
    kind: z.literal('full'),
    value: z.null(),
    occurrences: PositiveIntegerSchema
  }).strict()
])

export const ShadowColorSchema = z.object({
  r: z.number().finite().min(0).max(1),
  g: z.number().finite().min(0).max(1),
  b: z.number().finite().min(0).max(1),
  a: z.number().finite().min(0).max(1)
}).strict()

export const ShadowLayerSchema = z.object({
  kind: z.enum(['outer', 'inner']),
  offsetX: z.number().finite(),
  offsetY: z.number().finite(),
  blur: z.number().finite().nonnegative(),
  spread: z.number().finite(),
  color: ShadowColorSchema
}).strict()

export const ShadowTokenSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  layers: z.array(ShadowLayerSchema).min(1),
  occurrences: PositiveIntegerSchema
}).strict()

export const ColorValueSchema = z.object({
  r: z.number().finite().min(0).max(1),
  g: z.number().finite().min(0).max(1),
  b: z.number().finite().min(0).max(1),
  a: z.number().finite().min(0).max(1)
}).strict()

export const ColorProvenanceSchema = z.enum(['observed', 'declared', 'inferred'])
const ConfirmedColorProvenanceSchema = z.enum(['observed', 'declared'])
const INFERRED_NEUTRAL_STEPS = new Set([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
export const ColorFamilySchema = z.enum([
  'neutral', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'other'
])

export const PrimitiveColorTokenSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  value: ColorValueSchema,
  family: ColorFamilySchema,
  step: z.number().int().min(0).max(1000).nullable(),
  provenance: ColorProvenanceSchema,
  occurrences: NonnegativeIntegerSchema
}).strict().superRefine((token, context) => {
  if (token.provenance === 'inferred') {
    if (
      token.family !== 'neutral' || token.occurrences !== 0 ||
      token.step === null || !INFERRED_NEUTRAL_STEPS.has(token.step)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inferred colors must be zero-occurrence standard neutral ramp steps'
      })
    }
  } else if (token.occurrences === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Observed and declared colors require at least one occurrence',
      path: ['occurrences']
    })
  }
})

export const SemanticColorGroupSchema = z.enum([
  'background', 'text', 'border', 'link', 'status', 'content', 'misc'
])

export const SemanticColorTokenSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  group: SemanticColorGroupSchema,
  value: ColorValueSchema,
  primitiveId: StableIdSchema,
  provenance: ConfirmedColorProvenanceSchema,
  occurrences: NonnegativeIntegerSchema
}).strict()

export const InteractiveColorIntentSchema = z.enum([
  'accent', 'danger', 'primary', 'secondary', 'tertiary', 'other'
])
export const InteractiveColorStateSchema = z.enum([
  'default', 'hover', 'focus', 'pressed', 'selected', 'disabled'
])
export const InteractiveColorUsageSchema = z.enum([
  'background', 'foreground', 'border', 'outline'
])

export const InteractiveColorTokenSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  intent: InteractiveColorIntentSchema,
  state: InteractiveColorStateSchema,
  usage: InteractiveColorUsageSchema,
  value: ColorValueSchema,
  primitiveId: StableIdSchema,
  provenance: ConfirmedColorProvenanceSchema,
  occurrences: NonnegativeIntegerSchema
}).strict()

export const ColorsSchema = z.object({
  primitives: z.array(PrimitiveColorTokenSchema),
  semantic: z.array(SemanticColorTokenSchema),
  interactive: z.array(InteractiveColorTokenSchema)
}).strict()

export const SpacingTokenSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  value: z.number().finite().positive(),
  occurrences: PositiveIntegerSchema,
  evidence: z.object({
    padding: NonnegativeIntegerSchema,
    gap: NonnegativeIntegerSchema,
    margin: NonnegativeIntegerSchema
  }).strict(),
  stateOccurrences: PositiveIntegerSchema
}).strict().superRefine((token, context) => {
  if (token.evidence.padding + token.evidence.gap + token.evidence.margin !== token.occurrences) {
    context.addIssue({
      code: 'custom',
      message: 'Spacing evidence must equal occurrences',
      path: ['evidence']
    })
  }
})

export const ControlFamilySchema = z.enum([
  'button', 'input', 'textarea', 'select', 'toggle', 'checkbox', 'radio'
])
export const ControlStateSchema = z.enum([
  'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
])
export const ControlIntentSchema = z.enum([
  'primary', 'secondary', 'tertiary', 'danger', 'neutral', 'other'
])
export const ControlSizeSchema = z.enum(['xs', 'sm', 'md', 'lg', 'xl', 'custom'])

const NonnegativeFiniteSchema = z.number().finite().nonnegative()

export const ControlGeometrySchema = z.object({
  height: z.number().finite().positive(),
  minWidth: NonnegativeFiniteSchema.nullable(),
  padding: z.object({
    top: NonnegativeFiniteSchema,
    right: NonnegativeFiniteSchema,
    bottom: NonnegativeFiniteSchema,
    left: NonnegativeFiniteSchema
  }).strict(),
  gap: NonnegativeFiniteSchema,
  radius: NonnegativeFiniteSchema,
  borderWidth: NonnegativeFiniteSchema,
  borderWidths: z.object({
    top: NonnegativeFiniteSchema,
    right: NonnegativeFiniteSchema,
    bottom: NonnegativeFiniteSchema,
    left: NonnegativeFiniteSchema
  }).strict().optional()
}).strict()

export const ControlAppearanceSchema = z.object({
  background: ColorValueSchema,
  foreground: ColorValueSchema,
  border: ColorValueSchema,
  outline: ColorValueSchema,
  outlineWidth: NonnegativeFiniteSchema.default(0),
  outlineOffset: z.number().finite().default(0),
  shadows: z.array(ShadowLayerSchema)
}).strict()

export const ControlTypographySchema = z.object({
  fontFamilyStack: z.array(z.string().min(1)).min(1),
  fontStyle: z.enum(['normal', 'italic', 'oblique']),
  fontSizePx: z.number().finite().positive(),
  fontWeight: z.number().int().min(1).max(1000),
  lineHeightPx: z.number().finite().positive().nullable(),
  letterSpacingPx: z.number().finite()
}).strict()

export const ControlSlotSurfaceSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  background: ColorValueSchema,
  foreground: ColorValueSchema,
  border: ColorValueSchema,
  borderWidth: NonnegativeFiniteSchema,
  radii: z.object({
    topLeft: NonnegativeFiniteSchema,
    topRight: NonnegativeFiniteSchema,
    bottomRight: NonnegativeFiniteSchema,
    bottomLeft: NonnegativeFiniteSchema
  }).strict()
}).strict()

export const ControlSlotSchema = z.object({
  width: NonnegativeFiniteSchema,
  height: NonnegativeFiniteSchema,
  assetType: z.enum(['ui-icon', 'brand-logo', 'unknown']).optional(),
  surface: ControlSlotSurfaceSchema.optional(),
  vectorSvg: z.string().max(4096).refine(value =>
    /^<svg\b/i.test(value.trim()) &&
    !/<(?:script|style|image|foreignObject)\b/i.test(value) &&
    !/\bon[a-z]+\s*=/i.test(value) &&
    !/\b(?:href|xlink:href)\s*=/i.test(value)
  ).optional()
}).strict().superRefine((value, context) => {
  if (value.vectorSvg && value.assetType !== 'ui-icon') {
    context.addIssue({
      code: 'custom',
      message: 'Only confirmed UI icons may include sanitized vector SVG'
    })
  }
})

export const ControlContentKindSchema = z.enum([
  'icon-only',
  'text-only',
  'icon-leading',
  'icon-trailing',
  'icon-both',
  'compound-row',
  'compound-input',
  'empty'
])

export const ControlContentSchema = z.union([
  z.object({
    kind: z.enum([
      'icon-only',
      'text-only',
      'icon-leading',
      'icon-trailing',
      'icon-both',
      'empty'
    ])
  }).strict(),
  z.object({
    kind: z.literal('compound-row'),
    trailing: z.enum(['none', 'action']),
    textFlow: z.enum(['inline', 'stacked']),
    textGap: NonnegativeFiniteSchema
  }).strict(),
  z.object({
    kind: z.literal('compound-input')
  }).strict()
])

export const ControlLayoutSchema = z.object({
  widthBehavior: z.enum(['hug', 'fill']),
  contentAlignment: z.enum([
    'start', 'center', 'end', 'space-between'
  ]).optional()
}).strict()

export const ControlSampleTextSchema = z.object({
  value: z.string().trim().min(1).refine(isSafeControlSampleTextValue),
  source: z.enum(['visible-text', 'placeholder'])
}).strict()

export const ControlTokenSchema = z.object({
  id: StableIdSchema,
  groupId: StableIdSchema,
  templateId: StableIdSchema.optional(),
  logicalControlId: StableIdSchema.optional(),
  instanceId: StableIdSchema.optional(),
  name: z.string().min(1),
  family: ControlFamilySchema,
  state: ControlStateSchema,
  intent: ControlIntentSchema,
  size: ControlSizeSchema,
  geometry: ControlGeometrySchema,
  appearance: ControlAppearanceSchema,
  typography: ControlTypographySchema,
  slots: z.object({
    leading: ControlSlotSchema.nullable(),
    trailing: ControlSlotSchema.nullable()
  }).strict(),
  slotGroups: z.object({
    leading: z.array(ControlSlotSchema).max(4),
    trailing: z.array(ControlSlotSchema).max(4)
  }).strict().optional(),
  content: ControlContentSchema.optional(),
  layout: ControlLayoutSchema.optional(),
  sampleText: ControlSampleTextSchema.optional(),
  supportingText: ControlSampleTextSchema.optional(),
  supportingStyle: z.object({
    foreground: ColorValueSchema,
    typography: ControlTypographySchema
  }).strict().optional(),
  occurrences: PositiveIntegerSchema,
  stateOccurrences: PositiveIntegerSchema
}).strict().superRefine((value, context) => {
  if (value.sampleText) {
    const validSource = value.family === 'button'
      ? value.sampleText.source === 'visible-text'
      : value.family === 'input' || value.family === 'textarea'
        ? value.sampleText.source === 'placeholder'
        : false
    if (!validSource) {
      context.addIssue({
        code: 'custom',
        path: ['sampleText'],
        message: 'Control family cannot expose this source as safe product copy'
      })
    }
  }
  if (value.content?.kind === 'compound-row') {
    if (value.family !== 'button') {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Compound rows are only valid for product command controls'
      })
    }
    if (!value.layout) {
      context.addIssue({
        code: 'custom',
        path: ['layout'],
        message: 'Compound rows require width behavior'
      })
    }
    if (!value.supportingStyle) {
      context.addIssue({
        code: 'custom',
        path: ['supportingStyle'],
        message: 'Compound rows require supporting typography'
      })
    }
    if (Boolean(value.sampleText) !== Boolean(value.supportingText)) {
      context.addIssue({
        code: 'custom',
        path: ['supportingText'],
        message: 'Compound-row copy must be present as a safe primary/supporting pair'
      })
    }
  } else if (value.supportingText || value.supportingStyle) {
    context.addIssue({
      code: 'custom',
      path: ['supportingText'],
      message: 'Supporting text is only valid for compound rows'
    })
  }
  if (value.content?.kind === 'compound-input') {
    if (value.family !== 'input' && value.family !== 'textarea') {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Compound inputs require an input or textarea family'
      })
    }
    if (value.layout?.widthBehavior !== 'fill') {
      context.addIssue({
        code: 'custom',
        path: ['layout'],
        message: 'Compound inputs require fill width behavior'
      })
    }
    if (
      !value.slotGroups ||
      value.slotGroups.leading.length === 0 ||
      value.slotGroups.trailing.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['slotGroups'],
        message: 'Compound inputs require actions on both sides'
      })
    }
  } else if (value.slotGroups) {
    context.addIssue({
      code: 'custom',
      path: ['slotGroups'],
      message: 'Grouped slots are only valid for compound inputs'
    })
  }
})

const LegacyControlTokenSchema = ControlTokenSchema.refine(
  value => value.state !== 'expanded',
  { path: ['state'], message: 'Expanded controls require schema 1.10 or newer' }
)

export const IconCategorySchema = z.enum([
  'navigation', 'action', 'composer', 'status-system', 'misc'
])

export const IconThemeSchema = z.enum(['light', 'dark'])
export const IconNameSourceSchema = z.enum([
  'accessible-name', 'svg-title', 'visible-text', 'geometry'
])
export const IconInteractionStateSchema = z.enum([
  'default', 'hover', 'pressed', 'selected', 'expanded'
])

export const IconInteractionSurfaceSchema = z.object({
  state: IconInteractionStateSchema,
  theme: IconThemeSchema,
  background: ColorValueSchema,
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  radii: z.object({
    topLeft: z.number().finite().nonnegative(),
    topRight: z.number().finite().nonnegative(),
    bottomRight: z.number().finite().nonnegative(),
    bottomLeft: z.number().finite().nonnegative()
  }).strict(),
  occurrences: PositiveIntegerSchema
}).strict()

const SanitizedIconSvgSchema = z.string().max(65_536).refine(value =>
  /^<svg\b/i.test(value.trim()) &&
  !/<(?:script|style|image|foreignObject|text|linearGradient|radialGradient)\b/i.test(value) &&
  !/\bon[a-z]+\s*=/i.test(value) &&
  !/\b(?:href|xlink:href)\s*=/i.test(value)
)

export const IconTokenSchema = z.object({
  id: StableIdSchema,
  name: z.string().trim().min(1).max(64),
  nameSource: IconNameSourceSchema.optional(),
  category: IconCategorySchema,
  vectorSvg: SanitizedIconSvgSchema,
  viewBox: z.object({
    minX: z.number().finite(),
    minY: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive()
  }).strict(),
  observedSizes: z.array(z.object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    occurrences: PositiveIntegerSchema
  }).strict()).min(1),
  themes: z.array(z.object({
    theme: IconThemeSchema,
    color: ColorValueSchema,
    occurrences: PositiveIntegerSchema
  }).strict()).min(1),
  interactionSurfaces: z.array(IconInteractionSurfaceSchema).min(1).optional(),
  occurrences: PositiveIntegerSchema,
  stateOccurrences: PositiveIntegerSchema
}).strict()

export const CompositeKindSchema = z.enum([
  'menu', 'list', 'toolbar', 'control-group', 'panel', 'popover'
])

export const CompositeStateSchema = z.enum([
  'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
])

export const CompositeGeometrySchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  padding: z.object({
    top: NonnegativeFiniteSchema,
    right: NonnegativeFiniteSchema,
    bottom: NonnegativeFiniteSchema,
    left: NonnegativeFiniteSchema
  }).strict(),
  gap: NonnegativeFiniteSchema,
  radius: NonnegativeFiniteSchema,
  borderWidth: NonnegativeFiniteSchema,
  borderWidths: z.object({
    top: NonnegativeFiniteSchema,
    right: NonnegativeFiniteSchema,
    bottom: NonnegativeFiniteSchema,
    left: NonnegativeFiniteSchema
  }).strict().optional()
}).strict()

export const CompositeLayoutSchema = z.object({
  direction: z.enum(['horizontal', 'vertical']),
  align: z.enum(['start', 'center', 'end', 'stretch']),
  justify: z.enum(['start', 'center', 'end', 'space-between']),
  wrap: z.boolean(),
  widthBehavior: z.enum(['hug', 'fill']),
  clipsContent: z.boolean().optional()
}).strict()

const HalfPixelNonnegativeSchema = NonnegativeFiniteSchema.refine(
  value => Math.abs(value * 2 - Math.round(value * 2)) < 1e-6,
  { message: 'Composite child placement must be normalized to 0.5px' }
)
const HalfPixelPositiveSchema = z.number().finite().positive().refine(
  value => Math.abs(value * 2 - Math.round(value * 2)) < 1e-6,
  { message: 'Composite child placement must be normalized to 0.5px' }
)

export const CompositeChildPlacementSchema = z.object({
  x: HalfPixelNonnegativeSchema,
  y: HalfPixelNonnegativeSchema,
  width: HalfPixelPositiveSchema,
  height: HalfPixelPositiveSchema
}).strict()

export const StaticUiCopySchema = z.object({
  source: z.literal('visible-static-ui'),
  value: z.string().trim().min(1).max(32).refine(isSafeControlSampleTextValue, {
    message: 'Static UI copy must pass the safe short UI copy filter'
  }),
  placement: CompositeChildPlacementSchema,
  typographyId: StableIdSchema,
  foreground: ColorValueSchema
}).strict()

export const StaticTextRegionChildSchema = z.object({
  kind: z.literal('static-text-region'),
  templateId: StableIdSchema,
  instanceId: StableIdSchema,
  placement: CompositeChildPlacementSchema,
  geometry: CompositeGeometrySchema,
  appearance: ControlAppearanceSchema,
  text: StaticUiCopySchema.optional()
}).strict().superRefine((region, context) => {
  if (
    Math.abs(region.geometry.width - region.placement.width) > 0.01 ||
    Math.abs(region.geometry.height - region.placement.height) > 0.01
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Static text region geometry must match its observed placement',
      path: ['geometry']
    })
  }
  if (
    region.text &&
    (
      region.text.placement.x + region.text.placement.width > region.geometry.width + 0.01 ||
      region.text.placement.y + region.text.placement.height > region.geometry.height + 0.01
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Static UI copy placement exceeds its observed region bounds',
      path: ['text', 'placement']
    })
  }
})

export const CompositeChildSchema = z.union([
  z.object({
    kind: z.literal('control'),
    controlId: StableIdSchema,
    instanceId: StableIdSchema,
    state: ControlStateSchema,
    placement: CompositeChildPlacementSchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('composite'),
    compositeId: StableIdSchema,
    placement: CompositeChildPlacementSchema.optional()
  }).strict(),
  StaticTextRegionChildSchema
])

export const CompositeTokenSchema = z.object({
  id: StableIdSchema,
  templateId: StableIdSchema,
  logicalCompositeId: StableIdSchema,
  name: z.string().trim().min(1).max(64),
  kind: CompositeKindSchema,
  state: CompositeStateSchema,
  geometry: CompositeGeometrySchema,
  appearance: ControlAppearanceSchema,
  layout: CompositeLayoutSchema,
  children: z.array(CompositeChildSchema).min(1).max(128),
  occurrences: PositiveIntegerSchema,
  stateOccurrences: PositiveIntegerSchema
}).strict()

const HttpOriginSchema = z.string().trim().min(1).max(2048).refine(
  value => /^https?:\/\/(?:\[[0-9a-f:.]+\]|[^/?#@:\s]+)(?::\d{1,5})?$/i.test(value),
  { message: 'Invalid URL' }
)

const SourceSchema = z.object({
  siteLabel: z.string().min(1),
  origin: HttpOriginSchema,
  scannedAt: z.iso.datetime(),
  locale: z.string().min(2),
  platform: z.string().min(1)
}).strict()

const TraversalSchema = z.object({
  visitedStates: z.number().int().nonnegative(),
  skippedUnsafe: z.number().int().nonnegative(),
  skippedUncertain: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  failureStages: z.object({
    navigation: z.number().int().nonnegative(),
    inspection: z.number().int().nonnegative()
  }).strict().optional()
}).strict()

const FilteredSchema = z.object({
  brandAssets: z.number().int().nonnegative(),
  personalTextNodes: z.number().int().nonnegative()
}).strict()

export const DisclosureDiagnosticElementKindSchema = z.enum([
  'native-summary',
  'native-button',
  'custom-button',
  'link',
  'other'
])

export const DisclosureDiagnosticPopupKindSchema = z.enum([
  'none',
  'true',
  'menu',
  'listbox',
  'tree',
  'grid',
  'dialog',
  'other'
])

export const DisclosureDiagnosticFileRiskSchema = z.enum([
  'none',
  'direct-input',
  'associated-input',
  'label-heuristic'
])

export const DisclosureDiagnosticRiskSchema = z.enum([
  'safe',
  'uncertain',
  'blocked',
  'not-classified'
])

export const DisclosureDiagnosticRiskReasonSchema = z.enum([
  'preflight',
  'structural-disclosure',
  'settings-disclosure',
  'share-opener',
  'settings-navigation',
  'blocked-label-or-route',
  'missing-label-or-cross-origin',
  'safe-navigation',
  'reversible-semantic',
  'default-uncertain'
])

export const DisclosureDiagnosticStageSchema = z.enum([
  'rejected-orphan-summary',
  'rejected-disabled',
  'rejected-hidden',
  'rejected-mutating-form',
  'rejected-file-picker',
  'classified',
  'family-skipped',
  'activation-attempted',
  'activation-no-structure',
  'opened-native-details',
  'opened-transient',
  'sampled',
  'restored',
  'activation-failed'
])

export const DisclosureDiagnosticSchema = z.object({
  candidateId: StableIdSchema,
  pageId: StableIdSchema.optional(),
  elementKind: DisclosureDiagnosticElementKindSchema,
  popupKind: DisclosureDiagnosticPopupKindSchema,
  hasExpanded: z.boolean(),
  hasControls: z.boolean(),
  nativeDetails: z.boolean(),
  fileRisk: DisclosureDiagnosticFileRiskSchema,
  risk: DisclosureDiagnosticRiskSchema,
  riskReason: DisclosureDiagnosticRiskReasonSchema,
  stage: DisclosureDiagnosticStageSchema,
  occurrences: PositiveIntegerSchema
}).strict()

export const CompositeDiagnosticReasonSchema = z.enum([
  'blocked-container',
  'not-visible',
  'page-scale',
  'unbounded-axis',
  'excluded-visual-asset',
  'author-content-root',
  'native-file-target',
  'no-semantic-or-surface',
  'insufficient-owned-children',
  'too-many-owned-children',
  'build-rejected'
])

export const CompositeDiagnosticSchema = z.object({
  candidateId: StableIdSchema,
  pageId: StableIdSchema.optional(),
  controlIds: z.array(StableIdSchema).min(1).max(128),
  reason: CompositeDiagnosticReasonSchema,
  occurrences: PositiveIntegerSchema
}).strict()

export const ControlDiagnosticStageSchema = z.enum([
  'rejected-not-visible',
  'rejected-excluded-visual-asset',
  'rejected-private-context',
  'rejected-private-copy',
  'rejected-compact-geometry',
  'rejected-no-painted-frame',
  'rejected-empty-control',
  'rejected-identity-only'
])

export const ControlDiagnosticSchema = z.object({
  candidateId: StableIdSchema,
  pageId: StableIdSchema.optional(),
  family: ControlFamilySchema,
  stage: ControlDiagnosticStageSchema,
  occurrences: PositiveIntegerSchema
}).strict()

export const ScanDiagnosticsSchema = z.object({
  disclosures: z.array(DisclosureDiagnosticSchema),
  composites: z.array(CompositeDiagnosticSchema).optional(),
  controls: z.array(ControlDiagnosticSchema).optional()
}).strict()

const LegacyScanExportSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const CurrentScanExportSchema = z.object({
  schemaVersion: z.literal('1.1.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const ShadowsScanExportSchema = z.object({
  schemaVersion: z.literal('1.2.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const ColorsScanExportSchema = z.object({
  schemaVersion: z.literal('1.3.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const SpacingScanExportSchema = z.object({
  schemaVersion: z.literal('1.4.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const ControlsScanExportSchema = z.object({
  schemaVersion: z.literal('1.5.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(LegacyControlTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const LabeledControlsScanExportSchema = z.object({
  schemaVersion: z.literal('1.6.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(LegacyControlTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const CompoundControlsScanExportSchema = z.object({
  schemaVersion: z.literal('1.7.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(LegacyControlTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const IconsScanExportSchema = z.object({
  schemaVersion: z.literal('1.8.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(LegacyControlTokenSchema),
  icons: z.array(IconTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const ComponentTreesScanExportSchema = z.object({
  schemaVersion: z.literal('1.9.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(LegacyControlTokenSchema),
  icons: z.array(IconTokenSchema),
  composites: z.array(CompositeTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const ControlStatesScanExportSchema = z.object({
  schemaVersion: z.literal('1.10.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(ControlTokenSchema),
  icons: z.array(IconTokenSchema),
  composites: z.array(CompositeTokenSchema),
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

export const DisclosureDiagnosticsScanExportSchema = z.object({
  schemaVersion: z.literal('1.11.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(ControlTokenSchema),
  icons: z.array(IconTokenSchema),
  composites: z.array(CompositeTokenSchema),
  diagnostics: ScanDiagnosticsSchema,
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

export const StaticStructureScanExportSchema = z.object({
  schemaVersion: z.literal('1.12.0'),
  source: SourceSchema,
  typography: z.array(TypographyStyleSchema),
  borderRadii: z.array(BorderRadiusTokenSchema),
  shadows: z.array(ShadowTokenSchema),
  colors: ColorsSchema,
  spacing: z.array(SpacingTokenSchema),
  controls: z.array(ControlTokenSchema),
  icons: z.array(IconTokenSchema),
  composites: z.array(CompositeTokenSchema),
  diagnostics: ScanDiagnosticsSchema,
  traversal: TraversalSchema,
  filtered: FilteredSchema
}).strict()

const EMPTY_COLORS = { primitives: [], semantic: [], interactive: [] } as const

export const ScanExportSchema = z.union([
  StaticStructureScanExportSchema,
  DisclosureDiagnosticsScanExportSchema,
  ControlStatesScanExportSchema,
  ComponentTreesScanExportSchema,
  IconsScanExportSchema,
  CompoundControlsScanExportSchema,
  LabeledControlsScanExportSchema,
  ControlsScanExportSchema,
  SpacingScanExportSchema,
  ColorsScanExportSchema,
  ShadowsScanExportSchema,
  CurrentScanExportSchema,
  LegacyScanExportSchema
]).transform(value => {
  if (value.schemaVersion === '1.0.0') {
    return {
      ...value,
      borderRadii: [],
      shadows: [],
      colors: { ...EMPTY_COLORS },
      spacing: [],
      controls: [],
      icons: [],
      composites: []
    }
  }
  if (value.schemaVersion === '1.1.0') {
    return {
      ...value,
      shadows: [],
      colors: { ...EMPTY_COLORS },
      spacing: [],
      controls: [],
      icons: [],
      composites: []
    }
  }
  if (value.schemaVersion === '1.2.0') {
    return {
      ...value,
      colors: { ...EMPTY_COLORS },
      spacing: [],
      controls: [],
      icons: [],
      composites: []
    }
  }
  if (value.schemaVersion === '1.3.0') {
    return { ...value, spacing: [], controls: [], icons: [], composites: [] }
  }
  if (value.schemaVersion === '1.4.0') {
    return { ...value, controls: [], icons: [], composites: [] }
  }
  if (
    value.schemaVersion !== '1.8.0' &&
    value.schemaVersion !== '1.9.0' &&
    value.schemaVersion !== '1.10.0' &&
    value.schemaVersion !== '1.11.0' &&
    value.schemaVersion !== '1.12.0'
  ) {
    return { ...value, icons: [], composites: [] }
  }
  if (value.schemaVersion === '1.8.0') return { ...value, composites: [] }
  return value
}).superRefine((value, context) => {
  const primitives = new Map(value.colors.primitives.map(token => [token.id, token.value]))
  for (const [collectionName, tokens] of [
    ['semantic', value.colors.semantic],
    ['interactive', value.colors.interactive]
  ] as const) {
    tokens.forEach((token, index) => {
      const primitive = primitives.get(token.primitiveId)
      if (!primitive) {
        context.addIssue({
          code: 'custom',
          message: 'Color token references a primitive outside this export',
          path: ['colors', collectionName, index, 'primitiveId']
        })
        return
      }
      if (JSON.stringify(primitive) !== JSON.stringify(token.value)) {
        context.addIssue({
          code: 'custom',
          message: 'Color token value does not match its primitive reference',
          path: ['colors', collectionName, index, 'value']
        })
      }
    })
  }

  if (
    value.schemaVersion !== '1.9.0' &&
    value.schemaVersion !== '1.10.0' &&
    value.schemaVersion !== '1.11.0' &&
    value.schemaVersion !== '1.12.0'
  ) return

  const controlInstances = new Set<string>()
  value.controls.forEach((control, index) => {
    if (!control.templateId || !control.logicalControlId || !control.instanceId) {
      context.addIssue({
        code: 'custom',
        message: 'Schema 1.9+ controls require template, logical, and instance identities',
        path: ['controls', index]
      })
      return
    }
    controlInstances.add(`${control.id}|${control.instanceId}|${control.state}`)
  })

  const compositeIds = new Set(value.composites.map(composite => composite.id))
  const typographyIds = new Set(value.typography.map(token => token.id))
  const graph = new Map<string, string[]>()
  value.composites.forEach((composite, compositeIndex) => {
    const nested: string[] = []
    composite.children.forEach((child, childIndex) => {
      if (child.kind === 'static-text-region' && value.schemaVersion !== '1.12.0') {
        context.addIssue({
          code: 'custom',
          message: 'Static text regions require Schema 1.12+',
          path: ['composites', compositeIndex, 'children', childIndex]
        })
        return
      }
      if (
        child.placement &&
        (
          child.placement.x + child.placement.width > composite.geometry.width + 2 ||
          child.placement.y + child.placement.height > composite.geometry.height + 2
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Composite child placement exceeds its observed parent bounds',
          path: ['composites', compositeIndex, 'children', childIndex, 'placement']
        })
      }
      if (child.kind === 'control') {
        const key = `${child.controlId}|${child.instanceId}|${child.state}`
        if (!controlInstances.has(key)) {
          context.addIssue({
            code: 'custom',
            message: 'Composite child references a control instance outside this export',
            path: ['composites', compositeIndex, 'children', childIndex]
          })
        }
        return
      }
      if (child.kind === 'static-text-region') {
        if (child.text && !typographyIds.has(child.text.typographyId)) {
          context.addIssue({
            code: 'custom',
            message: 'Static UI copy references typography outside this export',
            path: ['composites', compositeIndex, 'children', childIndex, 'text', 'typographyId']
          })
        }
        return
      }
      if (child.compositeId === composite.id) {
        context.addIssue({
          code: 'custom',
          message: 'Composite cannot reference itself',
          path: ['composites', compositeIndex, 'children', childIndex]
        })
      } else if (!compositeIds.has(child.compositeId)) {
        context.addIssue({
          code: 'custom',
          message: 'Composite child references a composite outside this export',
          path: ['composites', compositeIndex, 'children', childIndex]
        })
      }
      nested.push(child.compositeId)
    })
    graph.set(composite.id, nested)
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const cyclic = (graph.get(id) ?? []).some(visit)
    visiting.delete(id)
    visited.add(id)
    return cyclic
  }
  if (value.composites.some(composite => visit(composite.id))) {
    context.addIssue({
      code: 'custom',
      message: 'Composite graph must be acyclic',
      path: ['composites']
    })
  }
})

export type ScanExport = z.infer<typeof ScanExportSchema>
export type DisclosureDiagnosticsScanExport = z.infer<
  typeof DisclosureDiagnosticsScanExportSchema
>
export type StaticStructureScanExport = z.infer<typeof StaticStructureScanExportSchema>
export type DisclosureDiagnosticElementKind = z.infer<typeof DisclosureDiagnosticElementKindSchema>
export type DisclosureDiagnosticPopupKind = z.infer<typeof DisclosureDiagnosticPopupKindSchema>
export type DisclosureDiagnosticFileRisk = z.infer<typeof DisclosureDiagnosticFileRiskSchema>
export type DisclosureDiagnosticRisk = z.infer<typeof DisclosureDiagnosticRiskSchema>
export type DisclosureDiagnosticRiskReason = z.infer<typeof DisclosureDiagnosticRiskReasonSchema>
export type DisclosureDiagnosticStage = z.infer<typeof DisclosureDiagnosticStageSchema>
export type DisclosureDiagnostic = z.infer<typeof DisclosureDiagnosticSchema>
export type CompositeDiagnosticReason = z.infer<typeof CompositeDiagnosticReasonSchema>
export type CompositeDiagnostic = z.infer<typeof CompositeDiagnosticSchema>
export type ControlDiagnosticStage = z.infer<typeof ControlDiagnosticStageSchema>
export type ControlDiagnostic = z.infer<typeof ControlDiagnosticSchema>
export type ScanDiagnostics = z.infer<typeof ScanDiagnosticsSchema>
export type TypographyStyle = z.infer<typeof TypographyStyleSchema>
export type BorderRadiusToken = z.infer<typeof BorderRadiusTokenSchema>
export type ShadowLayer = z.infer<typeof ShadowLayerSchema>
export type ShadowToken = z.infer<typeof ShadowTokenSchema>
export type ColorValue = z.infer<typeof ColorValueSchema>
export type ColorProvenance = z.infer<typeof ColorProvenanceSchema>
export type ColorFamily = z.infer<typeof ColorFamilySchema>
export type PrimitiveColorToken = z.infer<typeof PrimitiveColorTokenSchema>
export type SemanticColorGroup = z.infer<typeof SemanticColorGroupSchema>
export type SemanticColorToken = z.infer<typeof SemanticColorTokenSchema>
export type InteractiveColorIntent = z.infer<typeof InteractiveColorIntentSchema>
export type InteractiveColorState = z.infer<typeof InteractiveColorStateSchema>
export type InteractiveColorUsage = z.infer<typeof InteractiveColorUsageSchema>
export type InteractiveColorToken = z.infer<typeof InteractiveColorTokenSchema>
export type Colors = z.infer<typeof ColorsSchema>
export type SpacingToken = z.infer<typeof SpacingTokenSchema>
export type ControlFamily = z.infer<typeof ControlFamilySchema>
export type ControlState = z.infer<typeof ControlStateSchema>
export type ControlIntent = z.infer<typeof ControlIntentSchema>
export type ControlSize = z.infer<typeof ControlSizeSchema>
export type ControlGeometry = z.infer<typeof ControlGeometrySchema>
export type ControlAppearance = z.infer<typeof ControlAppearanceSchema>
export type ControlTypography = z.infer<typeof ControlTypographySchema>
export type ControlSlot = z.infer<typeof ControlSlotSchema>
export type ControlContentKind = z.infer<typeof ControlContentKindSchema>
export type ControlContent = z.infer<typeof ControlContentSchema>
export type ControlSampleText = z.infer<typeof ControlSampleTextSchema>
export type ControlToken = z.infer<typeof ControlTokenSchema>
export type CompositeKind = z.infer<typeof CompositeKindSchema>
export type CompositeState = z.infer<typeof CompositeStateSchema>
export type CompositeGeometry = z.infer<typeof CompositeGeometrySchema>
export type CompositeLayout = z.infer<typeof CompositeLayoutSchema>
export type CompositeChild = z.infer<typeof CompositeChildSchema>
export type StaticUiCopy = z.infer<typeof StaticUiCopySchema>
export type StaticTextRegionChild = z.infer<typeof StaticTextRegionChildSchema>
export type CompositeToken = z.infer<typeof CompositeTokenSchema>
export type IconCategory = z.infer<typeof IconCategorySchema>
export type IconTheme = z.infer<typeof IconThemeSchema>
export type IconInteractionState = z.infer<typeof IconInteractionStateSchema>
export type IconInteractionSurface = z.infer<typeof IconInteractionSurfaceSchema>
export type IconToken = z.infer<typeof IconTokenSchema>
