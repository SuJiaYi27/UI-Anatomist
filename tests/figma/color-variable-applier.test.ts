import { describe, expect, it, vi } from 'vitest'
import type { ScanExport } from '../../src/shared/schema'
import { createColorImportPlan } from '../../src/figma/color-import-plan'
import {
  applyColorImportPlan,
  COLOR_COLLECTION_OWNERSHIP_KEY,
  COLOR_SHARED_NAMESPACE,
  COLOR_VARIABLE_OWNERSHIP_KEY,
  readColorOwnership,
  type ColorCollectionPort,
  type ColorVariablePort
} from '../../src/figma/color-variable-applier'

const primitiveId = `sha256:${'1'.repeat(64)}`
const data: ScanExport = {
  schemaVersion: '1.3.0',
  source: {
    siteLabel: 'example.com', origin: 'https://example.com',
    scannedAt: '2026-07-22T12:00:00.000Z', locale: 'zh-CN', platform: 'macOS'
  },
  typography: [], borderRadii: [], shadows: [],
  colors: {
    primitives: [{
      id: primitiveId, name: 'neutral-100', value: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      family: 'neutral', step: 100, provenance: 'inferred', occurrences: 0
    }],
    semantic: [{
      id: `sha256:${'2'.repeat(64)}`, name: 'background-primary', group: 'background',
      value: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, primitiveId,
      provenance: 'observed', occurrences: 4
    }],
    interactive: [{
      id: `sha256:${'3'.repeat(64)}`, name: 'primary-hover-background',
      intent: 'primary', state: 'hover', usage: 'background',
      value: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, primitiveId,
      provenance: 'declared', occurrences: 1
    }]
  },
  traversal: { visitedStates: 1, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

function pluginDataPort() {
  const values = new Map<string, string>()
  const sharedValues = new Map<string, string>()
  return {
    setPluginData: (key: string, value: string) => values.set(key, value),
    getPluginData: (key: string) => values.get(key) ?? '',
    setSharedPluginData: (namespace: string, key: string, value: string) =>
      sharedValues.set(`${namespace}|${key}`, value),
    getSharedPluginData: (namespace: string, key: string) =>
      sharedValues.get(`${namespace}|${key}`) ?? ''
  }
}

function collection(id = 'collection:new'): ColorCollectionPort {
  return {
    id, name: '', defaultModeId: 'mode:1', renameMode: vi.fn(), remove: vi.fn(), ...pluginDataPort()
  }
}

function variable(id: string): ColorVariablePort {
  return {
    id, name: '', description: '', resolvedType: 'COLOR', scopes: [], valuesByMode: {}, codeSyntax: {},
    setValueForMode: vi.fn(), setVariableCodeSyntax: vi.fn(), removeVariableCodeSyntax: vi.fn(),
    remove: vi.fn(), ...pluginDataPort()
  }
}

describe('applyColorImportPlan', () => {
  it('creates Primitive RGBA then aliases Semantic and Interactive variables', async () => {
    const createdCollection = collection()
    const created = [variable('variable:primitive'), variable('variable:semantic'), variable('variable:interactive')]
    const createVariable = vi.fn()
      .mockReturnValueOnce(created[0])
      .mockReturnValueOnce(created[1])
      .mockReturnValueOnce(created[2])

    const result = await applyColorImportPlan(createColorImportPlan(data, [], []), {
      createCollection: () => createdCollection,
      createVariable,
      getVariableById: async () => null
    })

    expect(createdCollection.name).toBe('UI-Anatomist / example.com / Colors')
    expect(createdCollection.renameMode).toHaveBeenCalledWith('mode:1', 'Default')
    expect(createdCollection.getPluginData(COLOR_COLLECTION_OWNERSHIP_KEY)).toBe('https://example.com')
    expect(createdCollection.getSharedPluginData?.(
      COLOR_SHARED_NAMESPACE,
      COLOR_COLLECTION_OWNERSHIP_KEY
    )).toBe('https://example.com')
    expect(created[0]!.setValueForMode).toHaveBeenCalledWith('mode:1', {
      r: 0.9, g: 0.9, b: 0.9, a: 1
    })
    expect(created[1]!.setValueForMode).toHaveBeenCalledWith('mode:1', {
      type: 'VARIABLE_ALIAS', id: 'variable:primitive'
    })
    expect(created[2]!.setValueForMode).toHaveBeenCalledWith('mode:1', {
      type: 'VARIABLE_ALIAS', id: 'variable:primitive'
    })
    expect(created[0]!.description).toContain('inferred')
    expect(created[1]!.description).toContain('observed')
    expect(created[2]!.description).toContain('declared')
    expect(created.every(item => item.getPluginData(COLOR_VARIABLE_OWNERSHIP_KEY).startsWith('https://example.com|'))).toBe(true)
    expect(created.every(item => item.getSharedPluginData?.(
      COLOR_SHARED_NAMESPACE,
      COLOR_VARIABLE_OWNERSHIP_KEY
    ).startsWith('https://example.com|'))).toBe(true)
    expect(result.applied).toHaveLength(3)
    expect(result.conflicts).toEqual([])
  })

  it('reads shared web ownership when private plugin data is unavailable', () => {
    const item = variable('variable:web')
    item.setSharedPluginData?.(
      COLOR_SHARED_NAMESPACE,
      COLOR_VARIABLE_OWNERSHIP_KEY,
      `https://example.com|${primitiveId}`
    )
    expect(readColorOwnership(item, COLOR_VARIABLE_OWNERSHIP_KEY))
      .toBe(`https://example.com|${primitiveId}`)
  })

  it('removes newly created variables and collection when an alias write fails', async () => {
    const createdCollection = collection()
    const primitive = variable('variable:primitive')
    const semantic = variable('variable:semantic')
    semantic.setValueForMode = () => { throw new Error('Figma rejected alias') }
    const createVariable = vi.fn().mockReturnValueOnce(primitive).mockReturnValueOnce(semantic)

    await expect(applyColorImportPlan(createColorImportPlan({
      ...data,
      colors: { ...data.colors, interactive: [] }
    }, [], []), {
      createCollection: () => createdCollection,
      createVariable,
      getVariableById: async () => null
    })).rejects.toThrow('alias')

    expect(primitive.remove).toHaveBeenCalledOnce()
    expect(semantic.remove).toHaveBeenCalledOnce()
    expect(createdCollection.remove).toHaveBeenCalledOnce()
  })

  it('updates an owned COLOR variable in place', async () => {
    const ownedCollection = {
      id: 'collection:owned', name: 'UI-Anatomist / example.com / Colors',
      defaultModeId: 'mode:owned', ownershipOrigin: 'https://example.com'
    }
    const ownedVariable = variable('variable:owned')
    const primitiveOnly = structuredClone(data)
    primitiveOnly.colors.semantic = []
    primitiveOnly.colors.interactive = []
    const plan = createColorImportPlan(primitiveOnly, [ownedCollection], [{
      id: ownedVariable.id, name: 'Primitive/neutral/neutral-100', collectionId: ownedCollection.id,
      resolvedType: 'COLOR', ownershipId: `https://example.com|${primitiveId}`
    }])
    const result = await applyColorImportPlan(plan, {
      createCollection: vi.fn(), createVariable: vi.fn(),
      getVariableById: async id => id === ownedVariable.id ? ownedVariable : null
    })

    expect(result.updated).toEqual([ownedVariable])
    expect(ownedVariable.setValueForMode).toHaveBeenCalledWith('mode:owned', data.colors.primitives[0]!.value)
  })
})
