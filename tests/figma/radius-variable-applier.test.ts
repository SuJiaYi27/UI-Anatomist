import { describe, expect, it, vi } from 'vitest'

import type { ScanExport } from '../../src/shared/schema'
import { createRadiusImportPlan } from '../../src/figma/radius-import-plan'
import {
  applyRadiusImportPlan,
  RADIUS_COLLECTION_OWNERSHIP_KEY,
  RADIUS_VARIABLE_OWNERSHIP_KEY,
  type RadiusCollectionPort,
  type RadiusVariablePort
} from '../../src/figma/radius-variable-applier'

const data: ScanExport = {
  schemaVersion: '1.1.0',
  source: {
    siteLabel: 'example.com', origin: 'https://example.com', scannedAt: '2026-07-21T12:00:00.000Z',
    locale: 'zh-CN', platform: 'macOS'
  },
  typography: [],
  borderRadii: [
    { id: `sha256:${'1'.repeat(64)}`, name: 'radius-8', kind: 'px', value: 8, occurrences: 4 },
    { id: `sha256:${'2'.repeat(64)}`, name: 'radius-25-percent', kind: 'percent', value: 25, occurrences: 2 },
    { id: `sha256:${'3'.repeat(64)}`, name: 'radius-full', kind: 'full', value: null, occurrences: 8 }
  ],
  traversal: { visitedStates: 1, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

function pluginDataPort() {
  const values = new Map<string, string>()
  return {
    setPluginData: (key: string, value: string) => values.set(key, value),
    getPluginData: (key: string) => values.get(key) ?? ''
  }
}

function collection(id = 'collection:new'): RadiusCollectionPort {
  return {
    id, name: '', defaultModeId: 'mode:1', renameMode: vi.fn(), remove: vi.fn(), ...pluginDataPort()
  }
}

function variable(id = 'variable:new'): RadiusVariablePort {
  return {
    id, name: '', description: '', resolvedType: 'FLOAT', scopes: [],
    codeSyntax: {}, setValueForMode: vi.fn(), setVariableCodeSyntax: vi.fn(),
    removeVariableCodeSyntax: vi.fn(), remove: vi.fn(), ...pluginDataPort()
  }
}

describe('applyRadiusImportPlan', () => {
  it('creates only px/full FLOAT variables, including a numeric full value', async () => {
    const createdCollection = collection()
    const createdVariables = [variable('variable:8'), variable('variable:full')]
    const createVariable = vi.fn()
      .mockReturnValueOnce(createdVariables[0])
      .mockReturnValueOnce(createdVariables[1])
    const result = await applyRadiusImportPlan(createRadiusImportPlan(data, [], []), {
      createCollection: () => createdCollection,
      createVariable,
      getVariableById: async () => null
    })

    expect(createdCollection.name).toBe('UI-Anatomist / example.com / Border Radii')
    expect(createdCollection.renameMode).toHaveBeenCalledWith('mode:1', 'Default')
    expect(createdCollection.getPluginData(RADIUS_COLLECTION_OWNERSHIP_KEY)).toBe('https://example.com')
    expect(createdVariables.map(item => item.scopes)).toEqual([['CORNER_RADIUS'], ['CORNER_RADIUS']])
    expect(createdVariables[0].setValueForMode).toHaveBeenCalledWith('mode:1', 8)
    expect(createdVariables[1].setValueForMode).toHaveBeenCalledWith('mode:1', 9999)
    expect(createdVariables[0].setVariableCodeSyntax).toHaveBeenCalledWith(
      'WEB',
      'var(--ui-anatomist-radius-8)'
    )
    expect(createdVariables[1].setVariableCodeSyntax).toHaveBeenCalledWith(
      'WEB',
      'var(--ui-anatomist-radius-full)'
    )
    expect(createdVariables[0].getPluginData(RADIUS_VARIABLE_OWNERSHIP_KEY)).toContain('https://example.com|sha256:')
    expect(result.skippedPercent).toEqual(['Radius/25%'])
    expect(result.applied).toHaveLength(2)
  })

  it('does not create a collection when the scan contains percentages only', async () => {
    const percentOnly = structuredClone(data)
    percentOnly.borderRadii = [data.borderRadii[1]]
    const createCollection = vi.fn()
    const result = await applyRadiusImportPlan(createRadiusImportPlan(percentOnly, [], []), {
      createCollection,
      createVariable: vi.fn(),
      getVariableById: vi.fn()
    })

    expect(createCollection).not.toHaveBeenCalled()
    expect(result.applied).toEqual([])
    expect(result.skippedPercent).toEqual(['Radius/25%'])
  })

  it('updates an owned variable in place', async () => {
    const ownedCollection = {
      id: 'collection:owned', name: 'UI-Anatomist / example.com / Border Radii',
      defaultModeId: 'mode:owned', ownershipOrigin: 'https://example.com'
    }
    const ownedVariable = variable('variable:owned')
    const oneToken = structuredClone(data)
    oneToken.borderRadii = [data.borderRadii[0]]
    const plan = createRadiusImportPlan(oneToken, [ownedCollection], [{
      id: ownedVariable.id, name: 'Radius/8', collectionId: ownedCollection.id,
      resolvedType: 'FLOAT', ownershipId: `https://example.com|${data.borderRadii[0].id}`
    }])
    const result = await applyRadiusImportPlan(plan, {
      createCollection: vi.fn(), createVariable: vi.fn(),
      getVariableById: async id => id === ownedVariable.id ? ownedVariable : null
    })

    expect(result.updated).toEqual([ownedVariable])
    expect(ownedVariable.setValueForMode).toHaveBeenCalledWith('mode:owned', 8)
  })

  it('removes a newly-created collection if collection setup fails', async () => {
    const createdCollection = collection()
    createdCollection.renameMode = () => { throw new Error('Figma rejected the mode name') }

    await expect(applyRadiusImportPlan(createRadiusImportPlan(data, [], []), {
      createCollection: () => createdCollection,
      createVariable: vi.fn(),
      getVariableById: vi.fn()
    })).rejects.toThrow('mode name')
    expect(createdCollection.remove).toHaveBeenCalledOnce()
  })
})
