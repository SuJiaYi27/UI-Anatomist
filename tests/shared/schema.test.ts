import { describe, expect, it } from 'vitest'
import {
  isSafeIconNameValue,
  ScanExportSchema
} from '../../src/shared/schema'

const safeExport = {
  schemaVersion: '1.0.0' as const,
  source: {
    siteLabel: 'ChatGPT',
    origin: 'https://chatgpt.com',
    scannedAt: '2026-07-18T12:00:00.000Z',
    locale: 'zh-CN',
    platform: 'macOS'
  },
  typography: [{
    id: `sha256:${'a'.repeat(64)}`,
    name: 'body-regular',
    fontFamilyStack: ['-apple-system-body', 'system-ui'],
    fontStyle: 'normal' as const,
    fontSizePx: 16,
    fontWeight: 400,
    lineHeightPx: 24,
    letterSpacingPx: 0,
    role: 'body' as const,
    occurrences: 12
  }],
  traversal: { visitedStates: 4, skippedUnsafe: 3, skippedUncertain: 2, failures: 0 },
  filtered: { brandAssets: 18, personalTextNodes: 41 }
}

describe('isSafeIconNameValue', () => {
  it('keeps authored UI names and geometry fallbacks but rejects data-derived names', () => {
    expect(isSafeIconNameValue('Open details')).toBe(true)
    expect(isSafeIconNameValue('icon-a1b2c3')).toBe(true)
    expect(isSafeIconNameValue('184.2k stars')).toBe(false)
    expect(isSafeIconNameValue('latest Jul 29, 2026')).toBe(false)
    expect(isSafeIconNameValue('Star acme-labs/widget-kit')).toBe(false)
    expect(isSafeIconNameValue('Star acme-labs\\widget-kit')).toBe(false)
    expect(isSafeIconNameValue('Star acme-labs／widget-kit')).toBe(false)
  })
})

const currentExport = {
  ...safeExport,
  schemaVersion: '1.1.0' as const,
  borderRadii: [
    {
      id: `sha256:${'b'.repeat(64)}`,
      name: 'radius-8',
      kind: 'px' as const,
      value: 8,
      occurrences: 12
    },
    {
      id: `sha256:${'c'.repeat(64)}`,
      name: 'radius-full',
      kind: 'full' as const,
      value: null,
      occurrences: 4
    }
  ]
}

const shadowsExport = {
  ...currentExport,
  schemaVersion: '1.2.0' as const,
  shadows: [{
    id: `sha256:${'d'.repeat(64)}`,
    name: 'shadow-multi-2-a1b2c3',
    layers: [
      {
        kind: 'outer' as const,
        offsetX: 0,
        offsetY: 4,
        blur: 12,
        spread: 0,
        color: { r: 0, g: 0, b: 0, a: 0.1 }
      },
      {
        kind: 'inner' as const,
        offsetX: 0,
        offsetY: -1,
        blur: 0,
        spread: 0,
        color: { r: 1, g: 1, b: 1, a: 0.2 }
      }
    ],
    occurrences: 2
  }]
}

const colorsExport = {
  ...shadowsExport,
  schemaVersion: '1.3.0' as const,
  colors: {
    primitives: [{
      id: `sha256:${'e'.repeat(64)}`,
      name: 'neutral-0',
      value: { r: 1, g: 1, b: 1, a: 1 },
      family: 'neutral' as const,
      step: 0,
      provenance: 'observed' as const,
      occurrences: 8
    }, {
      id: `sha256:${'f'.repeat(64)}`,
      name: 'neutral-100',
      value: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      family: 'neutral' as const,
      step: 100,
      provenance: 'inferred' as const,
      occurrences: 0
    }],
    semantic: [{
      id: `sha256:${'0'.repeat(64)}`,
      name: 'background-primary',
      group: 'background' as const,
      value: { r: 1, g: 1, b: 1, a: 1 },
      primitiveId: `sha256:${'e'.repeat(64)}`,
      provenance: 'observed' as const,
      occurrences: 5
    }],
    interactive: [{
      id: `sha256:${'1'.repeat(64)}`,
      name: 'primary-hover-background',
      intent: 'primary' as const,
      state: 'hover' as const,
      usage: 'background' as const,
      value: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      primitiveId: `sha256:${'f'.repeat(64)}`,
      provenance: 'declared' as const,
      occurrences: 1
    }]
  }
}

const spacingExport = {
  ...colorsExport,
  schemaVersion: '1.4.0' as const,
  spacing: [{
    id: `sha256:${'2'.repeat(64)}`,
    name: 'spacing-8',
    value: 8,
    occurrences: 7,
    evidence: { padding: 4, gap: 2, margin: 1 },
    stateOccurrences: 3
  }]
}

