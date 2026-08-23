import { describe, expect, it } from 'vitest'
import {
  ScanExportSchema,
  type ControlToken
} from '../../src/shared/schema'
import { buildScanExport } from '../../src/chrome/background/export'

describe('buildScanExport', () => {
  it('uses origin-only source metadata and produces schema-valid JSON data', () => {
    const payload = buildScanExport({
      startUrl: 'https://app.example.com/private-project?secret=yes',
      locale: 'zh-CN',
      platform: 'macOS',
      scannedAt: '2026-07-18T12:00:00.000Z',
      result: {
        typography: [],
        borderRadii: [{
          id: `sha256:${'1'.repeat(64)}`,
          name: 'radius-8',
          kind: 'px',
          value: 8,
          occurrences: 3
        }],
        shadows: [{
          id: `sha256:${'2'.repeat(64)}`,
          name: 'shadow-outer-x0-y4-b12-s0-a15',
          layers: [{
            kind: 'outer', offsetX: 0, offsetY: 4, blur: 12, spread: 0,
            color: { r: 0, g: 0, b: 0, a: 0.15 }
          }],
          occurrences: 2
        }],
        colors: {
          primitives: [{
            id: `sha256:${'3'.repeat(64)}`,
            name: 'neutral-0',
            value: { r: 1, g: 1, b: 1, a: 1 },
            family: 'neutral',
            step: 0,
            provenance: 'observed',
            occurrences: 2
          }],
          semantic: [],
          interactive: []
        },
        spacing: [{
          id: `sha256:${'4'.repeat(64)}`,
          name: 'spacing-8',
          value: 8,
          occurrences: 2,
          evidence: { padding: 1, gap: 1, margin: 0 },
          stateOccurrences: 1
        }],
        controls: [{
          id: `sha256:${'5'.repeat(64)}`,
          groupId: `sha256:${'6'.repeat(64)}`,
          templateId: `sha256:${'6'.repeat(64)}`,
          logicalControlId: `sha256:${'8'.repeat(64)}`,
          instanceId: `sha256:${'9'.repeat(64)}`,
          name: 'button-primary-md',
          family: 'button',
          state: 'default',
          intent: 'primary',
          size: 'md',
          geometry: {
            height: 40,
            minWidth: null,
            padding: { top: 8, right: 12, bottom: 8, left: 12 },
            gap: 8,
            radius: 8,
            borderWidth: 0
          },
          appearance: {
            background: { r: 0, g: 0, b: 0, a: 1 },
            foreground: { r: 1, g: 1, b: 1, a: 1 },
            border: { r: 0, g: 0, b: 0, a: 0 },
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
          slots: { leading: null, trailing: null },
          sampleText: { value: 'Share', source: 'visible-text' },
          occurrences: 1,
          stateOccurrences: 1
        }],
        composites: [],
        icons: [{
          id: `sha256:${'7'.repeat(64)}`,
          name: 'search',
          category: 'navigation',
          vectorSvg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4z"/></svg>',
          viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
          observedSizes: [{ width: 20, height: 20, occurrences: 2 }],
          themes: [{
            theme: 'light',
            color: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
            occurrences: 2
          }],
          occurrences: 2,
          stateOccurrences: 1
        }],
        diagnostics: {
          disclosures: [{
            candidateId: `sha256:${'8'.repeat(64)}`,
            elementKind: 'native-button',
            popupKind: 'menu',
            hasExpanded: true,
            hasControls: false,
            nativeDetails: false,
            fileRisk: 'none',
            risk: 'safe',
            riskReason: 'structural-disclosure',
            stage: 'classified',
            occurrences: 2
          }]
        },
        traversal: { visitedStates: 2, skippedUnsafe: 1, skippedUncertain: 1, failures: 0 },
        filtered: { brandAssets: 4, personalTextNodes: 20 }
      }
    })
    expect(ScanExportSchema.parse(payload)).toEqual(payload)
    expect(payload.schemaVersion).toBe('1.12.0')
    expect(payload.borderRadii).toHaveLength(1)
    expect(payload.shadows).toHaveLength(1)
    expect(payload.colors.primitives).toHaveLength(1)
    expect(payload.spacing).toHaveLength(1)
    expect(payload.controls).toHaveLength(1)
    expect(payload.composites).toEqual([])
    expect(payload.icons).toHaveLength(1)
    expect(payload.diagnostics.disclosures).toHaveLength(1)
    expect(payload.controls[0]?.sampleText?.value).toBe('Share')
    expect(payload.source).toEqual({
      siteLabel: 'app.example.com',
      origin: 'https://app.example.com',
      scannedAt: '2026-07-18T12:00:00.000Z',
      locale: 'zh-CN',
      platform: 'macOS'
    })
    expect(JSON.stringify(payload)).not.toContain('private-project')
    expect(JSON.stringify(payload)).not.toContain('secret')
  })

  it('drops unsafe late control copy before publishing the ready export', () => {
    const control: ControlToken = {
      id: `sha256:${'8'.repeat(64)}`,
      groupId: `sha256:${'9'.repeat(64)}`,
      templateId: `sha256:${'9'.repeat(64)}`,
      logicalControlId: `sha256:${'a'.repeat(64)}`,
      instanceId: `sha256:${'b'.repeat(64)}`,
      name: 'button-tertiary-sm',
      family: 'button',
      state: 'default',
      intent: 'tertiary',
      size: 'sm',
      geometry: {
        height: 32,
        minWidth: null,
        padding: { top: 6, right: 8, bottom: 6, left: 8 },
        gap: 4,
        radius: 6,
        borderWidth: 0
      },
      appearance: {
        background: { r: 0, g: 0, b: 0, a: 0 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: []
      },
      typography: {
        fontFamilyStack: ['system-ui'],
        fontStyle: 'normal',
        fontSizePx: 14,
        fontWeight: 400,
        lineHeightPx: 20,
        letterSpacingPx: 0
      },
      slots: { leading: null, trailing: null },
      sampleText: {
        value: 'owner/private-branch',
        source: 'visible-text'
      },
      occurrences: 1,
      stateOccurrences: 1
    }

    const payload = buildScanExport({
      startUrl: 'https://example.com/team/project',
      locale: 'en',
      platform: 'MacIntel',
      scannedAt: '2026-07-30T12:00:00.000Z',
      result: {
        typography: [],
        borderRadii: [],
        shadows: [],
        colors: { primitives: [], semantic: [], interactive: [] },
        spacing: [],
        controls: [control],
        composites: [],
        icons: [],
        traversal: {
          visitedStates: 1,
          skippedUnsafe: 0,
          skippedUncertain: 0,
          failures: 0
        },
        filtered: { brandAssets: 0, personalTextNodes: 0 }
      }
    })

    expect(ScanExportSchema.parse(payload)).toEqual(payload)
    expect(payload.controls).toHaveLength(1)
    expect(payload.controls[0]).not.toHaveProperty('sampleText')
    expect(JSON.stringify(payload)).not.toContain('private-branch')
  })
})
