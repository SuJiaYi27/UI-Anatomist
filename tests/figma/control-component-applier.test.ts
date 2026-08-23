import { describe, expect, it, vi } from 'vitest'
import type { ControlImportPlan } from '../../src/figma/control-import-plan'
import {
  applyControlImportPlan,
  CONTROL_GROUP_OWNERSHIP_KEY,
  CONTROL_NODE_OWNERSHIP_KEY,
  CONTROL_SHARED_NAMESPACE,
  readControlOwnership,
  reflowAppliedControlComponentSets,
  reflowControlComponentSet,
  writeControlOwnership,
  type ControlComponentPort,
  type ControlComponentSetPort,
  type ControlFramePort,
  type ControlNodePort,
  type ControlRepository
} from '../../src/figma/control-component-applier'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import type { ControlToken, ScanExport } from '../../src/shared/schema'

function control(state: ControlToken['state'], id: string): ControlToken {
  return {
    id: `sha256:${id.repeat(64)}`,
    groupId: `sha256:${'9'.repeat(64)}`,
    name: `button-primary-md-${state}`,
    family: 'button',
    state,
    intent: 'primary',
    size: 'md',
    geometry: {
      height: 40, minWidth: null,
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 8, radius: 8, borderWidth: 0
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
      fontFamilyStack: ['Arial'], fontStyle: 'normal', fontSizePx: 14,
      fontWeight: 400, lineHeightPx: 20, letterSpacingPx: 0
    },
    slots: { leading: null, trailing: null },
    occurrences: 1,
    stateOccurrences: 1
  }
}

function scan(controls: ControlToken[]): ScanExport {
  return {
    schemaVersion: '1.5.0',
    source: {
      siteLabel: 'example.com', origin: 'https://example.com',
      scannedAt: '2026-07-23T12:00:00.000Z', locale: 'en', platform: 'macOS'
    },
    typography: [], borderRadii: [], shadows: [],
    colors: { primitives: [], semantic: [], interactive: [] },
    spacing: [], controls,
    traversal: { visitedStates: 1, skippedUnsafe: 0, skippedUncertain: 0, failures: 0 },
    filtered: { brandAssets: 0, personalTextNodes: 0 }
  }
}

function fakeComponent(id: string): ControlComponentPort {
  const data = new Map<string, string>()
  const sharedData = new Map<string, string>()
  return {
    id,
    type: 'COMPONENT',
    x: 0,
    y: 0,
    name: 'Before',
    description: 'Before',
    layoutMode: 'NONE',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    itemSpacing: 0,
    cornerRadius: 0,
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    width: 100,
    height: 20,
    children: [],
    appendChild(child) { this.children.push(child) },
    resize(width, height) { this.width = width; this.height = height },
    setPluginData(key, value) { data.set(key, value) },
    getPluginData(key) { return data.get(key) ?? '' },
    setSharedPluginData(namespace, key, value) {
      sharedData.set(`${namespace}|${key}`, value)
    },
    getSharedPluginData(namespace, key) {
      return sharedData.get(`${namespace}|${key}`) ?? ''
    },
    remove: vi.fn()
  }
}

function repository(created: ControlComponentPort[]): ControlRepository {
  let next = 0
  return {
    createComponent() {
      const component = fakeComponent(`component:${next++}`)
      created.push(component)
      return component
    },
    createText() {
      const text = {
        type: 'TEXT' as const,
        name: 'Label',
        fontName: null,
        letterSpacing: 0,
        fills: [],
        width: 0,
        height: 0,
        textAutoResize: 'NONE' as const
      } as Record<string, unknown>
      let characters = ''
      let fontSize = 0
      let lineHeight: { value: number; unit: 'PIXELS' } | null = null
      const updateSize = () => {
        text.width = [...characters].length * fontSize * 0.6
        text.height = lineHeight?.value ?? fontSize
      }
      Object.defineProperties(text, {
        characters: {
          get: () => characters,
          set: (value: string) => {
            characters = value
            updateSize()
          }
        },
        fontSize: {
          get: () => fontSize,
          set: (value: number) => {
            fontSize = value
            updateSize()
          }
        },
        lineHeight: {
          get: () => lineHeight,
          set: (value: { value: number; unit: 'PIXELS' } | null) => {
            lineHeight = value
            updateSize()
          }
        }
      })
      return text as ReturnType<ControlRepository['createText']>
    },
    createRectangle() {
      return {
        type: 'RECTANGLE', name: 'Graphic slot', width: 0, height: 0,
        fills: [], strokes: [], resize(width, height) { this.width = width; this.height = height }
      }
    },
    combineAsVariants(components) {
      const data = new Map<string, string>()
      const sharedData = new Map<string, string>()
      return {
        id: 'set:1', type: 'COMPONENT_SET', name: 'Before set', description: '',
        width: 0,
        height: 0,
        children: [...components],
        resize(width: number, height: number) {
          this.width = width
          this.height = height
        },
        setPluginData(key, value) { data.set(key, value) },
        getPluginData(key) { return data.get(key) ?? '' },
        setSharedPluginData(namespace, key, value) {
          sharedData.set(`${namespace}|${key}`, value)
        },
        getSharedPluginData(namespace, key) {
          return sharedData.get(`${namespace}|${key}`) ?? ''
        },
        remove: vi.fn()
      }
    },
    appendToComponentSet(set, component) {
      const existingIndex = set.children.indexOf(component)
      if (existingIndex >= 0) set.children.splice(existingIndex, 1)
      set.children.push(component)
    },
    clearChildren(component) {
      component.children.splice(0)
    },
    backupChildren(component) {
      return component.children.splice(0)
    },
    restoreChildren(component, backup) {
      component.children.splice(0)
      component.children.push(...backup as typeof component.children)
    },
    discardChildrenBackup() {},
    backupPlacement(component) {
      return { x: component.x, y: component.y }
    },
    restorePlacement(component, backup) {
      const placement = backup as { x: number; y: number }
      component.x = placement.x
      component.y = placement.y
    },
    getNodeById: async () => null,
    loadFont: vi.fn().mockResolvedValue(undefined)
  }
}

function plan(tokens: ControlToken[]): ControlImportPlan {
  return createControlImportPlan(scan(tokens), [], [{ family: 'Arial', style: 'Regular' }])
}