const control = {
  id: `sha256:${'3'.repeat(64)}`,
  groupId: `sha256:${'4'.repeat(64)}`,
  name: 'button-primary-md',
  family: 'button' as const,
  state: 'default' as const,
  intent: 'primary' as const,
  size: 'md' as const,
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
    fontStyle: 'normal' as const,
    fontSizePx: 14,
    fontWeight: 400,
    lineHeightPx: 20,
    letterSpacingPx: 0
  },
  slots: { leading: null, trailing: null },
  content: { kind: 'text-only' as const },
  occurrences: 2,
  stateOccurrences: 2
}

const controlsExport = {
  ...spacingExport,
  schemaVersion: '1.5.0' as const,
  controls: [control]
}

const labeledControlsExport = {
  ...spacingExport,
  schemaVersion: '1.6.0' as const,
  controls: [{
    ...control,
    sampleText: { value: 'Share', source: 'visible-text' as const }
  }]
}

const compoundControlsExport = {
  ...spacingExport,
  schemaVersion: '1.7.0' as const,
  controls: [{
    ...control,
    slots: {
      leading: {
        width: 24,
        height: 24,
        assetType: 'ui-icon' as const,
        vectorSvg: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 12.5 14.5 6" stroke="currentColor"/></svg>'
      },
      trailing: null
    },
    content: {
      kind: 'compound-row' as const,
      trailing: 'none' as const,
      textFlow: 'inline' as const,
      textGap: 8
    },
    layout: {
      widthBehavior: 'fill' as const
    },
    sampleText: {
      value: 'Add photos & files',
      source: 'visible-text' as const
    },
    supportingText: {
      value: 'Upload from computer',
      source: 'visible-text' as const
    },
    supportingStyle: {
      foreground: { r: 0.5608, g: 0.5608, b: 0.5608, a: 1 },
      typography: {
        ...control.typography,
        fontSizePx: 14,
        lineHeightPx: 20
      }
    }
  }]
}

const iconsExport = {
  ...compoundControlsExport,
  schemaVersion: '1.8.0' as const,
  icons: [{
    id: `sha256:${'5'.repeat(64)}`,
    name: 'search',
    nameSource: 'accessible-name' as const,
    category: 'navigation' as const,
    vectorSvg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4z"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
    observedSizes: [{ width: 20, height: 20, occurrences: 3 }],
    themes: [{
      theme: 'light' as const,
      color: { r: 0.051, g: 0.051, b: 0.051, a: 1 },
      occurrences: 3
    }],
    occurrences: 3,
    stateOccurrences: 2
  }]
}

const componentTreesExport = {
  ...iconsExport,
  schemaVersion: '1.9.0' as const,
  controls: [{
    ...control,
    templateId: `sha256:${'6'.repeat(64)}`,
    logicalControlId: `sha256:${'7'.repeat(64)}`,
    instanceId: `sha256:${'8'.repeat(64)}`
  }, {
    ...control,
    id: `sha256:${'9'.repeat(64)}`,
    templateId: `sha256:${'6'.repeat(64)}`,
    logicalControlId: `sha256:${'a'.repeat(64)}`,
    instanceId: `sha256:${'b'.repeat(64)}`
  }],
  composites: [{
    id: `sha256:${'c'.repeat(64)}`,
    templateId: `sha256:${'d'.repeat(64)}`,
    logicalCompositeId: `sha256:${'e'.repeat(64)}`,
    name: 'menu-vertical',
    kind: 'menu' as const,
    state: 'default' as const,
    geometry: {
      width: 280,
      height: 104,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 4,
      radius: 12,
      borderWidth: 1
    },
    appearance: control.appearance,
    layout: {
      direction: 'vertical' as const,
      align: 'stretch' as const,
      justify: 'start' as const,
      wrap: false,
      widthBehavior: 'fill' as const
    },
    children: [{
      kind: 'control' as const,
      controlId: control.id,
      instanceId: `sha256:${'8'.repeat(64)}`,
      state: 'default' as const
    }, {
      kind: 'control' as const,
      controlId: `sha256:${'9'.repeat(64)}`,
      instanceId: `sha256:${'b'.repeat(64)}`,
      state: 'default' as const
    }],
    occurrences: 1,
    stateOccurrences: 1
  }]
}

