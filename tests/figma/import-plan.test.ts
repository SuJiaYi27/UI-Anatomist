import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScanExport } from '../../src/shared/schema'
import { createImportPlan, parseScanExport } from '../../src/figma/import-plan'

const exportData: ScanExport = {
  schemaVersion: '1.0.0',
  source: {
    siteLabel: 'example.com',
    origin: 'https://example.com',
    scannedAt: '2026-07-18T12:00:00.000Z',
    locale: 'zh-CN',
    platform: 'mac'
  },
  typography: [
    {
      id: `sha256:${'a'.repeat(64)}`,
      name: 'body-regular',
      fontFamilyStack: ['Inter', 'sans-serif'],
      fontStyle: 'normal',
      fontSizePx: 16,
      fontWeight: 400,
      lineHeightPx: 24,
      letterSpacingPx: 0,
      role: 'body',
      occurrences: 12
    }
  ],
  traversal: { visitedStates: 2, skippedUnsafe: 1, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 4, personalTextNodes: 8 }
}

const availableFonts = [{ family: 'Inter', style: 'Regular' }]

describe('parseScanExport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts the legacy scanner contract and normalizes missing radii', () => {
    expect(parseScanExport(JSON.stringify(exportData))).toEqual({
      ...exportData,
      borderRadii: [],
      shadows: [],
      colors: { primitives: [], semantic: [], interactive: [] },
      spacing: [],
      controls: [],
      composites: [],
      icons: []
    })
  })

  it('rejects malformed JSON before any Figma mutation can occur', () => {
    expect(() => parseScanExport('{oops')).toThrow('JSON')
  })

  it('reports the first schema path when valid JSON does not match the contract', () => {
    const invalid = {
      ...structuredClone(exportData),
      schemaVersion: '1.3.0',
      borderRadii: [],
      shadows: [],
      colors: { primitives: [], semantic: [], interactive: [] }
    }
    invalid.source.origin = 'not-a-url'

    expect(() => parseScanExport(JSON.stringify(invalid))).toThrow('source.origin')
  })

  it('reports the current supported schema range', () => {
    expect(() => parseScanExport('{}')).toThrow('UI-Anatomist 1.0–1.12')
  })

  it('ignores anonymous diagnostics when creating Figma plans', () => {
    const normalized = parseScanExport(JSON.stringify(exportData))
    const current = {
      ...normalized,
      schemaVersion: '1.11.0' as const,
      diagnostics: { disclosures: [] }
    }
    const diagnosed = {
      ...current,
      diagnostics: {
        disclosures: [{
          candidateId: `sha256:${'d'.repeat(64)}`,
          elementKind: 'native-button' as const,
          popupKind: 'menu' as const,
          hasExpanded: true,
          hasControls: false,
          nativeDetails: false,
          fileRisk: 'none' as const,
          risk: 'safe' as const,
          riskReason: 'structural-disclosure' as const,
          stage: 'classified' as const,
          occurrences: 1
        }]
      }
    }

    const parsedCurrent = parseScanExport(JSON.stringify(current))
    const parsedDiagnosed = parseScanExport(JSON.stringify(diagnosed))
    expect(parsedDiagnosed.schemaVersion).toBe('1.10.0')
    expect(parsedDiagnosed).not.toHaveProperty('diagnostics')
    expect(createImportPlan(parsedDiagnosed, availableFonts, []))
      .toEqual(createImportPlan(parsedCurrent, availableFonts, []))
  })

  it('accepts a valid HTTPS origin when the Figma sandbox has no URL constructor', () => {
    vi.stubGlobal('URL', undefined)

    expect(parseScanExport(JSON.stringify(exportData)).source.origin).toBe('https://example.com')
  })
})

