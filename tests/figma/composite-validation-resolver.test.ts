import { describe, expect, it } from 'vitest'

import { resolveAppliedCompositeNodes } from '../../src/figma/composite-validation-resolver'
import {
  COMPOSITE_GROUP_OWNERSHIP_KEY,
  COMPOSITE_NODE_OWNERSHIP_KEY,
  COMPOSITE_SHARED_NAMESPACE
} from '../../src/figma/composite-component-applier'
import type { CompositeToken, ControlToken, ScanExport } from '../../src/shared/schema'

const origin = 'https://example.com'
const id = (character: string) => `sha256:${character.repeat(64)}`

function control(): ControlToken {
  return {
    id: id('1'),
    groupId: id('2'),
    templateId: id('3'),
    logicalControlId: id('4'),
    instanceId: id('5'),
    name: 'button-tertiary-sm',
    family: 'button', state: 'default', intent: 'tertiary', size: 'sm',
    geometry: {
      height: 32, minWidth: 120,
      padding: { top: 6, right: 8, bottom: 6, left: 8 },
      gap: 4, radius: 6, borderWidth: 0
    },
    appearance: {
      background: { r: 0, g: 0, b: 0, a: 0 },
      foreground: { r: 0, g: 0, b: 0, a: 1 },
      border: { r: 0, g: 0, b: 0, a: 0 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0, outlineOffset: 0, shadows: []
    },
    typography: {
      fontFamilyStack: ['Arial'], fontStyle: 'normal', fontSizePx: 14,
      fontWeight: 400, lineHeightPx: 20, letterSpacingPx: 0
    },
    slots: { leading: null, trailing: null },
    content: { kind: 'text-only' },
    layout: { widthBehavior: 'fill' },
    sampleText: { value: 'Local', source: 'visible-text' },
    occurrences: 1, stateOccurrences: 1
  }
}

function composite(source: ControlToken): CompositeToken {
  return {
    id: id('6'), templateId: id('7'), logicalCompositeId: id('8'),
    name: 'panel-vertical', kind: 'panel', state: 'default',
    geometry: {
      width: 136, height: 48,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 0, radius: 8, borderWidth: 1
    },
    appearance: {
      background: { r: 1, g: 1, b: 1, a: 1 },
      foreground: { r: 0, g: 0, b: 0, a: 1 },
      border: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0, outlineOffset: 0, shadows: []
    },
    layout: {
      direction: 'vertical', align: 'stretch', justify: 'start',
      wrap: false, widthBehavior: 'hug'
    },
    children: [{
      kind: 'control', controlId: source.id,
      instanceId: source.instanceId!, state: source.state
    }],
    occurrences: 1, stateOccurrences: 1
  }
}

function ownedNode(
  nodeId: string,
  ownershipKey: string,
  ownershipValue: string,
  parent: unknown = null
) {
  return {
    id: nodeId,
    type: 'COMPONENT',
    name: nodeId,
    parent,
    getPluginData(key: string) {
      return key === ownershipKey ? ownershipValue : ''
    },
    getSharedPluginData(namespace: string, key: string) {
      return namespace === COMPOSITE_SHARED_NAMESPACE && key === ownershipKey
        ? ownershipValue
        : ''
    }
  }
}

describe('resolveAppliedCompositeNodes', () => {
  it('reconnects owned Component Set children to fixed JSON evidence without replanning', () => {
    const atomic = control()
    const shell = composite(atomic)
    const data = {
      schemaVersion: '1.9.0',
      source: {
        siteLabel: 'example.com', origin,
        scannedAt: '2026-08-11T00:00:00.000Z', locale: 'en', platform: 'macOS'
      },
      typography: [], borderRadii: [], shadows: [],
      colors: { primitives: [], semantic: [], interactive: [] },
      spacing: [], controls: [atomic], composites: [shell], icons: [],
      traversal: {
        visitedStates: 1, skippedUnsafe: 0, skippedUncertain: 0, failures: 0
      },
      filtered: { brandAssets: 0, personalTextNodes: 0 }
    } as ScanExport
    const groupOwnership = `${origin}|composite-group:${id('9')}`
    const componentSet = {
      id: 'set:1', type: 'COMPONENT_SET', name: 'Composite/Panel',
      getPluginData: (key: string) =>
        key === COMPOSITE_GROUP_OWNERSHIP_KEY ? groupOwnership : '',
      getSharedPluginData: () => ''
    }
    const component = ownedNode(
      'component:1',
      COMPOSITE_NODE_OWNERSHIP_KEY,
      `${origin}|composite:${shell.id}`,
      componentSet
    )
    const foreign = ownedNode(
      'component:foreign',
      COMPOSITE_NODE_OWNERSHIP_KEY,
      `https://other.example|composite:${shell.id}`
    )

    const applied = resolveAppliedCompositeNodes(data, [component, foreign])

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      component,
      componentSet,
      group: { groupId: groupOwnership },
      entry: {
        source: { id: shell.id },
        children: [{ kind: 'control', source: { id: atomic.id } }]
      }
    })
  })
})