const compoundInputExport = {
  ...iconsExport,
  controls: [{
    ...control,
    family: 'input' as const,
    content: {
      kind: 'compound-input' as const
    },
    layout: {
      widthBehavior: 'fill' as const
    },
    slots: {
      leading: {
        width: 20,
        height: 20,
        assetType: 'ui-icon' as const,
        vectorSvg: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v16M4 12h16" stroke="currentColor"/></svg>',
        surface: {
          width: 36,
          height: 36,
          background: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
          foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
          border: { r: 0, g: 0, b: 0, a: 0 },
          borderWidth: 0,
          radii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 }
        }
      },
      trailing: {
        width: 20,
        height: 20,
        assetType: 'ui-icon' as const,
        vectorSvg: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v10" stroke="currentColor"/></svg>',
        surface: {
          width: 32,
          height: 32,
          background: { r: 0, g: 0, b: 0, a: 0 },
          foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
          border: { r: 0, g: 0, b: 0, a: 0 },
          borderWidth: 0,
          radii: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 }
        }
      }
    },
    slotGroups: {
      leading: [{
        width: 20,
        height: 20,
        assetType: 'ui-icon' as const,
        vectorSvg: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v16M4 12h16" stroke="currentColor"/></svg>',
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
        assetType: 'ui-icon' as const,
        vectorSvg: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v10" stroke="currentColor"/></svg>',
        surface: {
          width: 32,
          height: 32,
          background: { r: 0, g: 0, b: 0, a: 0 },
          foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
          border: { r: 0, g: 0, b: 0, a: 0 },
          borderWidth: 0,
          radii: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 }
        }
      }, {
        width: 20,
        height: 20,
        assetType: 'ui-icon' as const,
        vectorSvg: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 12h12" stroke="currentColor"/></svg>',
        surface: {
          width: 40,
          height: 40,
          background: { r: 0, g: 0, b: 0, a: 1 },
          foreground: { r: 1, g: 1, b: 1, a: 1 },
          border: { r: 0, g: 0, b: 0, a: 0 },
          borderWidth: 0,
          radii: { topLeft: 20, topRight: 20, bottomRight: 20, bottomLeft: 20 }
        }
      }]
    },
    sampleText: {
      value: 'Ask anything',
      source: 'placeholder' as const
    }
  }]
}