describe('createImportPlan', () => {
  it('creates a namespaced style and records stable ownership', () => {
    const plan = createImportPlan(exportData, availableFonts, [])

    expect(plan.entries[0]).toMatchObject({
      action: 'create',
      targetName: 'UI-Anatomist/example.com/body-regular',
      ownershipId: `https://example.com|sha256:${'a'.repeat(64)}`,
      fontName: { family: 'Inter', style: 'Regular' }
    })
  })

  it('updates only a style previously owned by UI-Anatomist', () => {
    const owned = {
      id: 'style:1',
      name: 'Old name',
      ownershipId: `https://example.com|sha256:${'a'.repeat(64)}`
    }
    expect(createImportPlan(exportData, availableFonts, [owned]).entries[0].action).toBe('update')
  })

  it('does not overwrite a user style with the same name', () => {
    const userStyle = {
      id: 'style:user',
      name: 'UI-Anatomist/example.com/body-regular',
      ownershipId: null
    }
    expect(createImportPlan(exportData, availableFonts, [userStyle]).entries[0].action).toBe('skip_conflict')
  })

  it('does not rename an owned style over a user style that later took the target name', () => {
    const ownershipId = `https://example.com|sha256:${'a'.repeat(64)}`
    const entries = createImportPlan(exportData, availableFonts, [
      { id: 'style:owned', name: 'UI-Anatomist/example.com/old-name', ownershipId },
      { id: 'style:user', name: 'UI-Anatomist/example.com/body-regular', ownershipId: null }
    ]).entries

    expect(entries[0]).toMatchObject({ action: 'skip_conflict', existingStyleId: 'style:user' })
  })

  it('gives distinct signatures with the same scanner name stable unique style names', () => {
    const duplicate = structuredClone(exportData)
    duplicate.typography.push({
      ...duplicate.typography[0],
      id: `sha256:${'b'.repeat(64)}`,
      lineHeightPx: 28
    })

    const entries = createImportPlan(duplicate, availableFonts, []).entries
    expect(entries.map(entry => entry.targetName)).toEqual([
      'UI-Anatomist/example.com/body-regular',
      'UI-Anatomist/example.com/body-regular · bbbbbb'
    ])
    expect(entries.map(entry => entry.action)).toEqual(['create', 'create'])
  })

  it('updates both disambiguated styles idempotently on a second import', () => {
    const duplicate = structuredClone(exportData)
    duplicate.typography.push({
      ...duplicate.typography[0],
      id: `sha256:${'b'.repeat(64)}`,
      lineHeightPx: 28
    })
    const first = createImportPlan(duplicate, availableFonts, [])
    const existing = first.entries.map((entry, index) => ({
      id: `style:${index}`,
      name: entry.targetName,
      ownershipId: entry.ownershipId
    }))

    const second = createImportPlan(duplicate, availableFonts, existing)
    expect(second.entries.map(entry => entry.action)).toEqual(['update', 'update'])
    expect(second.entries.map(entry => entry.targetName)).toEqual(first.entries.map(entry => entry.targetName))
  })

  it('migrates a same-origin plugin style when current webpage values change its signature id', () => {
    const oldOwnership = `https://example.com|sha256:${'a'.repeat(64)}`
    const changed = structuredClone(exportData)
    changed.typography[0] = {
      ...changed.typography[0],
      id: `sha256:${'c'.repeat(64)}`,
      lineHeightPx: 25
    }

    const entry = createImportPlan(changed, availableFonts, [{
      id: 'style:owned-old-values',
      name: 'UI-Anatomist/example.com/body-regular',
      ownershipId: oldOwnership
    }]).entries[0]

    expect(entry).toMatchObject({
      action: 'update',
      existingStyleId: 'style:owned-old-values',
      ownershipId: `https://example.com|sha256:${'c'.repeat(64)}`
    })
  })

  it('skips only the style whose font is unavailable', () => {
    const missing = structuredClone(exportData)
    missing.typography.push({
      ...missing.typography[0],
      id: `sha256:${'b'.repeat(64)}`,
      name: 'special',
      fontFamilyStack: ['Unavailable Family']
    })

    const entries = createImportPlan(missing, availableFonts, []).entries
    expect(entries.map(entry => entry.action)).toEqual(['create', 'skip_missing_font'])
  })
})
