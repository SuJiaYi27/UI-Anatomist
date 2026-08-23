import { describe, expect, it, vi } from 'vitest'
import type { ScanExport } from '../../src/shared/schema'
import { createSpacingImportPlan } from '../../src/figma/spacing-import-plan'
import {
  applySpacingImportPlan,
  SPACING_COLLECTION_OWNERSHIP_KEY,
  SPACING_VARIABLE_OWNERSHIP_KEY,
  type SpacingCollectionPort,
  type SpacingVariablePort
} from '../../src/figma/spacing-variable-applier'

const data: ScanExport = {
  schemaVersion: '1.4.0',
  source: {
    siteLabel: 'example.com', origin: 'https://example.com',
    scannedAt: '2026-07-23T12:00:00.000Z', locale: 'zh-CN', platform: 'macOS'
  },
  typography: [],
  borderRadii: [],
  shadows: [],
  colors: { primitives: [], semantic: [], interactive: [] },
  spacing: [{
    id: `sha256:${'1'.repeat(64)}`,
    name: 'spacing-8',
    value: 8,
    occurrences: 3,
    evidence: { padding: 2, gap: 1, margin: 0 },
    stateOccurrences: 2
  }],
  traversal: { visitedStates: 2, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
  filtered: { brandAssets: 0, personalTextNodes: 0 }
}

function pluginDataPort() {
  const values = new Map<string, string>()
  return {
    setPluginData: (key: string, value: string) => values.set(key, value),
    getPluginData: (key: string) => values.get(key) ?? ''
  }
}

function collection(id = 'collection:new'): SpacingCollectionPort {
  return {
    id, name: '', defaultModeId: 'mode:1',
    renameMode: vi.fn(), remove: vi.fn(), ...pluginDataPort()
  }
}

function variable(id = 'variable:new'): SpacingVariablePort {
  return {
    id, name: '', description: '', resolvedType: 'FLOAT', scopes: [],
    codeSyntax: {}, setValueForMode: vi.fn(), setVariableCodeSyntax: vi.fn(),
    removeVariableCodeSyntax: vi.fn(), remove: vi.fn(), ...pluginDataPort()
  }
}

describe('applySpacingImportPlan', () => {
  it('creates GAP-scoped FLOAT variables with Web syntax and ownership', async () => {
    const createdCollection = collection()
    const createdVariable = variable()
    const result = await applySpacingImportPlan(createSpacingImportPlan(data, [], []), {
      createCollection: () => createdCollection,
      createVariable: () => createdVariable,
      getVariableById: async () => null
    })

    expect(createdCollection.name).toBe('UI-Anatomist / example.com / Spacing')
    expect(createdCollection.getPluginData(SPACING_COLLECTION_OWNERSHIP_KEY))
      .toBe('https://example.com')
    expect(createdVariable.name).toBe('Spacing/8')
    expect(createdVariable.scopes).toEqual(['GAP'])
    expect(createdVariable.setValueForMode).toHaveBeenCalledWith('mode:1', 8)
    expect(createdVariable.setVariableCodeSyntax).toHaveBeenCalledWith(
      'WEB',
      'var(--ui-anatomist-spacing-8)'
    )
    expect(createdVariable.getPluginData(SPACING_VARIABLE_OWNERSHIP_KEY))
      .toBe(`https://example.com|${data.spacing[0]!.id}`)
    expect(result.applied).toHaveLength(1)
  })

  it('updates an owned variable in place', async () => {
    const ownedVariable = variable('variable:owned')
    const ownedCollection = {
      id: 'collection:owned',
      name: 'UI-Anatomist / example.com / Spacing',
      defaultModeId: 'mode:owned',
      ownershipOrigin: 'https://example.com'
    }
    const plan = createSpacingImportPlan(data, [ownedCollection], [{
      id: ownedVariable.id,
      name: 'Spacing/8',
      collectionId: ownedCollection.id,
      resolvedType: 'FLOAT',
      ownershipId: `https://example.com|${data.spacing[0]!.id}`
    }])
    const result = await applySpacingImportPlan(plan, {
      createCollection: vi.fn(),
      createVariable: vi.fn(),
      getVariableById: async () => ownedVariable
    })
    expect(result.updated).toEqual([ownedVariable])
    expect(ownedVariable.setValueForMode).toHaveBeenCalledWith('mode:owned', 8)
  })
})