describe('ScanExportSchema', () => {
  it('accepts a privacy-safe typography export', () => {
    const parsed = ScanExportSchema.parse(safeExport)
    expect(parsed.typography).toHaveLength(1)
    expect(parsed.borderRadii).toEqual([])
    expect(parsed.shadows).toEqual([])
    expect(parsed.spacing).toEqual([])
    expect(parsed.controls).toEqual([])
  })

  it('accepts anonymous traversal failure-stage counts', () => {
    const parsed = ScanExportSchema.parse({
      ...iconsExport,
      traversal: {
        ...iconsExport.traversal,
        failures: 1,
        failureStages: {
          navigation: 0,
          inspection: 1
        }
      }
    })

    expect(parsed.traversal.failureStages).toEqual({
      navigation: 0,
      inspection: 1
    })
  })

  it('accepts a strict 1.1 export with dynamic border radii', () => {
    const parsed = ScanExportSchema.parse(currentExport)
    expect(parsed.borderRadii).toHaveLength(2)
    expect(parsed.shadows).toEqual([])
  })

  it('accepts a strict 1.2 export with ordered multi-layer shadows', () => {
    const parsed = ScanExportSchema.parse(shadowsExport)
    expect(parsed.shadows).toHaveLength(1)
    expect(parsed.shadows[0]?.layers.map(layer => layer.kind)).toEqual(['outer', 'inner'])
    expect(parsed.colors).toEqual({ primitives: [], semantic: [], interactive: [] })
  })

  it('accepts a strict 1.3 export with referenced color layers', () => {
    const parsed = ScanExportSchema.parse(colorsExport)
    expect(parsed.colors.primitives).toHaveLength(2)
    expect(parsed.colors.semantic[0]?.primitiveId).toBe(colorsExport.colors.primitives[0]?.id)
    expect(parsed.colors.interactive[0]?.state).toBe('hover')
    expect(parsed.spacing).toEqual([])
  })

  it('accepts a strict 1.4 export with spacing evidence', () => {
    const parsed = ScanExportSchema.parse(spacingExport)
    expect(parsed.spacing).toEqual(spacingExport.spacing)
    expect(parsed.controls).toEqual([])
  })

  it('accepts a strict 1.5 export with privacy-safe control signatures', () => {
    const parsed = ScanExportSchema.parse(controlsExport)
    expect(parsed.controls).toEqual([control])
  })

  it('accepts optional measured control content alignment evidence', () => {
    const parsed = ScanExportSchema.parse({
      ...controlsExport,
      controls: [{
        ...control,
        layout: {
          widthBehavior: 'fill',
          contentAlignment: 'start'
        }
      }]
    })

    expect(parsed.controls[0]?.layout).toEqual({
      widthBehavior: 'fill',
      contentAlignment: 'start'
    })
  })

  it('accepts a strict 1.6 export with a bounded safe sample label', () => {
    const parsed = ScanExportSchema.parse(labeledControlsExport)
    expect(parsed.controls[0]?.sampleText).toEqual({
      value: 'Share',
      source: 'visible-text'
    })
  })

  it('accepts a strict 1.7 export with compound row anatomy and a sanitized UI vector', () => {
    const parsed = ScanExportSchema.parse(compoundControlsExport)
    expect(parsed.schemaVersion).toBe('1.7.0')
    expect(parsed.controls[0]).toMatchObject({
      content: {
        kind: 'compound-row',
        trailing: 'none',
        textFlow: 'inline',
        textGap: 8
      },
      layout: { widthBehavior: 'fill' },
      supportingText: {
        value: 'Upload from computer',
        source: 'visible-text'
      },
      slots: {
        leading: {
          assetType: 'ui-icon'
        }
      }
    })
  })

  it('accepts anonymous compound-row structure when private copy was removed but supporting style remains', () => {
    const anonymous = structuredClone(
      compoundControlsExport.controls[0]!
    ) as Partial<(typeof compoundControlsExport.controls)[number]>
    delete anonymous.sampleText
    delete anonymous.supportingText
    const parsed = ScanExportSchema.parse({
      ...compoundControlsExport,
      controls: [anonymous]
    })

    expect(parsed.controls[0]?.content?.kind).toBe('compound-row')
    expect(parsed.controls[0]).not.toHaveProperty('sampleText')
    expect(parsed.controls[0]).not.toHaveProperty('supportingText')
    expect(parsed.controls[0]).toHaveProperty('supportingStyle')
  })

  it('accepts a strict 1.8 export with standalone UI icons', () => {
    const parsed = ScanExportSchema.parse(iconsExport)
    expect(parsed.schemaVersion).toBe('1.8.0')
    expect(parsed.icons).toHaveLength(1)
    expect(parsed.icons[0]).toMatchObject({
      name: 'search',
      nameSource: 'accessible-name',
      category: 'navigation',
      viewBox: { width: 24, height: 24 },
      observedSizes: [{ width: 20, height: 20, occurrences: 3 }]
    })
  })

  it('accepts a strict 1.9 export with opaque control identities and an ordered composite', () => {
    const parsed = ScanExportSchema.parse(componentTreesExport)

    expect(parsed.schemaVersion).toBe('1.9.0')
    expect(parsed.controls[0]).toMatchObject({
      templateId: `sha256:${'6'.repeat(64)}`,
      logicalControlId: `sha256:${'7'.repeat(64)}`,
      instanceId: `sha256:${'8'.repeat(64)}`
    })
    expect(parsed.composites[0]).toMatchObject({
      kind: 'menu',
      children: [
        { kind: 'control', instanceId: `sha256:${'8'.repeat(64)}` },
        { kind: 'control', instanceId: `sha256:${'b'.repeat(64)}` }
      ]
    })
  })

  it('accepts a strict 1.10 Expanded control referenced by a composite child', () => {
    const expandedControl = {
      ...componentTreesExport.controls[0]!,
      state: 'expanded' as const
    }
    const parsed = ScanExportSchema.parse({
      ...componentTreesExport,
      schemaVersion: '1.10.0',
      controls: [expandedControl, componentTreesExport.controls[1]!],
      composites: [{
        ...componentTreesExport.composites[0]!,
        children: [{
          ...componentTreesExport.composites[0]!.children[0]!,
          state: 'expanded' as const
        }, componentTreesExport.composites[0]!.children[1]!]
      }]
    })

    expect(parsed.controls[0]?.state).toBe('expanded')
    expect(parsed.composites[0]?.children[0]).toMatchObject({
      kind: 'control',
      state: 'expanded'
    })
  })

  it('accepts strict anonymous disclosure diagnostics in schema 1.11', () => {
    const parsed = ScanExportSchema.parse({
      ...componentTreesExport,
      schemaVersion: '1.11.0',
      diagnostics: {
        disclosures: [{
          candidateId: `sha256:${'d'.repeat(64)}`,
          pageId: `sha256:${'e'.repeat(64)}`,
          elementKind: 'native-button',
          popupKind: 'true',
          hasExpanded: true,
          hasControls: false,
          nativeDetails: false,
          fileRisk: 'label-heuristic',
          risk: 'not-classified',
          riskReason: 'preflight',
          stage: 'rejected-file-picker',
          occurrences: 3
        }],
        controls: [{
          candidateId: `sha256:${'a'.repeat(64)}`,
          pageId: `sha256:${'b'.repeat(64)}`,
          family: 'input',
          stage: 'rejected-no-painted-frame',
          occurrences: 2
        }, {
          candidateId: `sha256:${'c'.repeat(64)}`,
          pageId: `sha256:${'b'.repeat(64)}`,
          family: 'button',
          stage: 'rejected-empty-control',
          occurrences: 1
        }]
      }
    })

    expect(parsed.schemaVersion).toBe('1.11.0')
    if (parsed.schemaVersion !== '1.11.0') throw new Error('Expected schema 1.11')
    expect(parsed.diagnostics.disclosures).toEqual([
      expect.objectContaining({
        candidateId: `sha256:${'d'.repeat(64)}`,
        pageId: `sha256:${'e'.repeat(64)}`,
        stage: 'rejected-file-picker',
        occurrences: 3
      })
    ])
    expect(parsed.diagnostics.controls).toEqual([
      expect.objectContaining({
        candidateId: `sha256:${'a'.repeat(64)}`,
        family: 'input',
        stage: 'rejected-no-painted-frame',
        occurrences: 2
      }),
      expect.objectContaining({
        candidateId: `sha256:${'c'.repeat(64)}`,
        family: 'button',
        stage: 'rejected-empty-control',
        occurrences: 1
      })
    ])
  })

  it('accepts a bounded static text region in schema 1.12 and rejects unsafe or unbounded evidence', () => {
    const source = componentTreesExport.composites[0]!
    const region = {
      kind: 'static-text-region' as const,
      templateId: `sha256:${'1'.repeat(64)}`,
      instanceId: `sha256:${'2'.repeat(64)}`,
      placement: { x: 0, y: 0, width: 280, height: 48 },
      geometry: {
        width: 280,
        height: 48,
        padding: { top: 12, right: 16, bottom: 12, left: 16 },
        gap: 0,
        radius: 0,
        borderWidth: 1,
        borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
      },
      appearance: source.appearance,
      text: {
        source: 'visible-static-ui' as const,
        value: 'Safe menu title',
        placement: { x: 16, y: 12, width: 160, height: 24 },
        typographyId: componentTreesExport.typography[0]!.id,
        foreground: { r: 0.1, g: 0.1, b: 0.1, a: 1 }
      }
    }
    const input = {
      ...componentTreesExport,
      schemaVersion: '1.12.0' as const,
      composites: [{
        ...source,
        geometry: {
          ...source.geometry,
          height: 152,
          padding: { top: 0, right: 8, bottom: 8, left: 8 }
        },
        children: [
          region,
          { ...source.children[0]!, placement: { x: 8, y: 56, width: 264, height: 40 } },
          { ...source.children[1]!, placement: { x: 8, y: 104, width: 264, height: 40 } }
        ]
      }],
      diagnostics: { disclosures: [] }
    }

    expect(ScanExportSchema.parse(input).schemaVersion).toBe('1.12.0')
    expect(() => ScanExportSchema.parse({
      ...input,
      schemaVersion: '1.11.0'
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...input,
      composites: [{
        ...input.composites[0]!,
        children: [{
          ...region,
          text: { ...region.text, typographyId: `sha256:${'3'.repeat(64)}` }
        }, ...input.composites[0]!.children.slice(1)]
      }]
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...input,
      composites: [{
        ...input.composites[0]!,
        children: [{
          ...region,
          text: { ...region.text, value: 'https://unsafe.example/path' }
        }, ...input.composites[0]!.children.slice(1)]
      }]
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...input,
      composites: [{
        ...input.composites[0]!,
        children: [{
          ...region,
          text: { ...region.text, placement: { x: 200, y: 12, width: 160, height: 24 } }
        }, ...input.composites[0]!.children.slice(1)]
      }]
    })).toThrow()
  })

  it('rejects raw disclosure evidence and unknown diagnostic fields in schema 1.11', () => {
    const base = {
      ...componentTreesExport,
      schemaVersion: '1.11.0' as const,
      diagnostics: {
        disclosures: [{
          candidateId: `sha256:${'d'.repeat(64)}`,
          elementKind: 'native-button',
          popupKind: 'menu',
          hasExpanded: true,
          hasControls: false,
          nativeDetails: false,
          fileRisk: 'none',
          risk: 'safe',
          riskReason: 'structural-disclosure',
          stage: 'classified',
          occurrences: 1
        }]
      }
    }

    expect(() => ScanExportSchema.parse({
      ...base,
      diagnostics: {
        disclosures: [{
          ...base.diagnostics.disclosures[0],
          label: 'private repository'
        }]
      }
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...base,
      diagnostics: {
        ...base.diagnostics,
        selector: '#private-control'
      }
    })).toThrow()
  })

  it('rejects Expanded controls mislabeled as legacy schema 1.9', () => {
    const expandedControl = {
      ...componentTreesExport.controls[0]!,
      state: 'expanded' as const
    }

    expect(() => ScanExportSchema.parse({
      ...componentTreesExport,
      controls: [expandedControl, componentTreesExport.controls[1]!],
      composites: [{
        ...componentTreesExport.composites[0]!,
        children: [{
          ...componentTreesExport.composites[0]!.children[0]!,
          state: 'expanded' as const
        }, componentTreesExport.composites[0]!.children[1]!]
      }]
    })).toThrow()
  })

  it('accepts asymmetric control borders and a bounded clipped composite with many children', () => {
    const children = Array.from({ length: 60 }, (_, index) =>
      componentTreesExport.composites[0]!.children[index % 2]!
    )
    const parsed = ScanExportSchema.parse({
      ...componentTreesExport,
      controls: componentTreesExport.controls.map((item, index) => index === 0
        ? {
            ...item,
            geometry: {
              ...item.geometry,
              borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
            }
          }
        : item),
      composites: [{
        ...componentTreesExport.composites[0],
        layout: {
          ...componentTreesExport.composites[0]!.layout,
          clipsContent: true
        },
        children
      }]
    })

    expect(parsed.controls[0]?.geometry.borderWidths).toEqual({
      top: 0, right: 0, bottom: 1, left: 0
    })
    expect(parsed.composites[0]?.layout.clipsContent).toBe(true)
    expect(parsed.composites[0]?.children).toHaveLength(60)
  })

  it('accepts a single-child composite with asymmetric border evidence', () => {
    const parsed = ScanExportSchema.parse({
      ...componentTreesExport,
      composites: [{
        ...componentTreesExport.composites[0],
        geometry: {
          ...componentTreesExport.composites[0]!.geometry,
          height: 80,
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
        },
        children: [componentTreesExport.composites[0]!.children[0]]
      }]
    })

    expect(parsed.composites[0]?.children).toHaveLength(1)
    expect(parsed.composites[0]?.geometry.borderWidths).toEqual({
      top: 1, right: 0, bottom: 0, left: 0
    })
  })

  it('accepts bounded half-pixel composite child placement', () => {
    const source = componentTreesExport.composites[0]!
    const parsed = ScanExportSchema.parse({
      ...componentTreesExport,
      composites: [{
        ...source,
        children: source.children.map((child, index) => ({
          ...child,
          placement: {
            x: 8,
            y: 8 + index * 44,
            width: 220,
            height: 40
          }
        }))
      }]
    })

    expect(parsed.composites[0]?.children[0]).toMatchObject({
      placement: { x: 8, y: 8, width: 220, height: 40 }
    })
  })

  it('rejects non-normalized or out-of-bounds composite child placement', () => {
    const source = componentTreesExport.composites[0]!
    const first = source.children[0]!
    expect(() => ScanExportSchema.parse({
      ...componentTreesExport,
      composites: [{
        ...source,
        children: [{
          ...first,
          placement: { x: 8.25, y: 8, width: 220, height: 40 }
        }, source.children[1]!]
      }]
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...componentTreesExport,
      composites: [{
        ...source,
        children: [{
          ...first,
          placement: {
            x: source.geometry.width - 8,
            y: 8,
            width: 220,
            height: 40
          }
        }, source.children[1]!]
      }]
    })).toThrow()
  })

  it('rejects a negative composite border side', () => {
    expect(() => ScanExportSchema.parse({
      ...componentTreesExport,
      composites: [{
        ...componentTreesExport.composites[0],
        geometry: {
          ...componentTreesExport.composites[0]!.geometry,
          borderWidths: { top: -1, right: 0, bottom: 0, left: 0 }
        }
      }]
    })).toThrow()
  })

  it('keeps older uniform-border and unclipped composite evidence backward compatible', () => {
    const parsed = ScanExportSchema.parse(componentTreesExport)

    expect(parsed.controls[0]?.geometry).not.toHaveProperty('borderWidths')
    expect(parsed.composites[0]?.layout).not.toHaveProperty('clipsContent')
    expect(parsed.composites[0]?.children[0]).not.toHaveProperty('placement')
  })

  it('rejects a composite child that does not resolve to a control instance', () => {
    expect(() => ScanExportSchema.parse({
      ...componentTreesExport,
      composites: [{
        ...componentTreesExport.composites[0],
        children: [{
          kind: 'control',
          controlId: control.id,
          instanceId: `sha256:${'f'.repeat(64)}`,
          state: 'default'
        }, componentTreesExport.composites[0]!.children[1]]
      }]
    })).toThrow()
  })

  it('normalizes composites to an empty array for schema 1.8 and earlier', () => {
    expect(ScanExportSchema.parse(iconsExport).composites).toEqual([])
    expect(ScanExportSchema.parse(compoundControlsExport).composites).toEqual([])
  })

  it('accepts a strict 1.8 export with a full compound input shell', () => {
    const parsed = ScanExportSchema.parse(compoundInputExport)
    expect(parsed.controls[0]).toMatchObject({
      family: 'input',
      content: { kind: 'compound-input' },
      layout: { widthBehavior: 'fill' },
      sampleText: { value: 'Ask anything', source: 'placeholder' },
      slotGroups: {
        leading: [expect.objectContaining({
          width: 20,
          assetType: 'ui-icon',
          surface: expect.objectContaining({
            width: 36,
            radii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 }
          })
        })],
        trailing: [
          expect.objectContaining({
            width: 20,
            assetType: 'ui-icon',
            surface: expect.objectContaining({ width: 32 })
          }),
          expect.objectContaining({
            width: 20,
            assetType: 'ui-icon',
            surface: expect.objectContaining({ width: 40 })
          })
        ]
      }
    })
  })

  it('rejects compound input anatomy without actions on both sides', () => {
    const firstControl = compoundInputExport.controls[0]
    if (!firstControl?.slotGroups) {
      throw new Error('compound input fixture is missing slot groups')
    }

    expect(() => ScanExportSchema.parse({
      ...compoundInputExport,
      controls: [{
        ...firstControl,
        slotGroups: {
          leading: firstControl.slotGroups.leading,
          trailing: []
        }
      }]
    })).toThrow()
  })

  it.each([
    { vectorSvg: '<svg><script>alert(1)</script></svg>' },
    { vectorSvg: '<svg><image href="https://example.com/a.png"/></svg>' },
    { viewBox: { minX: 0, minY: 0, width: 0, height: 24 } },
    { observedSizes: [] },
    { themes: [] },
    { stateOccurrences: 0 }
  ])('rejects an invalid standalone icon: %o', patch => {
    expect(() => ScanExportSchema.parse({
      ...iconsExport,
      icons: [{ ...iconsExport.icons[0], ...patch }]
    })).toThrow()
  })

  it.each([
    safeExport,
    currentExport,
    shadowsExport,
    colorsExport,
    spacingExport,
    controlsExport,
    labeledControlsExport,
    compoundControlsExport
  ])('normalizes icons to an empty array for schema $schemaVersion', legacy => {
    expect(ScanExportSchema.parse(legacy).icons).toEqual([])
  })

  it('counts sample label limits by Unicode code points', () => {
    const parsed = ScanExportSchema.parse({
      ...labeledControlsExport,
      controls: [{
        ...control,
        sampleText: { value: '🙂'.repeat(20), source: 'visible-text' }
      }]
    })
    expect(parsed.controls[0]?.sampleText?.value).toBe('🙂'.repeat(20))
  })

  it('rejects overlong or unknown control sample text fields', () => {
    expect(() => ScanExportSchema.parse({
      ...labeledControlsExport,
      controls: [{
        ...control,
        sampleText: { value: 'x'.repeat(33), source: 'visible-text' }
      }]
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...labeledControlsExport,
      controls: [{
        ...control,
        sampleText: { value: 'Share', source: 'aria-label' }
      }]
    })).toThrow()
  })

  it('rejects current values and compound copy for families that cannot expose safe product copy', () => {
    expect(() => ScanExportSchema.parse({
      ...labeledControlsExport,
      controls: [{
        ...control,
        family: 'select',
        sampleText: { value: 'Current option', source: 'visible-text' }
      }]
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...labeledControlsExport,
      controls: [{
        ...control,
        family: 'input',
        sampleText: { value: 'Typed value', source: 'visible-text' }
      }]
    })).toThrow()
    expect(() => ScanExportSchema.parse({
      ...compoundControlsExport,
      controls: [{
        ...compoundControlsExport.controls[0],
        family: 'select'
      }]
    })).toThrow()
  })

  it.each([
    'person@example.com',
    'https://example.com/private',
    'example.com/private',
    '+86 138 0013 8000',
    'Order 12345678',
    'acct_9f3a2b1c4d5e',
    'feature-stash',
    'person-name/private-branch',
    'personname/privateBranch',
    'v0.3.11',
    'Wait... really?!',
    'First line\nSecond line'
  ])('rejects unsafe sample text %j even when JSON bypasses Chrome', value => {
    expect(() => ScanExportSchema.parse({
      ...labeledControlsExport,
      controls: [{
        ...control,
        sampleText: { value, source: 'visible-text' }
      }]
    })).toThrow()
  })

  it('accepts a human-readable slash label that is not path-shaped data', () => {
    const parsed = ScanExportSchema.parse({
      ...labeledControlsExport,
      controls: [{
        ...control,
        sampleText: { value: 'Light/Dark', source: 'visible-text' }
      }]
    })
    expect(parsed.controls[0]?.sampleText?.value).toBe('Light/Dark')
  })

  it('accepts every anonymous control content structure without original copy', () => {
    const kinds = [
      'icon-only', 'text-only', 'icon-leading', 'icon-trailing', 'icon-both', 'empty'
    ] as const
    for (const kind of kinds) {
      const parsed = ScanExportSchema.parse({
        ...controlsExport,
        controls: [{ ...control, content: { kind } }]
      })
      expect(parsed.controls[0]?.content).toEqual({ kind })
    }
  })

  it.each([
    { geometry: { ...control.geometry, height: -1 } },
    { geometry: { ...control.geometry, padding: { ...control.geometry.padding, left: -1 } } },
    { appearance: { ...control.appearance, background: { r: 2, g: 0, b: 0, a: 1 } } },
    { stateOccurrences: 0 },
    { rawText: 'private button label' }
  ])('rejects an invalid control token: %o', patch => {
    expect(() => ScanExportSchema.parse({
      ...controlsExport,
      controls: [{ ...control, ...patch }]
    })).toThrow()
  })

  it.each([safeExport, currentExport, shadowsExport, colorsExport, spacingExport])(
    'normalizes controls to an empty array for schema $schemaVersion',
    legacy => {
      expect(ScanExportSchema.parse(legacy).controls).toEqual([])
    }
  )

  it('requires controls in a 1.5 export', () => {
    const { controls: _removed, ...missing } = controlsExport
    expect(() => ScanExportSchema.parse(missing)).toThrow()
  })

  it('requires controls in a 1.6 export', () => {
    const { controls: _removed, ...missing } = labeledControlsExport
    expect(() => ScanExportSchema.parse(missing)).toThrow()
  })

  it.each([
    { value: 0 },
    { value: -8 },
    { stateOccurrences: 0 },
    { evidence: { padding: 1, gap: 1, margin: 1 } },
    { rawSelector: '.private' }
  ])('rejects an invalid spacing token: %o', patch => {
    expect(() => ScanExportSchema.parse({
      ...spacingExport,
      spacing: [{ ...spacingExport.spacing[0], ...patch }]
    })).toThrow()
  })

  it('requires spacing in a 1.4 export', () => {
    const { spacing: _removed, ...missing } = spacingExport
    expect(() => ScanExportSchema.parse(missing)).toThrow()
  })

  it('requires border radii in a 1.1 export', () => {
    const { borderRadii: _removed, ...missing } = currentExport
    expect(() => ScanExportSchema.parse(missing)).toThrow()
  })

  it('rejects unknown fields inside a border radius token', () => {
    expect(() => ScanExportSchema.parse({
      ...currentExport,
      borderRadii: [{ ...currentExport.borderRadii[0], rawSelector: '.private' }]
    })).toThrow()
  })

  it.each([
    { layers: [] },
    { layers: [{ ...shadowsExport.shadows[0]!.layers[0]!, blur: -1 }] },
    { layers: [{ ...shadowsExport.shadows[0]!.layers[0]!, color: { r: 0, g: 0, b: 0, a: 1.1 } }] },
    { layers: [{ ...shadowsExport.shadows[0]!.layers[0]!, rawSelector: '.private' }] }
  ])('rejects an invalid shadow token: %o', patch => {
    expect(() => ScanExportSchema.parse({
      ...shadowsExport,
      shadows: [{ ...shadowsExport.shadows[0], ...patch }]
    })).toThrow()
  })

  it.each([
    { value: { r: -0.1, g: 0, b: 0, a: 1 } },
    { value: { r: 0, g: 0, b: 0, a: 1.1 } },
    { occurrences: -1 },
    { family: 'brand-magenta' },
    { rawSelector: '.private' }
  ])('rejects an invalid primitive color token: %o', patch => {
    expect(() => ScanExportSchema.parse({
      ...colorsExport,
      colors: {
        ...colorsExport.colors,
        primitives: [{ ...colorsExport.colors.primitives[0], ...patch }]
      }
    })).toThrow()
  })

  it('rejects semantic and interactive references outside the primitive collection', () => {
    expect(() => ScanExportSchema.parse({
      ...colorsExport,
      colors: {
        ...colorsExport.colors,
        semantic: [{
          ...colorsExport.colors.semantic[0],
          primitiveId: `sha256:${'9'.repeat(64)}`
        }]
      }
    })).toThrow()
  })

  it('requires colors in a 1.3 export', () => {
    const { colors: _removed, ...missing } = colorsExport
    expect(() => ScanExportSchema.parse(missing)).toThrow()
  })

  it.each([
    { family: 'pink', provenance: 'inferred', occurrences: 0, step: 100 },
    { family: 'neutral', provenance: 'inferred', occurrences: 2, step: 100 },
    { family: 'neutral', provenance: 'inferred', occurrences: 0, step: 75 }
  ])('rejects an inferred primitive outside the controlled neutral ramp: %o', patch => {
    expect(() => ScanExportSchema.parse({
      ...colorsExport,
      colors: {
        ...colorsExport.colors,
        primitives: [{ ...colorsExport.colors.primitives[1], ...patch }],
        semantic: [],
        interactive: []
      }
    })).toThrow()
  })

  it.each(['semantic', 'interactive'] as const)('rejects inferred %s roles', collection => {
    expect(() => ScanExportSchema.parse({
      ...colorsExport,
      colors: {
        ...colorsExport.colors,
        [collection]: colorsExport.colors[collection].map(token => ({
          ...token,
          provenance: 'inferred'
        }))
      }
    })).toThrow()
  })

  it('rejects exports containing raw page text', () => {
    expect(() => ScanExportSchema.parse({ ...safeExport, rawText: 'private chat' })).toThrow()
  })

  it('preserves CSS normal line-height as null', () => {
    const parsed = ScanExportSchema.parse({
      ...safeExport,
      typography: [{ ...safeExport.typography[0], lineHeightPx: null }]
    })
    expect(parsed.typography[0]?.lineHeightPx).toBeNull()
  })
})
