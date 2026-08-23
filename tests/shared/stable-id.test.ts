import { describe, expect, it } from 'vitest'
import type { CompositeSignature, ControlSignature } from '../../src/shared/stable-id'
import {
  stableBorderRadiusId,
  stableControlGroupId,
  stableControlId,
  stableControlInstanceId,
  stableControlLogicalId,
  stableControlTemplateId,
  stableCompositeId,
  stableCompositeTemplateId,
  stableIconId,
  stableInteractiveColorId,
  stablePrimitiveColorId,
  stableSemanticColorId,
  stableShadowId,
  stableSpacingId,
  stableTypographyId
} from '../../src/shared/stable-id'

describe('stable composite IDs', () => {
  const composite: CompositeSignature = {
    kind: 'menu',
    state: 'default',
    logicalCompositeId: `sha256:${'1'.repeat(64)}`,
    geometry: {
      width: 240,
      height: 104,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 4,
      radius: 12,
      borderWidth: 1
    },
    appearance: {
      background: { r: 1, g: 1, b: 1, a: 1 },
      foreground: { r: 0, g: 0, b: 0, a: 1 },
      border: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    layout: {
      direction: 'vertical', align: 'stretch', justify: 'start',
      wrap: false, widthBehavior: 'hug'
    },
    childTemplateIds: [`sha256:${'2'.repeat(64)}`],
    childInstanceIds: [`sha256:${'3'.repeat(64)}`]
  }

  it('keeps legacy IDs stable without placement and separates measured arrangements', async () => {
    const legacyTemplate = await stableCompositeTemplateId(composite)
    const legacyInstance = await stableCompositeId(composite)
    const placed = {
      ...composite,
      childPlacements: [{ x: 8, y: 8, width: 224, height: 40 }]
    }
    expect(await stableCompositeTemplateId(placed)).not.toBe(legacyTemplate)
    expect(await stableCompositeId(placed)).not.toBe(legacyInstance)
    expect(await stableCompositeTemplateId({
      ...placed,
      childPlacements: [{ x: 8.1, y: 8, width: 224, height: 40 }]
    })).toBe(await stableCompositeTemplateId(placed))
  })

  it('separates composite template and instance IDs for an inline static text region', async () => {
    const staticRegion = {
      templateId: `sha256:${'4'.repeat(64)}`,
      instanceId: `sha256:${'5'.repeat(64)}`,
      placement: { x: 0, y: 0, width: 240, height: 48 }
    }
    const withRegion = {
      ...composite,
      staticTextRegions: [staticRegion]
    } as CompositeSignature

    expect(await stableCompositeTemplateId(withRegion)).not.toBe(
      await stableCompositeTemplateId(composite)
    )
    expect(await stableCompositeId({
      ...withRegion,
      staticTextRegions: [{
        ...staticRegion,
        instanceId: `sha256:${'6'.repeat(64)}`
      }]
    } as CompositeSignature)).not.toBe(await stableCompositeId(withRegion))
  })
})

describe('stableTypographyId', () => {
  it('ignores family quoting and casing', async () => {
    const first = await stableTypographyId({
      fontFamilyStack: ['"System-UI"'],
      fontStyle: 'normal',
      fontSizePx: 16,
      fontWeight: 400,
      lineHeightPx: 24,
      letterSpacingPx: 0
    })
    const second = await stableTypographyId({
      fontFamilyStack: ['system-ui'],
      fontStyle: 'normal',
      fontSizePx: 16,
      fontWeight: 400,
      lineHeightPx: 24,
      letterSpacingPx: 0
    })
    expect(first).toBe(second)
  })

  it('changes when a design value changes', async () => {
    const base = {
      fontFamilyStack: ['system-ui'],
      fontStyle: 'normal',
      fontSizePx: 16,
      fontWeight: 400,
      lineHeightPx: 24,
      letterSpacingPx: 0
    }
    expect(await stableTypographyId(base)).not.toBe(await stableTypographyId({ ...base, fontSizePx: 18 }))
  })
})

describe('stableBorderRadiusId', () => {
  it('uses only the normalized radius kind and value', async () => {
    const first = await stableBorderRadiusId({ kind: 'px', value: 8 })
    const second = await stableBorderRadiusId({ kind: 'px', value: 8.0 })
    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('keeps full distinct from a numeric radius', async () => {
    expect(await stableBorderRadiusId({ kind: 'full', value: null }))
      .not.toBe(await stableBorderRadiusId({ kind: 'px', value: 9999 }))
  })
})

describe('stableShadowId', () => {
  const firstLayer = {
    kind: 'outer' as const,
    offsetX: 0,
    offsetY: 4,
    blur: 12,
    spread: 0,
    color: { r: 0, g: 0, b: 0, a: 0.1 }
  }
  const secondLayer = {
    kind: 'inner' as const,
    offsetX: 0,
    offsetY: -1,
    blur: 0,
    spread: 0,
    color: { r: 1, g: 1, b: 1, a: 0.2 }
  }

  it('uses the complete ordered layer signature', async () => {
    const id = await stableShadowId({ layers: [firstLayer, secondLayer] })
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(id).not.toBe(await stableShadowId({ layers: [secondLayer, firstLayer] }))
  })

  it('ignores fields outside the visual signature', async () => {
    expect(await stableShadowId({ layers: [firstLayer] }))
      .toBe(await stableShadowId({ layers: [{ ...firstLayer }] }))
  })
})

describe('stable color IDs', () => {
  const value = { r: 0.25, g: 0.5, b: 0.75, a: 0.8 }

  it('uses only normalized RGBA for primitive identity', async () => {
    const first = await stablePrimitiveColorId(value)
    const second = await stablePrimitiveColorId({ ...value })
    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first).not.toBe(await stablePrimitiveColorId({ ...value, a: 1 }))
  })

  it('keeps semantic roles and interactive states distinct', async () => {
    expect(await stableSemanticColorId({ name: 'primary', group: 'background', value }))
      .not.toBe(await stableSemanticColorId({ name: 'primary', group: 'text', value }))
    expect(await stableInteractiveColorId({
      intent: 'primary', state: 'hover', usage: 'background', value
    })).not.toBe(await stableInteractiveColorId({
      intent: 'primary', state: 'pressed', usage: 'background', value
    }))
  })

  it('normalizes semantic names before hashing', async () => {
    expect(await stableSemanticColorId({ name: ' Background Primary ', group: 'background', value }))
      .toBe(await stableSemanticColorId({ name: 'background-primary', group: 'background', value }))
  })
})

describe('stableSpacingId', () => {
  it('uses only the normalized spacing value', async () => {
    const first = await stableSpacingId({ value: 8 })
    const second = await stableSpacingId({ value: 8.0 })
    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('changes when the spacing value changes', async () => {
    expect(await stableSpacingId({ value: 8 }))
      .not.toBe(await stableSpacingId({ value: 12 }))
  })
})

describe('stable control IDs', () => {
  const base = {
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
      fontFamilyStack: ['"Arial"'],
      fontStyle: 'normal',
      fontSizePx: 14,
      fontWeight: 400,
      lineHeightPx: 20,
      letterSpacingPx: 0
    },
    slots: { leading: null, trailing: null }
  }

  it('uses state and appearance for the full token ID', async () => {
    const first = await stableControlId(base)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first).not.toBe(await stableControlId({
      ...base,
      state: 'hover',
      appearance: {
        ...base.appearance,
        background: { r: 0.1, g: 0.1, b: 0.1, a: 1 }
      }
    }))
  })

  it('joins observed states by a state-independent structural group ID', async () => {
    const first = await stableControlGroupId(base)
    const hover = await stableControlGroupId({
      ...base,
      state: 'hover',
      appearance: {
        ...base.appearance,
        background: { r: 0.1, g: 0.1, b: 0.1, a: 1 }
      }
    })
    expect(first).toBe(hover)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('separates template, logical control, and safe content instance identity', async () => {
    const templateId = await stableControlTemplateId(base)
    const logicalControlId = await stableControlLogicalId({
      pageScope: 'sha256:page',
      structuralLocator: 'button:0>menu:0'
    })
    const sameLogicalControlId = await stableControlLogicalId({
      pageScope: 'sha256:page',
      structuralLocator: 'button:0>menu:0'
    })
    const otherLogicalControlId = await stableControlLogicalId({
      pageScope: 'sha256:page',
      structuralLocator: 'button:1>menu:0'
    })
    const searchInstance = await stableControlInstanceId({
      templateId,
      logicalControlId,
      sampleText: 'Search the web',
      supportingText: null,
      leadingIconId: 'sha256:search',
      trailingIconId: null
    })
    const createInstance = await stableControlInstanceId({
      templateId,
      logicalControlId,
      sampleText: 'Create an image',
      supportingText: null,
      leadingIconId: 'sha256:image',
      trailingIconId: null
    })

    expect(templateId).toBe(await stableControlGroupId(base))
    expect(logicalControlId).toBe(sameLogicalControlId)
    expect(logicalControlId).not.toBe(otherLogicalControlId)
    expect(searchInstance).not.toBe(createInstance)
  })

  it('keeps structurally different controls in different groups', async () => {
    expect(await stableControlGroupId(base)).not.toBe(await stableControlGroupId({
      ...base,
      geometry: { ...base.geometry, height: 48 }
    }))
  })

  it('keeps legacy layout identity and separates measured content alignment', async () => {
    const legacy = await stableControlGroupId({
      ...base,
      layout: { widthBehavior: 'fill' }
    })
    const copiedLegacy = await stableControlGroupId({
      ...base,
      layout: { widthBehavior: 'fill' }
    })
    const start = await stableControlGroupId({
      ...base,
      layout: { widthBehavior: 'fill', contentAlignment: 'start' }
    })
    const center = await stableControlGroupId({
      ...base,
      layout: { widthBehavior: 'fill', contentAlignment: 'center' }
    })

    expect(copiedLegacy).toBe(legacy)
    expect(start).not.toBe(legacy)
    expect(center).not.toBe(start)
  })

  it('keeps asymmetric border geometry distinct without changing legacy uniform signatures', async () => {
    const legacyId = await stableControlId(base)
    const copiedLegacyId = await stableControlId({
      ...base,
      geometry: { ...base.geometry }
    })
    const underlineId = await stableControlId({
      ...base,
      geometry: {
        ...base.geometry,
        borderWidth: 1,
        borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
      }
    })

    expect(copiedLegacyId).toBe(legacyId)
    expect(underlineId).not.toBe(legacyId)
  })

  it('keeps compound input shells with different action groups separate', async () => {
    const compound: ControlSignature = {
      ...base,
      family: 'input',
      content: { kind: 'compound-input' },
      layout: { widthBehavior: 'fill' },
      slotGroups: {
        leading: [{
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          surface: {
            width: 36,
            height: 36,
            background: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
            foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
            border: { r: 0, g: 0, b: 0, a: 0 },
            borderWidth: 0,
            radii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 }
          }
        }],
        trailing: [{
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          surface: {
            width: 32,
            height: 32,
            background: { r: 0, g: 0, b: 0, a: 0 },
            foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
            border: { r: 0, g: 0, b: 0, a: 0 },
            borderWidth: 0,
            radii: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 }
          }
        }]
      }
    }
    const slotGroups = compound.slotGroups
    if (!slotGroups) {
      throw new Error('compound control fixture is missing slot groups')
    }
    const modifiedCompound: ControlSignature = {
      ...compound,
      slotGroups: {
        leading: slotGroups.leading,
        trailing: [
          ...slotGroups.trailing,
          {
            width: 20,
            height: 20,
            assetType: 'ui-icon',
            surface: {
              width: 40,
              height: 40,
              background: { r: 0, g: 0, b: 0, a: 1 },
              foreground: { r: 1, g: 1, b: 1, a: 1 },
              border: { r: 0, g: 0, b: 0, a: 0 },
              borderWidth: 0,
              radii: { topLeft: 20, topRight: 20, bottomRight: 20, bottomLeft: 20 }
            }
          }
        ]
      }
    }
    expect(await stableControlGroupId(compound)).not.toBe(await stableControlGroupId(modifiedCompound))
  })

  it('ignores action surface colors but keeps its geometry in the group signature', async () => {
    const baseSlot = {
      width: 20,
      height: 20,
      assetType: 'ui-icon' as const,
      surface: {
        width: 36,
        height: 36,
        background: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
        foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        borderWidth: 0,
        radii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 }
      }
    }
    const withSlot = {
      ...base,
      slots: { leading: baseSlot, trailing: null }
    }
    expect(await stableControlGroupId(withSlot)).toBe(await stableControlGroupId({
      ...withSlot,
      slots: {
        leading: {
          ...baseSlot,
          surface: {
            ...baseSlot.surface,
            background: { r: 0.2, g: 0.2, b: 0.2, a: 1 }
          }
        },
        trailing: null
      }
    }))
    expect(await stableControlGroupId(withSlot)).not.toBe(await stableControlGroupId({
      ...withSlot,
      slots: {
        leading: {
          ...baseSlot,
          surface: {
            ...baseSlot.surface,
            radii: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 }
          }
        },
        trailing: null
      }
    }))
  })

  it('normalizes font family quoting and casing', async () => {
    expect(await stableControlId(base)).toBe(await stableControlId({
      ...base,
      typography: { ...base.typography, fontFamilyStack: ['arial'] }
    }))
  })
})

describe('stableIconId', () => {
  it('uses only normalized SVG geometry', async () => {
    const vectorSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 12h16"/></svg>'
    const first = await stableIconId({ vectorSvg })
    const second = await stableIconId({
      vectorSvg: '  <svg   viewBox="0 0 24 24" fill="currentColor"><path d="M4 12h16"/></svg> '
    })
    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('changes when path geometry changes', async () => {
    expect(await stableIconId({
      vectorSvg: '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>'
    })).not.toBe(await stableIconId({
      vectorSvg: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>'
    }))
  })
})