describe('applyControlImportPlan', () => {
  it('does not invent an Aa label for a surface-only control', async () => {
    const created: ControlComponentPort[] = []
    const result = await applyControlImportPlan(plan([control('default', '1')]), repository(created))
    const component = created[0]!
    expect(component.name).toBe('Control/Button/Primary/SolidDark/Md/Light/TextOnly')
    expect(component.height).toBe(40)
    expect(component.paddingLeft).toBe(12)
    expect(component.cornerRadius).toBe(8)
    expect(component.children).toEqual([])
    expect(component.description).not.toContain('Anonymous Aa')
    expect(component.getPluginData(CONTROL_NODE_OWNERSHIP_KEY))
      .toBe(`https://example.com|${control('default', '1').id}`)
    expect(result.created).toEqual([component])
  })

  it('preserves measured content alignment and left-aligns legacy fill rows', async () => {
    const start = {
      ...control('default', '1'),
      groupId: `sha256:${'4'.repeat(64)}`,
      geometry: {
        ...control('default', '1').geometry,
        minWidth: 240
      },
      layout: {
        widthBehavior: 'fill' as const,
        contentAlignment: 'start' as const
      }
    }
    const centered = {
      ...control('hover', '2'),
      groupId: `sha256:${'5'.repeat(64)}`,
      geometry: {
        ...control('default', '2').geometry,
        minWidth: 240
      },
      layout: {
        widthBehavior: 'fill' as const,
        contentAlignment: 'center' as const
      }
    }
    const legacy = {
      ...control('focus', '3'),
      groupId: `sha256:${'6'.repeat(64)}`,
      geometry: {
        ...control('focus', '3').geometry,
        minWidth: 240
      },
      appearance: {
        ...control('focus', '3').appearance,
        background: { r: 0, g: 0, b: 0, a: 0 }
      },
      sampleText: { value: 'Legacy row', source: 'visible-text' as const },
      layout: { widthBehavior: 'fill' as const }
    }
    const created: ControlComponentPort[] = []

    await applyControlImportPlan(
      plan([start, centered, legacy]),
      repository(created)
    )

    const byOwnership = new Map(created.map(component => [
      component.getPluginData(CONTROL_NODE_OWNERSHIP_KEY),
      component
    ]))
    expect(byOwnership.get(`https://example.com|${start.id}`)
      ?.primaryAxisAlignItems).toBe('MIN')
    expect(byOwnership.get(`https://example.com|${centered.id}`)
      ?.primaryAxisAlignItems).toBe('CENTER')
    expect(byOwnership.get(`https://example.com|${legacy.id}`)
      ?.primaryAxisAlignItems).toBe('MIN')
  })

  it('keeps an invisible structural asset slot without drawing a fake icon', async () => {
    const source = {
      ...control('default', '1'),
      slots: { leading: { width: 20, height: 20 }, trailing: null },
      content: { kind: 'icon-only' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.children).toEqual([
      expect.objectContaining({
        type: 'RECTANGLE',
        name: 'Excluded asset slot · unknown',
        fills: [],
        strokes: [],
        dashPattern: []
      })
    ])
    expect(created[0]?.children.some(child => child.type === 'TEXT')).toBe(false)
  })

  it('renders leading-icon text controls with an empty icon slot and safe text', async () => {
    const source = {
      ...control('default', '1'),
      geometry: {
        ...control('default', '1').geometry,
        height: 36,
        padding: { top: 6, right: 10, bottom: 6, left: 10 },
        gap: 6
      },
      slots: { leading: { width: 20, height: 20 }, trailing: null },
      content: { kind: 'icon-leading' as const },
      sampleText: { value: 'Action', source: 'visible-text' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.children.map(child => child.type)).toEqual(['RECTANGLE', 'TEXT'])
    expect(created[0]?.children).toContainEqual(expect.objectContaining({
      type: 'TEXT',
      characters: 'Action',
      fontSize: 14,
      lineHeight: { value: 20, unit: 'PIXELS' }
    }))
    expect(created[0]?.width).toBeGreaterThan(36)
  })

  it('keeps an anonymous surfaced extra-compact control free of synthetic text', async () => {
    const source = {
      ...control('default', '1'),
      intent: 'tertiary' as const,
      size: 'custom' as const,
      geometry: {
        ...control('default', '1').geometry,
        height: 18,
        padding: { top: 0, right: 0, bottom: 0, left: 16 },
        gap: 4,
        radius: 0
      },
      typography: {
        ...control('default', '1').typography,
        fontSizePx: 14,
        lineHeightPx: 18
      },
      content: { kind: 'text-only' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.paddingLeft).toBe(16)
    expect(created[0]?.children).toEqual([])
    expect(created[0]?.description).not.toContain('Anonymous Aa')
  })

  it('keeps scanned pill geometry without inventing anonymous content', async () => {
    const source = {
      ...control('default', '1'),
      intent: 'tertiary' as const,
      size: 'custom' as const,
      geometry: {
        ...control('default', '1').geometry,
        height: 36,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        radius: 18
      },
      typography: {
        ...control('default', '1').typography,
        fontSizePx: 14,
        fontWeight: 500,
        lineHeightPx: 20
      },
      content: { kind: 'text-only' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.cornerRadius).toBe(18)
    expect(created[0]?.children).toEqual([])
    expect(created[0]?.width).toBeGreaterThanOrEqual(36)
  })

  it('prefers a scanned safe button label over anonymous copy', async () => {
    const source = {
      ...control('default', '1'),
      sampleText: { value: 'Create image', source: 'visible-text' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.children).toContainEqual(
      expect.objectContaining({ type: 'TEXT', characters: 'Create image' })
    )
    expect(created[0]?.description).toContain('Scanned safe sample label')
    expect(created[0]?.description).not.toContain('Source text unavailable')
  })

  it('keeps a real compact label and widens the component without changing typography', async () => {
    const source = {
      ...control('default', '1'),
      intent: 'tertiary' as const,
      size: 'custom' as const,
      geometry: {
        ...control('default', '1').geometry,
        height: 18,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        radius: 9
      },
      typography: {
        ...control('default', '1').typography,
        fontSizePx: 14,
        lineHeightPx: 18
      },
      content: { kind: 'text-only' as const },
      sampleText: { value: 'More', source: 'visible-text' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.children).toContainEqual(
      expect.objectContaining({ type: 'TEXT', characters: 'More', fontSize: 14 })
    )
    expect(created[0]?.height).toBe(18)
    expect(created[0]?.cornerRadius).toBe(9)
    expect(created[0]?.width).toBeGreaterThan(18)
  })

  it('sizes inputs from their measured content instead of a hard-coded specimen width', async () => {
    const source = {
      ...control('default', '1'),
      family: 'input' as const,
      intent: 'neutral' as const,
      content: { kind: 'text-only' as const },
      sampleText: { value: 'Filter', source: 'placeholder' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.primaryAxisSizingMode).toBe('AUTO')
    expect(created[0]?.width).toBeGreaterThanOrEqual(40)
    expect(created[0]?.width).toBeLessThan(240)
    expect(created[0]?.clipsContent).toBe(false)
    expect(created[0]?.children).toContainEqual(expect.objectContaining({
      type: 'TEXT',
      characters: 'Filter',
      fontSize: 14
    }))
  })

  it('preserves an underline-only input border instead of inventing a full rectangle', async () => {
    const source: ControlToken = {
      ...control('default', '1'),
      family: 'input',
      intent: 'neutral',
      geometry: {
        ...control('default', '1').geometry,
        borderWidth: 1,
        borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
      },
      content: { kind: 'text-only' }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]).toMatchObject({
      strokeTopWeight: 0,
      strokeRightWeight: 0,
      strokeBottomWeight: 1,
      strokeLeftWeight: 0
    })
  })

  it('preserves a bounded observed fill width when the exact input font is missing', async () => {
    const source: ControlToken = {
      ...control('default', '1'),
      family: 'input',
      intent: 'neutral',
      geometry: {
        ...control('default', '1').geometry,
        height: 32,
        minWidth: 332,
        padding: { top: 3, right: 12, bottom: 3, left: 12 },
        radius: 6,
        borderWidth: 1
      },
      appearance: {
        ...control('default', '1').appearance,
        background: { r: 0.96, g: 0.97, b: 0.98, a: 1 },
        foreground: { r: 0.12, g: 0.14, b: 0.16, a: 1 },
        border: { r: 0.82, g: 0.85, b: 0.88, a: 1 }
      },
      typography: {
        ...control('default', '1').typography,
        fontFamilyStack: ['Unavailable Interface Mono']
      },
      content: { kind: 'text-only' },
      layout: { widthBehavior: 'fill' },
      sampleText: { value: 'Find a branch...', source: 'placeholder' }
    }
    const created: ControlComponentPort[] = []
    const result = await applyControlImportPlan(plan([source]), repository(created))

    expect(result.missingFonts).toEqual(['Unavailable Interface Mono'])
    expect(created[0]?.children).toEqual([])
    expect(created[0]?.width).toBe(332)
    expect(created[0]?.height).toBe(32)
  })

  it('uses a scanned input placeholder when available', async () => {
    const source = {
      ...control('default', '1'),
      family: 'input' as const,
      intent: 'neutral' as const,
      content: { kind: 'text-only' as const },
      sampleText: { value: 'Ask anything', source: 'placeholder' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.children).toContainEqual(
      expect.objectContaining({ type: 'TEXT', characters: 'Ask anything' })
    )
  })

  it('renders a compact fill-width compound row even when legacy JSON contains a layout-sized text gap', async () => {
    const source: ControlToken = {
      ...control('default', '1'),
      geometry: {
        ...control('default', '1').geometry,
        height: 52,
        minWidth: 900,
        padding: { top: 6, right: 12, bottom: 6, left: 12 },
        gap: 10,
        radius: 8
      },
      slots: {
        leading: {
          width: 24,
          height: 24,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 24 24"><path d="M12 2v20"/></svg>'
        },
        trailing: {
          width: 16,
          height: 16,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7"/></svg>'
        }
      },
      content: {
        kind: 'compound-row',
        trailing: 'action',
        textFlow: 'inline',
        textGap: 186
      },
      layout: { widthBehavior: 'fill' },
      sampleText: {
        value: 'Add photos & files',
        source: 'visible-text'
      },
      supportingText: {
        value: 'Upload from computer',
        source: 'visible-text'
      },
      supportingStyle: {
        foreground: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
        typography: {
          fontFamilyStack: ['Arial'],
          fontStyle: 'normal',
          fontSizePx: 14,
          fontWeight: 400,
          lineHeightPx: 20,
          letterSpacingPx: 0
        }
      }
    }
    const created: ControlComponentPort[] = []
    const base = repository(created)
    const createFrame = () => ({
      type: 'FRAME' as const,
      name: '',
      layoutMode: 'NONE' as const,
      primaryAxisSizingMode: 'FIXED' as const,
      counterAxisSizingMode: 'FIXED' as const,
      primaryAxisAlignItems: 'MIN' as const,
      counterAxisAlignItems: 'MIN' as const,
      itemSpacing: 0,
      fills: [],
      strokes: [],
      width: 0,
      height: 0,
      layoutGrow: 0,
      children: [] as unknown[],
      appendChild(child: unknown) { this.children.push(child) },
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      }
    })
    const compoundRepository = Object.assign(base, {
      createFrame,
      createNodeFromSvg(svg: string) {
        const frame = createFrame()
        frame.name = `Imported ${svg.includes('<path') ? 'vector' : 'asset'}`
        return frame
      }
    })

    await applyControlImportPlan(plan([source]), compoundRepository)

    expect(created[0]).toMatchObject({
      name: expect.stringMatching(/^Control\/MenuItem\//),
      primaryAxisSizingMode: 'FIXED',
      height: 52
    })
    expect(created[0]?.width).toBeLessThan(900)
    expect(created[0]?.width).toBeGreaterThan(300)
    expect(created[0]?.clipsContent).toBe(false)
    expect(created[0]?.children.map(child => child.type)).toEqual(['FRAME', 'FRAME', 'FRAME'])
    expect(created[0]?.children[0]).toMatchObject({
      type: 'FRAME',
      name: 'Leading UI icon',
      width: 24,
      height: 24
    })
    expect(created[0]?.children[1]).toMatchObject({
      type: 'FRAME',
      name: 'Text group',
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8,
      layoutGrow: 1,
      children: [
        expect.objectContaining({
          type: 'TEXT',
          name: 'Primary label',
          characters: 'Add photos & files',
          fontSize: 14
        }),
        expect.objectContaining({
          type: 'TEXT',
          name: 'Supporting label',
          characters: 'Upload from computer',
          fontSize: 14
        })
      ]
    })
    expect(created[0]?.children[2]).toMatchObject({
      type: 'FRAME',
      name: 'Trailing UI icon',
      width: 16,
      height: 16
    })
    expect(created[0]?.children.some(child => child.type === 'RECTANGLE')).toBe(false)

    const anonymous: ControlToken = {
      ...source,
      id: `sha256:${'2'.repeat(64)}`,
      groupId: `sha256:${'8'.repeat(64)}`,
      sampleText: undefined,
      supportingText: undefined
    }
    await applyControlImportPlan(plan([anonymous]), compoundRepository)

    expect(created[1]?.children.map(child => child.name)).toEqual([
      'Leading UI icon', 'Trailing UI icon'
    ])
    expect(created[1]?.children.some(child => child.type === 'TEXT')).toBe(false)
  })

  it('keeps an observed component-scale width for a fill-width compound row', async () => {
    const base = control('selected', '1')
    const source: ControlToken = {
      ...base,
      geometry: {
        ...base.geometry,
        height: 32,
        minWidth: 304,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        radius: 6
      },
      slots: {
        leading: {
          width: 16,
          height: 16,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 16 16"><path d="m2 8 4 4 8-8"/></svg>'
        },
        trailing: null
      },
      content: {
        kind: 'compound-row',
        trailing: 'none',
        textFlow: 'inline',
        textGap: 8
      },
      layout: { widthBehavior: 'fill' },
      sampleText: { value: 'Repository', source: 'visible-text' },
      supportingText: { value: 'Current', source: 'visible-text' },
      supportingStyle: {
        foreground: base.appearance.foreground,
        typography: {
          ...base.typography,
          fontSizePx: 12,
          lineHeightPx: 16
        }
      }
    }
    const created: ControlComponentPort[] = []
    const baseRepository = repository(created)
    const createFrame = () => ({
      type: 'FRAME' as const,
      name: '',
      layoutMode: 'NONE' as const,
      primaryAxisSizingMode: 'FIXED' as const,
      counterAxisSizingMode: 'FIXED' as const,
      primaryAxisAlignItems: 'MIN' as const,
      counterAxisAlignItems: 'MIN' as const,
      itemSpacing: 0,
      fills: [],
      strokes: [],
      width: 0,
      height: 0,
      layoutGrow: 0,
      children: [] as unknown[],
      appendChild(child: unknown) { this.children.push(child) },
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      }
    })
    await applyControlImportPlan(plan([source]), Object.assign(baseRepository, {
      createFrame,
      createNodeFromSvg: () => createFrame()
    }))

    expect(created[0]?.width).toBe(304)
    expect(created[0]?.height).toBe(32)
    expect(created[0]?.children[1]).toMatchObject({
      name: 'Text group',
      itemSpacing: 8,
      layoutGrow: 1
    })
  })

  it('colors an inherited default SVG fill with the control foreground', async () => {
    const source: ControlToken = {
      ...control('default', '1'),
      slots: {
        leading: {
          width: 16,
          height: 16,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 16 16"><path d="M2 2h12v12H2z"/></svg>'
        },
        trailing: null
      },
      content: { kind: 'icon-only' }
    }
    const created: ControlComponentPort[] = []
    const baseRepository = repository(created)
    const imported: string[] = []
    const frame = () => ({
      type: 'FRAME' as const,
      name: '',
      layoutMode: 'NONE' as const,
      primaryAxisSizingMode: 'FIXED' as const,
      counterAxisSizingMode: 'FIXED' as const,
      primaryAxisAlignItems: 'MIN' as const,
      counterAxisAlignItems: 'MIN' as const,
      itemSpacing: 0,
      fills: [],
      strokes: [],
      width: 0,
      height: 0,
      children: [] as unknown[],
      appendChild(child: unknown) { this.children.push(child) },
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      }
    })
    await applyControlImportPlan(plan([source]), Object.assign(baseRepository, {
      createNodeFromSvg(svg: string) {
        imported.push(svg)
        return frame()
      }
    }))

    expect(imported).toHaveLength(1)
    expect(imported[0]).toContain('<svg fill="#ffffff"')
  })

  it('renders a compound input as one fixed-width shell with grouped actions', async () => {
    const baseControl = control('default', '1')
    const source: ControlToken = {
      ...baseControl,
      family: 'input',
      intent: 'neutral',
      geometry: {
        ...baseControl.geometry,
        height: 52,
        minWidth: 640,
        padding: { top: 6, right: 8, bottom: 6, left: 8 },
        gap: 8,
        radius: 26,
        borderWidth: 1
      },
      content: { kind: 'compound-input' },
      layout: { widthBehavior: 'fill' },
      sampleText: { value: 'Ask anything', source: 'placeholder' },
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>',
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
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 24 24"><path d="M12 4v10"/></svg>',
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
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>',
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
          vectorSvg: '<svg viewBox="0 0 24 24"><path d="M12 4v10"/></svg>',
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
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
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
      }
    }
    const created: ControlComponentPort[] = []
    const base = repository(created)
    const createFrame = () => ({
      type: 'FRAME' as const,
      name: '',
      layoutMode: 'NONE' as const,
      primaryAxisSizingMode: 'FIXED' as const,
      counterAxisSizingMode: 'FIXED' as const,
      primaryAxisAlignItems: 'MIN' as const,
      counterAxisAlignItems: 'MIN' as const,
      itemSpacing: 0,
      fills: [],
      strokes: [],
      width: 0,
      height: 0,
      layoutGrow: 0,
      children: [] as unknown[],
      appendChild(child: unknown) { this.children.push(child) },
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      }
    })
    const compoundRepository = Object.assign(base, {
      createFrame,
      createNodeFromSvg(svg: string) {
        const frame = createFrame()
        frame.name = `Imported ${svg.includes('<path') ? 'vector' : 'asset'}`
        return frame
      }
    })

    await applyControlImportPlan(plan([source]), compoundRepository)

    expect(created[0]).toMatchObject({
      name: expect.stringMatching(/^Control\/Input\//),
      primaryAxisSizingMode: 'FIXED',
      width: 640,
      height: 52,
      cornerRadius: 26
    })
    expect(created[0]?.children.map(child => child.name)).toEqual([
      'Leading actions',
      'Input region',
      'Trailing actions'
    ])
    expect(created[0]?.children[0]).toMatchObject({
      type: 'FRAME',
      children: [expect.objectContaining({
        type: 'FRAME',
        width: 36,
        height: 36,
        topLeftRadius: 4,
        topRightRadius: 4,
        bottomRightRadius: 4,
        bottomLeftRadius: 4,
        children: [expect.objectContaining({ type: 'FRAME', width: 20, height: 20 })]
      })]
    })
    expect(created[0]?.children[1]).toMatchObject({
      type: 'FRAME',
      layoutGrow: 1,
      children: [
        expect.objectContaining({
          type: 'TEXT',
          characters: 'Ask anything',
          fontSize: 14
        })
      ]
    })
    expect(created[0]?.children[2]).toMatchObject({
      type: 'FRAME',
      children: [
        expect.objectContaining({
          type: 'FRAME',
          width: 32,
          height: 32,
          topLeftRadius: 16,
          children: [expect.objectContaining({ width: 20, height: 20 })]
        }),
        expect.objectContaining({
          type: 'FRAME',
          width: 40,
          height: 40,
          topLeftRadius: 20,
          fills: [expect.objectContaining({ opacity: 1 })],
          children: [expect.objectContaining({ width: 20, height: 20 })]
        })
      ]
    })
  })

  it('renders a singular compound-row slot surface around only its own glyph', async () => {
    const base = control('default', '1')
    const source: ControlToken = {
      ...base,
      family: 'button',
      appearance: {
        ...base.appearance,
        background: { r: 1, g: 1, b: 1, a: 0 }
      },
      content: { kind: 'compound-row', textFlow: 'stacked', textGap: 2 },
      sampleText: { value: 'Primary', source: 'visible-text' },
      supportingText: { value: 'Supporting', source: 'visible-text' },
      supportingStyle: {
        typography: base.typography,
        foreground: base.appearance.foreground
      },
      slots: {
        leading: null,
        trailing: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 20 20"><path d="M3 10h14"/></svg>',
          surface: {
            width: 40,
            height: 40,
            background: { r: 1, g: 1, b: 1, a: 1 },
            foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
            border: { r: 0, g: 0, b: 0, a: 0 },
            borderWidth: 0,
            radii: { topLeft: 20, topRight: 20, bottomRight: 20, bottomLeft: 20 }
          }
        }
      }
    }
    const created: ControlComponentPort[] = []
    const baseRepository = repository(created)
    const createFrame = (): ControlFramePort => ({
      type: 'FRAME',
      name: '',
      layoutMode: 'NONE',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      itemSpacing: 0,
      fills: [],
      strokes: [],
      width: 0,
      height: 0,
      children: [],
      appendChild(child) { this.children.push(child) },
      resize(width, height) { this.width = width; this.height = height }
    })

    await applyControlImportPlan(plan([source]), Object.assign(baseRepository, {
      createFrame,
      createNodeFromSvg() { return createFrame() }
    }))

    const component = created[0]!
    const surface = component.children.filter(child =>
      child.type === 'FRAME' && child.name === 'Trailing action surface'
    ) as ControlFramePort[]
    expect(surface).toHaveLength(1)
    expect(surface[0]).toMatchObject({
      width: 40,
      height: 40,
      cornerRadius: 20,
      children: [expect.objectContaining({ width: 20, height: 20 })]
    })
    expect(component.children.filter(child =>
      child.type === 'FRAME' && child.name === 'Trailing UI icon'
    )).toHaveLength(0)
  })

  it('preserves a structural textarea width and height for use inside composites', async () => {
    const baseControl = control('default', '1')
    const source: ControlToken = {
      ...baseControl,
      family: 'textarea',
      intent: 'neutral',
      geometry: {
        ...baseControl.geometry,
        height: 152,
        minWidth: 608,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        radius: 0,
        borderWidth: 0
      },
      appearance: {
        ...baseControl.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      },
      content: { kind: 'text-only' },
      layout: { widthBehavior: 'fill' },
      sampleText: { value: 'Ask anything', source: 'placeholder' },
      slots: { leading: null, trailing: null }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]).toMatchObject({
      layoutMode: 'VERTICAL',
      width: 608,
      height: 152,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0
    })
    expect(created[0]?.children).toEqual([
      expect.objectContaining({ type: 'TEXT', characters: 'Ask anything' })
    ])
  })

  it('grows a compact component to the measured line height and padding', async () => {
    const source = {
      ...control('default', '1'),
      geometry: {
        ...control('default', '1').geometry,
        height: 18,
        padding: { top: 4, right: 8, bottom: 4, left: 8 }
      },
      typography: {
        ...control('default', '1').typography,
        lineHeightPx: 24
      },
      content: { kind: 'text-only' as const },
      sampleText: { value: 'Compact', source: 'visible-text' as const }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.height).toBeGreaterThanOrEqual(32)
    expect(created[0]?.clipsContent).toBe(false)
  })

  it('reuses a matching Icon component instance for ordinary icon-and-text controls', async () => {
    const vectorSvg = '<svg viewBox="0 0 24 24"><path d="M12 2v20"/></svg>'
    const source: ControlToken = {
      ...control('default', '1'),
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg
        },
        trailing: null
      },
      content: { kind: 'icon-and-text' },
      sampleText: { value: 'Create image', source: 'visible-text' }
    }
    const created: ControlComponentPort[] = []
    const createIconInstance = vi.fn(() => {
      const instance = {
        type: 'INSTANCE' as const,
        name: '',
        width: 24,
        height: 24,
        resize(width: number, height: number) {
          instance.width = width
          instance.height = height
        }
      }
      return instance
    })

    await applyControlImportPlan(
      plan([source]),
      Object.assign(repository(created), { createIconInstance })
    )

    expect(createIconInstance).toHaveBeenCalledWith(
      vectorSvg,
      source.appearance.foreground
    )
    expect(created[0]?.children).toEqual([
      expect.objectContaining({
        type: 'INSTANCE',
        name: 'Leading UI icon instance',
        width: 20,
        height: 20
      }),
      expect.objectContaining({
        type: 'TEXT',
        characters: 'Create image'
      })
    ])
  })

  it('removes an unattached direct Icon instance when configuration fails', async () => {
    const vectorSvg = '<svg viewBox="0 0 24 24"><path d="M12 2v20"/></svg>'
    const source: ControlToken = {
      ...control('default', '1'),
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg
        },
        trailing: null
      },
      content: { kind: 'icon-only' }
    }
    const instance = {
      type: 'INSTANCE' as const,
      name: '',
      width: 24,
      height: 24,
      resize: vi.fn(() => {
        throw new Error('icon resize failed')
      }),
      remove: vi.fn()
    }
    const repo = repository([])
    repo.createIconInstance = () => instance

    await expect(applyControlImportPlan(plan([source]), repo))
      .rejects.toThrow('icon resize failed')

    expect(instance.remove).toHaveBeenCalledOnce()
  })

  it('fails instead of drawing a detached vector when a confirmed UI icon cannot resolve', async () => {
    const vectorSvg = '<svg viewBox="0 0 24 24"><path d="M12 2v20"/></svg>'
    const source: ControlToken = {
      ...control('default', '1'),
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg
        },
        trailing: null
      },
      content: { kind: 'icon-and-text' },
      sampleText: { value: 'Create image', source: 'visible-text' }
    }
    const created: ControlComponentPort[] = []
    const createNodeFromSvg = vi.fn()

    await expect(applyControlImportPlan(
      plan([source]),
      Object.assign(repository(created), {
        createIconInstance: vi.fn(() => null),
        createNodeFromSvg
      })
    )).rejects.toThrow('Unable to resolve shared Icon Component')

    expect(createNodeFromSvg).not.toHaveBeenCalled()
  })

  it('keeps a narrow SVG proportional inside its wider observed slot', async () => {
    const vectorSvg =
      '<svg viewBox="0 0 5 10"><polygon points="0,0 5,5 0,10"/></svg>'
    const source: ControlToken = {
      ...control('default', '1'),
      slots: {
        leading: null,
        trailing: {
          width: 36,
          height: 10,
          assetType: 'ui-icon',
          vectorSvg
        }
      },
      content: { kind: 'icon-and-text' },
      sampleText: { value: 'Help', source: 'visible-text' }
    }
    const created: ControlComponentPort[] = []
    const createFrame = (): ControlFramePort => ({
      type: 'FRAME',
      name: '',
      layoutMode: 'NONE',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      itemSpacing: 0,
      fills: [],
      strokes: [],
      width: 0,
      height: 0,
      children: [],
      appendChild(child) { this.children.push(child) },
      resize(width, height) {
        this.width = width
        this.height = height
      }
    })
    const createIconInstance = vi.fn(() => ({
      type: 'INSTANCE' as const,
      name: '',
      width: 24,
      height: 24,
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      }
    }))
    const fittedRepository = Object.assign(repository(created), {
      createFrame,
      createIconInstance,
      createNodeFromSvg() {
        const imported = createFrame()
        imported.resize(5, 10)
        return imported
      }
    })

    await applyControlImportPlan(plan([source]), fittedRepository)

    expect(created[0]?.children).toContainEqual(expect.objectContaining({
      type: 'FRAME',
      name: 'Trailing UI icon slot',
      width: 36,
      height: 10,
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      children: [
        expect.objectContaining({
          name: 'Trailing UI icon',
          width: 5,
          height: 10
        })
      ]
    }))
  })

  it('reads shared ownership and writes both private and shared ownership', async () => {
    const created: ControlComponentPort[] = []
    const source = control('default', '1')
    const result = await applyControlImportPlan(plan([source]), repository(created))
    const component = result.created[0]!
    const expected = `https://example.com|${source.id}`

    expect(component.getSharedPluginData?.(
      CONTROL_SHARED_NAMESPACE,
      CONTROL_NODE_OWNERSHIP_KEY
    )).toBe(expected)
    component.setPluginData(CONTROL_NODE_OWNERSHIP_KEY, '')
    expect(readControlOwnership(component, CONTROL_NODE_OWNERSHIP_KEY)).toBe(expected)
  })

  it('falls back to shared ownership when private plugin data is unavailable', () => {
    const shared = new Map<string, string>([
      [`${CONTROL_SHARED_NAMESPACE}|${CONTROL_NODE_OWNERSHIP_KEY}`, 'shared-owner']
    ])
    const port = {
      getPluginData() { throw new Error('not implemented') },
      setPluginData() { throw new Error('not implemented') },
      getSharedPluginData(namespace: string, key: string) {
        return shared.get(`${namespace}|${key}`) ?? ''
      },
      setSharedPluginData(namespace: string, key: string, value: string) {
        shared.set(`${namespace}|${key}`, value)
      }
    }

    expect(readControlOwnership(port, CONTROL_NODE_OWNERSHIP_KEY)).toBe('shared-owner')
    writeControlOwnership(port, CONTROL_NODE_OWNERSHIP_KEY, 'next-owner')
    expect(readControlOwnership(port, CONTROL_NODE_OWNERSHIP_KEY)).toBe('next-owner')
  })

  it('represents a visible CSS outline as an outer ring effect', async () => {
    const source = {
      ...control('focus', '1'),
      appearance: {
        ...control('focus', '1').appearance,
        outline: { r: 0.04, g: 0.39, b: 0.86, a: 1 },
        outlineWidth: 2,
        outlineOffset: -3
      }
    }
    const created: ControlComponentPort[] = []
    await applyControlImportPlan(plan([source]), repository(created))

    expect(created[0]?.effects).toContainEqual({
      type: 'DROP_SHADOW',
      color: source.appearance.outline,
      offset: { x: 0, y: 0 },
      radius: 0,
      spread: 2,
      visible: true,
      blendMode: 'NORMAL',
      showShadowBehindNode: false
    })
  })

  it('combines observed states into a Component Set and owns both levels', async () => {
    const created: ControlComponentPort[] = []
    const result = await applyControlImportPlan(
      plan([control('hover', '2'), control('default', '1')]),
      repository(created)
    )
    expect(created.map(node => node.name)).toEqual(['State=Default', 'State=Hover'])
    expect(result.componentSets).toHaveLength(1)
    expect(result.componentSets[0]?.name)
      .toBe('Control/Button/Primary/SolidDark/Md/Light/TextOnly')
    expect(result.componentSets[0]?.getPluginData(CONTROL_GROUP_OWNERSHIP_KEY))
      .toBe(
        'https://example.com|presentation:button|primary|md|solid-dark|light|text-only'
      )
  })

  it('prepares a reused standalone component before combining a newly observed state', async () => {
    const defaultToken = control('default', '1')
    const hoverToken = control('hover', '2')
    const existing = fakeComponent('component:existing')
    writeControlOwnership(
      existing,
      CONTROL_NODE_OWNERSHIP_KEY,
      `https://example.com|${defaultToken.id}`
    )
    const importPlan = createControlImportPlan(
      scan([hoverToken, defaultToken]),
      [{
        id: existing.id,
        type: 'COMPONENT',
        name: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
        ownershipId: `https://example.com|${defaultToken.id}`,
        groupOwnershipId: null
      }],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const created: ControlComponentPort[] = []
    const base = repository(created)
    const events: string[] = []
    const combineAsVariants = base.combineAsVariants.bind(base)
    const prepareForVariantCombine = vi.fn(() => { events.push('prepare') })
    const repo = {
      ...base,
      prepareForVariantCombine,
      getNodeById: async (id: string) => id === existing.id ? existing : null,
      combineAsVariants(components: ControlComponentPort[]) {
        events.push('combine')
        return combineAsVariants(components)
      }
    }

    await applyControlImportPlan(importPlan, repo)

    expect(events).toEqual(['prepare', 'combine'])
    expect(prepareForVariantCombine).toHaveBeenCalledWith([
      existing,
      created[0]
    ])
  })

  it('reflows variant components horizontally after their final widths are known', async () => {
    const created: ControlComponentPort[] = []
    const tokens = [
      {
        ...control('focus', '2'),
        sampleText: { value: 'Search', source: 'visible-text' as const }
      },
      {
        ...control('default', '1'),
        sampleText: { value: 'Aa', source: 'visible-text' as const }
      }
    ]
    const result = await applyControlImportPlan(plan(tokens), repository(created))
    const set = result.componentSets[0] as typeof result.componentSets[number] & {
      width: number
      height: number
    }
    const [defaultVariant, focusVariant] = set.children as Array<
      ControlComponentPort & { x: number; y: number }
    >

    expect(defaultVariant).toMatchObject({ x: 0, y: 0 })
    expect(focusVariant).toMatchObject({
      x: defaultVariant!.width + 16,
      y: 0
    })
    expect(set.width).toBe(defaultVariant!.width + 16 + focusVariant!.width)
    expect(set.height).toBe(Math.max(defaultVariant!.height, focusVariant!.height))
  })

  it('reflows each surviving Component Set after stale variants are removed', async () => {
    const created: ControlComponentPort[] = []
    const result = await applyControlImportPlan(
      plan([control('hover', '2'), control('default', '1')]),
      repository(created)
    )
    const set = result.componentSets[0]!
    set.children[0]!.x = 240
    set.children[1]!.x = 520
    set.resize(999, 999)

    reflowAppliedControlComponentSets(result.applied)

    expect(set.children[0]).toMatchObject({ x: 0, y: 0 })
    expect(set.children[1]).toMatchObject({
      x: set.children[0]!.width + 16,
      y: 0
    })
    expect(set.width).toBe(
      set.children[0]!.width + 16 + set.children[1]!.width
    )
    expect(set.height).toBe(Math.max(
      set.children[0]!.height,
      set.children[1]!.height
    ))
  })

  it('reflows reused variants in deterministic control-state order', () => {
    const expanded = fakeComponent('expanded')
    expanded.name = 'State=Expanded'
    const defaultVariant = fakeComponent('default')
    defaultVariant.name = 'State=Default'
    const set = {
      id: 'set:reused',
      type: 'COMPONENT_SET' as const,
      name: 'Control/Button/Primary/Soft/Sm/Light/IconBoth',
      children: [expanded, defaultVariant],
      width: 1,
      height: 1,
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      }
    } as ControlComponentSetPort & { width: number; height: number }

    reflowControlComponentSet(set)

    expect(defaultVariant).toMatchObject({ x: 0, y: 0 })
    expect(expanded).toMatchObject({ x: defaultVariant.width + 16, y: 0 })
  })

  it('creates only observed default and selected variants', async () => {
    const created: ControlComponentPort[] = []
    const result = await applyControlImportPlan(
      plan([control('selected', '2'), control('default', '1')]),
      repository(created)
    )

    expect(created.map(node => node.name)).toEqual([
      'State=Default',
      'State=Selected'
    ])
    expect(result.componentSets).toHaveLength(1)
    expect(result.componentSets[0]?.children).toHaveLength(2)
  })

  it('restores updated nodes and removes new nodes if a later update fails', async () => {
    const first = fakeComponent('component:first')
    first.name = 'Original'
    first.description = 'Original description'
    first.resize(180, 72)
    const second = fakeComponent('component:second')
    Object.defineProperty(second, 'fills', {
      get: () => [],
      set: () => { throw new Error('Figma rejected fills') }
    })
    const tokens = [control('default', '1'), {
      ...control('default', '2'),
      groupId: `sha256:${'8'.repeat(64)}`,
      slots: { leading: { width: 20, height: 20 }, trailing: null },
      content: { kind: 'icon-only' as const }
    }]
    const importPlan = createControlImportPlan(scan(tokens), [
      {
        id: first.id,
        type: 'COMPONENT',
        name: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
        ownershipId: `https://example.com|${tokens[0]!.id}`, groupOwnershipId: null
      },
      {
        id: second.id,
        type: 'COMPONENT',
        name: 'Control/Button/Primary/SolidDark/Md/Light/IconOnly',
        ownershipId: `https://example.com|${tokens[1]!.id}`, groupOwnershipId: null
      }
    ], [{ family: 'Arial', style: 'Regular' }])
    const updateEntries = importPlan.groups.flatMap(group => group.entries)
    expect(updateEntries).toHaveLength(2)
    for (const group of importPlan.groups) {
      group.action = 'update'
      for (const entry of group.entries) {
        entry.action = 'update'
        entry.existingComponentId = updateEntries.indexOf(entry) === 0
          ? first.id
          : second.id
      }
    }
    const created: ControlComponentPort[] = []
    const repo = repository(created)
    repo.getNodeById = async id => id === first.id ? first : second
    const originalBackupChildren = repo.backupChildren!
    let mutatedFirst = false
    repo.backupChildren = component => {
      const backup = originalBackupChildren(component)
      if (component === first) {
        mutatedFirst = true
        component.resize(1, 1)
      }
      return backup
    }

    await expect(applyControlImportPlan(importPlan, repo)).rejects.toThrow('Figma rejected fills')
    expect(first.name).toBe('Original')
    expect(first.description).toBe('Original description')
    expect(mutatedFirst).toBe(true)
    expect(first).toMatchObject({ width: 180, height: 72 })
    expect(created.every(node => vi.mocked(node.remove).mock.calls.length > 0)).toBe(true)
  })

  it('removes an unattached compound text stack when font loading fails', async () => {
    const source: ControlToken = {
      ...control('default', '1'),
      content: { kind: 'compound-row', textFlow: 'stacked', textGap: 4 },
      sampleText: { value: 'Primary', source: 'visible-text' }
    }
    const frame = {
      type: 'FRAME',
      name: '',
      layoutMode: 'NONE',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      itemSpacing: 0,
      fills: [],
      strokes: [],
      width: 1,
      height: 1,
      children: [],
      appendChild(child: ControlFramePort['children'][number]) {
        this.children.push(child as never)
      },
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      },
      remove: vi.fn()
    } as ControlFramePort
    const repo = repository([])
    repo.createFrame = () => frame
    repo.loadFont = vi.fn().mockRejectedValue(new Error('font load failed'))

    await expect(applyControlImportPlan(plan([source]), repo))
      .rejects.toThrow('font load failed')

    expect(frame.remove).toHaveBeenCalledOnce()
  })

  it('captures placement before moving existing children into rollback storage', async () => {
    const source = control('default', '1')
    const importPlan = plan([source])
    const group = importPlan.groups[0]!
    const entry = group.entries[0]!
    const existing = fakeComponent('component:existing-order')
    group.action = 'update'
    entry.action = 'update'
    entry.existingComponentId = existing.id
    const order: string[] = []
    const repo = repository([])
    repo.getNodeById = async () => existing
    const originalBackupChildren = repo.backupChildren!
    const originalBackupPlacement = repo.backupPlacement!
    repo.backupChildren = component => {
      order.push('children')
      return originalBackupChildren(component)
    }
    repo.backupPlacement = component => {
      order.push('placement')
      return originalBackupPlacement(component)
    }

    await applyControlImportPlan(importPlan, repo)

    expect(order).toEqual(['placement', 'children'])
  })

  it('does not report a committed Control import as failed when backup disposal fails', async () => {
    const source = control('default', '1')
    const importPlan = plan([source])
    const group = importPlan.groups[0]!
    const entry = group.entries[0]!
    const existing = fakeComponent('component:existing-disposal')
    group.action = 'update'
    entry.action = 'update'
    entry.existingComponentId = existing.id
    const repo = repository([])
    repo.getNodeById = async () => existing
    repo.discardChildrenBackup = vi.fn(() => {
      throw new Error('backup remove failed')
    })

    const result = await applyControlImportPlan(importPlan, repo)

    expect(result.updated).toEqual([existing])
    expect(repo.discardChildrenBackup).toHaveBeenCalledOnce()
  })

  it('retains the only child backup when rollback restoration fails', async () => {
    const source = control('default', '1')
    const importPlan = plan([source])
    const group = importPlan.groups[0]!
    const entry = group.entries[0]!
    const existing = fakeComponent('component:failed-control-restore')
    Object.defineProperty(existing, 'fills', {
      get: () => [],
      set: () => { throw new Error('control configuration failed') }
    })
    group.action = 'update'
    entry.action = 'update'
    entry.existingComponentId = existing.id
    const backup = { kind: 'only-control-backup' }
    const repo = repository([])
    repo.getNodeById = async () => existing
    repo.backupChildren = () => backup
    repo.restoreChildren = vi.fn(() => {
      throw new Error('control restoration failed')
    })
    repo.discardChildrenBackup = vi.fn()

    await expect(applyControlImportPlan(importPlan, repo))
      .rejects.toThrow('control configuration failed')

    expect(repo.restoreChildren).toHaveBeenCalledWith(existing, backup)
    expect(repo.discardChildrenBackup).not.toHaveBeenCalledWith(backup)
  })

  it('does not delete a reused Control Component Set when a later group fails', async () => {
    const defaultToken = control('default', '1')
    const hoverToken = control('hover', '2')
    const failingToken = {
      ...control('default', '3'),
      groupId: `sha256:${'8'.repeat(64)}`,
      slots: { leading: { width: 20, height: 20 }, trailing: null },
      content: { kind: 'icon-only' as const }
    }
    const importPlan = plan([defaultToken, hoverToken, failingToken])
    const stateGroup = importPlan.groups.find(group => group.kind === 'component_set')!
    const failingGroup = importPlan.groups.find(group => group !== stateGroup)!
    importPlan.groups = [stateGroup, failingGroup]
    const first = fakeComponent('component:first-state')
    const second = fakeComponent('component:second-state')
    const failing = fakeComponent('component:failing')
    Object.defineProperty(failing, 'fills', {
      get: () => [],
      set: () => { throw new Error('Figma rejected later control') }
    })
    stateGroup.action = 'update'
    stateGroup.existingGroupNodeId = 'set:existing-control'
    stateGroup.entries.forEach((entry, index) => {
      entry.action = 'update'
      entry.existingComponentId = index === 0 ? first.id : second.id
    })
    failingGroup.action = 'update'
    failingGroup.entries[0]!.action = 'update'
    failingGroup.entries[0]!.existingComponentId = failing.id
    first.x = 17
    first.y = 9
    second.x = 131
    second.y = 11
    const setData = new Map<string, string>([[
      CONTROL_GROUP_OWNERSHIP_KEY,
      'previous-control-set-ownership'
    ]])
    const existingSet = {
      id: 'set:existing-control',
      type: 'COMPONENT_SET',
      name: 'Previous control set',
      description: 'Previous description',
      width: 444,
      height: 222,
      children: [first, second],
      resize(width: number, height: number) {
        this.width = width
        this.height = height
      },
      setPluginData(key: string, value: string) { setData.set(key, value) },
      getPluginData(key: string) { return setData.get(key) ?? '' },
      remove: vi.fn()
    } as ControlComponentSetPort
    const repo = repository([])
    repo.getNodeById = async nodeId => {
      if (nodeId === existingSet.id) return existingSet
      if (nodeId === first.id) return first
      if (nodeId === second.id) return second
      if (nodeId === failing.id) return failing
      return null
    }

    await expect(applyControlImportPlan(importPlan, repo))
      .rejects.toThrow('Figma rejected later control')

    expect(existingSet.remove).not.toHaveBeenCalled()
    expect(existingSet).toMatchObject({
      name: 'Previous control set',
      description: 'Previous description',
      width: 444,
      height: 222,
      children: [first, second]
    })
    expect(first).toMatchObject({ x: 17, y: 9 })
    expect(second).toMatchObject({ x: 131, y: 11 })
    expect(existingSet.getPluginData(CONTROL_GROUP_OWNERSHIP_KEY))
      .toBe('previous-control-set-ownership')
  })

  it('reports protected name conflicts without creating nodes', async () => {
    const source = control('default', '1')
    const importPlan = createControlImportPlan(scan([source]), [{
      id: 'component:user',
      type: 'COMPONENT',
      name: 'Control/Button/Primary/SolidDark/Md/Light/TextOnly',
      ownershipId: null, groupOwnershipId: null
    }], [{ family: 'Arial', style: 'Regular' }])
    const created: ControlComponentPort[] = []
    const result = await applyControlImportPlan(importPlan, repository(created))
    expect(created).toEqual([])
    expect(result.conflicts)
      .toEqual(['Control/Button/Primary/SolidDark/Md/Light/TextOnly'])
  })
})
