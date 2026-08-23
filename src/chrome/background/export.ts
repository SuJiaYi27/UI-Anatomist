import { siteLabelFromOrigin } from '../privacy'
import {
  ControlTokenSchema,
  ScanExportSchema,
  type BorderRadiusToken,
  type Colors,
  type CompositeToken,
  type ControlToken,
  type IconToken,
  type ScanExport,
  type ScanDiagnostics,
  type ShadowToken,
  type SpacingToken,
  type StaticStructureScanExport,
  type TypographyStyle
} from '../../shared/schema'

type BuildExportInput = {
  startUrl: string
  locale: string
  platform: string
  scannedAt?: string
  result: {
    typography: TypographyStyle[]
    borderRadii: BorderRadiusToken[]
    shadows: ShadowToken[]
    colors: Colors
    spacing: SpacingToken[]
    controls: ControlToken[]
    composites: CompositeToken[]
    icons: IconToken[]
    diagnostics?: ScanDiagnostics
    traversal: ScanExport['traversal']
    filtered: ScanExport['filtered']
  }
}

export function buildScanExport(input: BuildExportInput): StaticStructureScanExport {
  const url = new URL(input.startUrl)
  const controls = input.result.controls.map(control => {
    const parsed = ControlTokenSchema.safeParse(control)
    if (parsed.success) return parsed.data
    const {
      sampleText: _sampleText,
      supportingText: _supportingText,
      ...withoutCopy
    } = control
    return ControlTokenSchema.parse(withoutCopy)
  })
  return ScanExportSchema.parse({
    schemaVersion: '1.12.0',
    source: {
      siteLabel: siteLabelFromOrigin(url.origin),
      origin: url.origin,
      scannedAt: input.scannedAt ?? new Date().toISOString(),
      locale: input.locale,
      platform: input.platform
    },
    typography: input.result.typography,
    borderRadii: input.result.borderRadii,
    shadows: input.result.shadows,
    colors: input.result.colors,
    spacing: input.result.spacing,
    controls,
    composites: input.result.composites,
    icons: input.result.icons,
    diagnostics: input.result.diagnostics ?? { disclosures: [] },
    traversal: input.result.traversal,
    filtered: input.result.filtered
  }) as StaticStructureScanExport
}
