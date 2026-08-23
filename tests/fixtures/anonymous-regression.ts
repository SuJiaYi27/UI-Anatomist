import type {
  CompositeToken,
  ControlToken,
  IconToken,
  ScanExport
} from '../../src/shared/schema'

export const PUBLIC_TEST_ORIGIN = 'https://example.test'

export function stableId(seed: number): string {
  return `sha256:${seed.toString(16).padStart(64, '0')}`
}

type ControlOptions = {
  family?: ControlToken['family']
  state?: ControlToken['state']
  label?: string | null
  logicalSeed?: number
  instanceSeed?: number
  templateSeed?: number
  contentAlignment?: NonNullable<ControlToken['layout']>['contentAlignment']
  widthBehavior?: NonNullable<ControlToken['layout']>['widthBehavior']
  leadingIcon?: boolean
}

export function makeControl(seed: number, options: ControlOptions = {}): ControlToken {
  const family = options.family ?? 'button'
  const state = options.state ?? 'default'
  const label = options.label === undefined ? 'Open menu' : options.label
  const leading = options.leadingIcon
    ? {
        width: 16,
        height: 16,
        assetType: 'ui-icon' as const,
        vectorSvg: '<svg viewBox="0 0 16 16"><path d="M3 8h10" stroke="currentColor"/></svg>'
      }
    : null
  const token: ControlToken = {
    id: stableId(seed),
    groupId: stableId(options.templateSeed ?? seed + 100),
    templateId: stableId(options.templateSeed ?? seed + 100),
    logicalControlId: stableId(options.logicalSeed ?? seed + 200),
    instanceId: stableId(options.instanceSeed ?? seed + 300),
    name: `${family}-neutral-md-${state}`,
    family,
    state,
    intent: 'neutral',
    size: 'md',
    geometry: {
      height: 40,
      minWidth: 160,
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 8,
      radius: 8,
      borderWidth: 1
    },
    appearance: {
      background: state === 'default'
        ? { r: 1, g: 1, b: 1, a: 1 }
        : { r: 0.92, g: 0.92, b: 0.92, a: 1 },
      foreground: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      border: { r: 0.75, g: 0.75, b: 0.75, a: 1 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    typography: {
      fontFamilyStack: ['Arial'],
      fontStyle: 'normal',
      fontSizePx: 14,
      fontWeight: 400,
      lineHeightPx: 20,
      letterSpacingPx: 0
    },
    slots: { leading, trailing: null },
    content: { kind: leading ? 'icon-leading' : label ? 'text-only' : 'empty' },
    layout: {
      widthBehavior: options.widthBehavior ?? 'fill',
      contentAlignment: options.contentAlignment ?? 'start'
    },
    occurrences: 1,
    stateOccurrences: 1
  }
  if (label) {
    token.sampleText = {
      value: label,
      source: family === 'input' || family === 'textarea'
        ? 'placeholder'
        : 'visible-text'
    }
  }
  return token
}

export function makeIcon(seed: number, name = 'Open menu'): IconToken {
  return {
    id: stableId(seed),
    name,
    nameSource: 'accessible-name',
    category: 'action',
    vectorSvg: '<svg viewBox="0 0 16 16"><path d="M3 8h10" stroke="currentColor"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 16, height: 16 },
    observedSizes: [{ width: 16, height: 16, occurrences: 1 }],
    themes: [{
      theme: 'light',
      color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      occurrences: 1
    }],
    occurrences: 1,
    stateOccurrences: 1
  }
}

type CompositeOptions = {
  kind?: CompositeToken['kind']
  state?: CompositeToken['state']
  logicalSeed?: number
  templateSeed?: number
  width?: number
  height?: number
  backgroundAlpha?: number
}

export function makeComposite(
  seed: number,
  children: CompositeToken['children'],
  options: CompositeOptions = {}
): CompositeToken {
  const kind = options.kind ?? 'popover'
  return {
    id: stableId(seed),
    templateId: stableId(options.templateSeed ?? seed + 100),
    logicalCompositeId: stableId(options.logicalSeed ?? seed + 200),
    name: `${kind}-vertical`,
    kind,
    state: options.state ?? 'default',
    geometry: {
      width: options.width ?? 240,
      height: options.height ?? 112,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 8,
      radius: 12,
      borderWidth: 1
    },
    appearance: {
      background: { r: 1, g: 1, b: 1, a: options.backgroundAlpha ?? 1 },
      foreground: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      border: { r: 0.75, g: 0.75, b: 0.75, a: 1 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    layout: {
      direction: 'vertical',
      align: 'stretch',
      justify: 'start',
      wrap: false,
      widthBehavior: 'hug'
    },
    children,
    occurrences: 1,
    stateOccurrences: 1
  }
}

export function placedControl(
  control: ControlToken,
  y: number,
  width = 224
): CompositeToken['children'][number] {
  return {
    kind: 'control',
    controlId: control.id,
    instanceId: control.instanceId!,
    state: control.state,
    placement: { x: 8, y, width, height: 40 }
  }
}

export function makeScan(options: {
  controls?: ControlToken[]
  icons?: IconToken[]
  composites?: CompositeToken[]
} = {}): ScanExport {
  return {
    schemaVersion: '1.12.0',
    source: {
      siteLabel: 'example.test',
      origin: PUBLIC_TEST_ORIGIN,
      scannedAt: '2026-01-01T00:00:00.000Z',
      locale: 'en',
      platform: 'test'
    },
    typography: [],
    borderRadii: [],
    shadows: [],
    colors: { primitives: [], semantic: [], interactive: [] },
    spacing: [],
    controls: options.controls ?? [],
    icons: options.icons ?? [],
    composites: options.composites ?? [],
    diagnostics: { disclosures: [], controls: [], composites: [] },
    traversal: {
      visitedStates: 1,
      skippedUnsafe: 0,
      skippedUncertain: 0,
      failures: 0
    },
    filtered: { brandAssets: 0, personalTextNodes: 0 }
  }
}
