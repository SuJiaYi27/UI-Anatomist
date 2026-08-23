import { describe, expect, it, vi } from 'vitest'

import type { ImportPlanEntry } from '../../src/figma/import-plan'
import { applyImportPlan, OWNERSHIP_KEY, type TextStylePort } from '../../src/figma/style-applier'

function entry(overrides: Partial<ImportPlanEntry> = {}): ImportPlanEntry {
  return {
    action: 'create',
    source: {
      id: `sha256:${'a'.repeat(64)}`,
      name: 'body-regular',
      fontFamilyStack: ['Inter'],
      fontStyle: 'normal',
      fontSizePx: 16,
      fontWeight: 400,
      lineHeightPx: 24,
      letterSpacingPx: 0,
      role: 'body',
      occurrences: 4
    },
    targetName: 'UI-Anatomist/example.com/body-regular',
    ownershipId: `https://example.com|sha256:${'a'.repeat(64)}`,
    fontName: { family: 'Inter', style: 'Regular' },
    existingStyleId: null,
    ...overrides
  }
}

function fakeStyle(id = 'style:new'): TextStylePort {
  const data = new Map<string, string>()
  return {
    id,
    name: '',
    description: '',
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 12,
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    setPluginData: (key, value) => data.set(key, value),
    getPluginData: key => data.get(key) ?? '',
    remove: vi.fn()
  }
}

describe('applyImportPlan', () => {
  it('loads the exact matched font before creating the style', async () => {
    const created = fakeStyle()
    const loadFont = vi.fn().mockResolvedValue(undefined)
    const result = await applyImportPlan([entry()], {
      loadFont,
      createTextStyle: () => created,
      getTextStyleById: async () => null
    })

    expect(loadFont).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' })
    expect(created).toMatchObject({
      name: 'UI-Anatomist/example.com/body-regular',
      fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PIXELS', value: 0 }
    })
    expect(created.getPluginData(OWNERSHIP_KEY)).toContain('https://example.com|sha256:')
    expect(result.created).toHaveLength(1)
  })

  it('updates an owned style in place', async () => {
    const existing = fakeStyle('style:owned')
    const result = await applyImportPlan([entry({ action: 'update', existingStyleId: existing.id })], {
      loadFont: async () => undefined,
      createTextStyle: () => fakeStyle(),
      getTextStyleById: async id => id === existing.id ? existing : null
    })

    expect(result.updated).toEqual([existing])
    expect(existing.name).toBe('UI-Anatomist/example.com/body-regular')
  })

  it('does not mutate Figma for missing fonts or name conflicts', async () => {
    const createTextStyle = vi.fn()
    const result = await applyImportPlan([
      entry({ action: 'skip_missing_font', fontName: null }),
      entry({ action: 'skip_conflict', existingStyleId: 'style:user' })
    ], {
      loadFont: vi.fn(),
      createTextStyle,
      getTextStyleById: vi.fn()
    })

    expect(createTextStyle).not.toHaveBeenCalled()
    expect(result.missingFonts).toEqual(['Inter'])
    expect(result.conflicts).toEqual(['UI-Anatomist/example.com/body-regular'])
  })

  it('removes a newly-created style if applying it fails', async () => {
    const created = fakeStyle()
    Object.defineProperty(created, 'fontSize', {
      set() { throw new Error('Figma rejected the size') },
      get() { return 12 }
    })

    await expect(applyImportPlan([entry()], {
      loadFont: async () => undefined,
      createTextStyle: () => created,
      getTextStyleById: async () => null
    })).rejects.toThrow('Figma rejected')
    expect(created.remove).toHaveBeenCalledOnce()
  })
})
