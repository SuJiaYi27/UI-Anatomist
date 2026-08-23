import { describe, expect, it, vi } from 'vitest'
import type { ScanExport } from '../../src/shared/schema'
import {
  applyIconVariablePlan,
  createIconVariablePlan,
  ICON_COLLECTION_OWNERSHIP_KEY,
  ICON_VARIABLE_OWNERSHIP_KEY,
  type IconCollectionPort,
  type IconVariablePort
} from '../../src/figma/icon-variable-applier'

const data: ScanExport = {
  schemaVersion: '1.8.0',
  source: {
    siteLabel: 'example.com', origin: 'https://example.com',
    scannedAt: '2026-07-25T00:00:00.000Z', locale: 'zh-CN', platform: 'macOS'
  },
  typography: [], borderRadii: [], shadows: [],
  colors: {
    primitives: [],
    semantic: [],
    interactive: [{
      id: `sha256:${'2'.repeat(64)}`,
      name: 'tertiary-hover-background',
      intent: 'tertiary',
      state: 'hover',
      usage: 'background',
      value: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      primitiveId: `sha256:${'3'.repeat(64)}`,
      provenance: 'observed',
      occurrences: 8
    }]
  },
  spacing: [], controls: [],
  icons: [{
    id: `sha256:${'1'.repeat(64)}`, name: 'search', nameSource: 'svg-title', category: 'navigation',
    vectorSvg: '<svg viewBox="0 0 24 24"><path d="M0 0h1v1z"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
    observedSizes: [{ width: 20, height: 20, occurrences: 4 }],
    themes: [
      { theme: 'light', color: { r: 0.05, g: 0.05, b: 0.05, a: 1 }, occurrences: 3 },
      { theme: 'dark', color: { r: 0.95, g: 0.95, b: 0.95, a: 1 }, occurrences: 1 }
    ],
    interactionSurfaces: [{
      state: 'hover',
      theme: 'light',
      background: { r: 0.91, g: 0.91, b: 0.91, a: 1 },
      width: 32,
      height: 32,
      radii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
      occurrences: 2
    }],
    occurrences: 4, stateOccurrences: 2
  }],
  traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

function pluginData() {
  const values = new Map<string, string>()
  const shared = new Map<string, string>()
  return {
    setPluginData: (key: string, value: string) => values.set(key, value),
    getPluginData: (key: string) => values.get(key) ?? '',
    setSharedPluginData: (namespace: string, key: string, value: string) =>
      shared.set(`${namespace}|${key}`, value),
    getSharedPluginData: (namespace: string, key: string) =>
      shared.get(`${namespace}|${key}`) ?? ''
  }
}

function collection(): IconCollectionPort {
  return {
    id: 'collection:1', name: '', defaultModeId: 'mode:light',
    modes: [{ modeId: 'mode:light', name: 'Mode 1' }],
    renameMode: vi.fn(), addMode: vi.fn(() => 'mode:dark'),
    remove: vi.fn(), ...pluginData()
  }
}

function variable(id: string): IconVariablePort {
  return {
    id, name: '', description: '', resolvedType: 'COLOR', scopes: [],
    setValueForMode: vi.fn(), setVariableCodeSyntax: vi.fn(),
    remove: vi.fn(), ...pluginData()
  }
}

describe('applyIconVariablePlan', () => {
  it('creates evidence-backed Light/Dark primary and per-icon hover variables', async () => {
    const createdCollection = collection()
    const created = [variable('primary'), variable('hover')]
    const result = await applyIconVariablePlan(
      createIconVariablePlan(data, [], []),
      {
        createCollection: () => createdCollection,
        createVariable: vi.fn()
          .mockReturnValueOnce(created[0])
          .mockReturnValueOnce(created[1]),
        getVariableById: async () => null
      }
    )

    expect(createdCollection.name).toBe('UI-Anatomist / example.com / Icon Colors')
    expect(createdCollection.renameMode).toHaveBeenCalledWith('mode:light', 'Light')
    expect(createdCollection.addMode).toHaveBeenCalledWith('Dark')
    expect(createdCollection.getPluginData(ICON_COLLECTION_OWNERSHIP_KEY))
      .toBe('https://example.com')
    expect(createdCollection.getSharedPluginData?.(
      'smart.scan.icons',
      ICON_COLLECTION_OWNERSHIP_KEY
    )).toBe('https://example.com')
    expect(created[0]!.name).toBe('Icon/Primary')
    expect(created[0]!.setValueForMode).toHaveBeenCalledWith(
      'mode:light',
      { r: 0.05, g: 0.05, b: 0.05, a: 1 }
    )
    expect(created[0]!.setValueForMode).toHaveBeenCalledWith(
      'mode:dark',
      { r: 0.95, g: 0.95, b: 0.95, a: 1 }
    )
    expect(created[1]!.setValueForMode).toHaveBeenCalledWith(
      'mode:light',
      data.icons[0]!.interactionSurfaces![0]!.background
    )
    expect(created[1]!.name).toBe('Icon/Interaction/Search/Hover Background')
    expect(created[1]!.getPluginData(ICON_VARIABLE_OWNERSHIP_KEY))
      .toBe(`https://example.com|icon-color:hover-background:${data.icons[0]!.id}`)
    expect(created.every(item =>
      item.getPluginData(ICON_VARIABLE_OWNERSHIP_KEY).startsWith('https://example.com|icon-color:')
    )).toBe(true)
    expect(result.applied).toHaveLength(2)
  })

  it('gives repeated semantic icon names stable unique variable names within one batch', () => {
    const repeated = {
      ...data,
      icons: ['a', 'b', 'c'].map(marker => ({
        ...data.icons[0]!,
        id: `sha256:abcdef${marker.repeat(58)}`,
        name: 'Add files and more'
      }))
    }

    const first = createIconVariablePlan(repeated, [], [])
    const second = createIconVariablePlan(repeated, [], [])
    const names = first.entries
      .filter(entry => entry.role === 'hover-background')
      .map(entry => entry.targetName)

    expect(new Set(names).size).toBe(3)
    expect(names.every(name =>
      name.startsWith('Icon/Interaction/Add Files And More/') &&
      name.endsWith('/Hover Background')
    )).toBe(true)
    expect(second.entries.map(entry => entry.targetName))
      .toEqual(first.entries.map(entry => entry.targetName))
  })

  it('does not invent a hover surface from the site-wide interactive color palette', () => {
    const selected = {
      ...data,
      icons: data.icons.map(icon => ({ ...icon, interactionSurfaces: undefined })),
      colors: {
        ...data.colors,
        interactive: [{
          ...data.colors.interactive[0]!,
          name: 'tertiary-selected-background',
          state: 'selected' as const
        }]
      }
    }

    const plan = createIconVariablePlan(selected, [], [])

    expect(plan.entries.find(entry => entry.role === 'hover-background')).toBeUndefined()
  })

  it('does not turn default or pressed evidence into a hover variable', () => {
    const defaultOnly = {
      ...data,
      icons: data.icons.map(icon => ({
        ...icon,
        interactionSurfaces: icon.interactionSurfaces?.map(surface => ({
          ...surface,
          state: 'default' as const
        }))
      }))
    }

    expect(
      createIconVariablePlan(defaultOnly, [], []).entries.find(
        entry => entry.role === 'hover-background'
      )
    ).toBeUndefined()
    expect(
      createIconVariablePlan(defaultOnly, [], []).entries.find(
        entry => entry.role === 'default-background'
      )
    ).toMatchObject({
      role: 'default-background',
      targetName: 'Icon/Interaction/Search/Default Background',
      iconId: data.icons[0]!.id,
      ownershipId:
        `https://example.com|icon-color:default-background:${data.icons[0]!.id}`,
      values: {
        light: data.icons[0]!.interactionSurfaces![0]!.background
      }
    })
  })

  it('does not leak a legacy accessible-name into icon variable names', () => {
    const legacy = {
      ...data,
      icons: data.icons.map(icon => ({
        ...icon,
        name: 'star acme-labs widget-kit',
        nameSource: 'accessible-name' as const
      }))
    }

    const plan = createIconVariablePlan(legacy, [], [])
    const serialized = JSON.stringify(plan.entries)

    expect(plan.entries.find(entry => entry.role === 'hover-background')).toMatchObject({
      targetName: 'Icon/Interaction/Icon 111111/Hover Background'
    })
    expect(serialized).not.toMatch(/acme|widget/i)
  })

  it('creates a stable per-icon accent variable when an icon differs from the theme primary', () => {
    const accentIconId = `sha256:${'4'.repeat(64)}`
    const accent = {
      ...data,
      icons: [
        ...data.icons,
        {
          ...data.icons[0]!,
          id: accentIconId,
          name: 'upgrade',
          themes: [{
            theme: 'light' as const,
            color: { r: 0.17, g: 0.4, b: 0.77, a: 1 },
            occurrences: 2
          }]
        }
      ]
    }

    const plan = createIconVariablePlan(accent, [], [])
    const entry = plan.entries.find(item => item.iconId === accentIconId && item.role === 'accent')

    expect(entry).toMatchObject({
      role: 'accent',
      targetName: 'Icon/Accent/Upgrade',
      ownershipId: `https://example.com|icon-color:accent:${accentIconId}`,
      provenance: 'observed-theme-fallback',
      values: {
        light: { r: 0.17, g: 0.4, b: 0.77, a: 1 },
        dark: { r: 0.17, g: 0.4, b: 0.77, a: 1 }
      }
    })
  })
})
