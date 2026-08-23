import { describe, expect, it, vi } from 'vitest'

import type { ShadowImportPlanEntry } from '../../src/figma/shadow-import-plan'
import {
  applyShadowImportPlan,
  SHADOW_OWNERSHIP_KEY,
  type EffectStylePort
} from '../../src/figma/shadow-style-applier'

function entry(overrides: Partial<ShadowImportPlanEntry> = {}): ShadowImportPlanEntry {
  return {
    action: 'create',
    source: {
      id: `sha256:${'a'.repeat(64)}`,
      name: 'shadow-multi-2-aaaaaa',
      layers: [
        {
          kind: 'outer', offsetX: 0, offsetY: 4, blur: 12, spread: -1,
          color: { r: 0, g: 0, b: 0, a: 0.15 }
        },
        {
          kind: 'inner', offsetX: 0, offsetY: -1, blur: 0, spread: 0,
          color: { r: 1, g: 1, b: 1, a: 0.8 }
        }
      ],
      occurrences: 5
    },
    targetName: 'UI-Anatomist/example.com/shadow-multi-2-aaaaaa',
    ownershipId: `https://example.com|sha256:${'a'.repeat(64)}`,
    existingStyleId: null,
    conflictName: null,
    ...overrides
  }
}

function fakeStyle(id = 'effect:new'): EffectStylePort {
  const data = new Map<string, string>()
  return {
    id,
    name: 'Before',
    description: 'Before description',
    effects: [],
    setPluginData: (key, value) => data.set(key, value),
    getPluginData: key => data.get(key) ?? '',
    remove: vi.fn()
  }
}

describe('applyShadowImportPlan', () => {
  it('creates a real ordered multi-layer effect style', async () => {
    const created = fakeStyle()
    const result = await applyShadowImportPlan([entry()], {
      createEffectStyle: () => created,
      getEffectStyleById: async () => null
    })

    expect(created.effects).toEqual([
      {
        type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
        color: { r: 0, g: 0, b: 0, a: 0.15 },
        offset: { x: 0, y: 4 }, radius: 12, spread: -1
      },
      {
        type: 'INNER_SHADOW', visible: true, blendMode: 'NORMAL',
        color: { r: 1, g: 1, b: 1, a: 0.8 },
        offset: { x: 0, y: -1 }, radius: 0, spread: 0
      }
    ])
    expect(created.description).toContain('2 layers')
    expect(created.description).toContain('5 occurrences')
    expect(created.getPluginData(SHADOW_OWNERSHIP_KEY)).toBe(entry().ownershipId)
    expect(result.created).toEqual([created])
  })

  it('updates an owned effect style in place and reports protected-name conflicts', async () => {
    const existing = fakeStyle('effect:owned')
    const result = await applyShadowImportPlan([entry({
      action: 'update',
      existingStyleId: existing.id,
      conflictName: 'UI-Anatomist/example.com/user-shadow'
    })], {
      createEffectStyle: () => fakeStyle(),
      getEffectStyleById: async id => id === existing.id ? existing : null
    })

    expect(result.updated).toEqual([existing])
    expect(result.conflicts).toEqual(['UI-Anatomist/example.com/user-shadow'])
    expect(existing.name).toBe(entry().targetName)
  })

  it('removes all styles created in the failed batch', async () => {
    const first = fakeStyle('effect:first')
    const second = fakeStyle('effect:second')
    Object.defineProperty(second, 'effects', {
      get: () => [],
      set: () => { throw new Error('Figma rejected effects') }
    })
    const queue = [first, second]

    await expect(applyShadowImportPlan([
      entry(),
      entry({ source: { ...entry().source, id: `sha256:${'b'.repeat(64)}` } })
    ], {
      createEffectStyle: () => queue.shift()!,
      getEffectStyleById: async () => null
    })).rejects.toThrow('Figma rejected effects')

    expect(first.remove).toHaveBeenCalledOnce()
    expect(second.remove).toHaveBeenCalledOnce()
  })

  it('restores an existing style when a later update fails', async () => {
    const first = fakeStyle('effect:first')
    first.effects = [{
      type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
      color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0
    }]
    const second = fakeStyle('effect:second')
    Object.defineProperty(second, 'description', {
      get: () => 'Second before',
      set: () => { throw new Error('Figma rejected description') }
    })

    await expect(applyShadowImportPlan([
      entry({ action: 'update', existingStyleId: first.id }),
      entry({ action: 'update', existingStyleId: second.id })
    ], {
      createEffectStyle: () => fakeStyle(),
      getEffectStyleById: async id => id === first.id ? first : second
    })).rejects.toThrow('Figma rejected description')

    expect(first.name).toBe('Before')
    expect(first.description).toBe('Before description')
    expect(first.effects).toHaveLength(1)
  })
})
