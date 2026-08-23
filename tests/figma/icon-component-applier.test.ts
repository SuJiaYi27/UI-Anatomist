import { describe, expect, it, vi } from 'vitest'
import type { IconToken, ScanExport } from '../../src/shared/schema'
import { createIconImportPlan } from '../../src/figma/icon-import-plan'
import {
  applyIconImportPlan,
  ICON_NODE_OWNERSHIP_KEY,
  type IconComponentPort,
  type IconComponentSetPort,
  type IconFramePort,
  type IconRectanglePort,
  type IconVectorPort
} from '../../src/figma/icon-component-applier'

const baseIcon: IconToken = {
  id: `sha256:${'1'.repeat(64)}`,
  name: 'image',
  nameSource: 'svg-title',
  category: 'navigation',
  vectorSvg: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/></svg>',
  viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
  observedSizes: [{ width: 20, height: 20, occurrences: 1 }],
  themes: [{
    theme: 'light',
    color: { r: 0, g: 0, b: 0, a: 1 },
    occurrences: 1
  }],
  occurrences: 1,
  stateOccurrences: 1
}

function scan(icon: IconToken): ScanExport {
  return {
    schemaVersion: '1.8.0',
    source: {
      siteLabel: 'example.com',
      origin: 'https://example.com',
      scannedAt: '2026-07-25T00:00:00.000Z',
      locale: 'zh-CN',
      platform: 'macOS'
    },
    typography: [],
    borderRadii: [],
    shadows: [],
    colors: { primitives: [], semantic: [], interactive: [] },
    spacing: [],
    controls: [],
    icons: [icon],
    traversal: {
      visitedStates: 1,
      skippedUnsafe: 0,
      skippedUncertain: 0,
      failures: 0
    },
    filtered: { brandAssets: 0, personalTextNodes: 0 }
  }
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

function component(id: string): IconComponentPort {
  const item = {
    id,
    type: 'COMPONENT' as const,
    name: '',
    description: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fills: [],
    children: [] as Array<IconVectorPort | IconRectanglePort>,
    resize(width: number, height: number) {
      item.width = width
      item.height = height
    },
    appendChild(child: IconVectorPort | IconRectanglePort) {
      const previous = (child as IconVectorPort & {
        __parent?: IconComponentPort
      }).__parent
      if (previous) {
        previous.children = previous.children.filter(item => item !== child)
      }
      ;(child as IconVectorPort & { __parent?: IconComponentPort }).__parent = item
      item.children.push(child)
    },
    remove: vi.fn(),
    ...pluginData()
  }
  return item
}

function componentSet(
  id: string,
  children: IconComponentPort[] = []
): IconComponentSetPort {
  const set = {
    id,
    type: 'COMPONENT_SET' as const,
    name: '',
    description: '',
    children,
    width: 0,
    height: 0,
    resize(width: number, height: number) {
      set.width = width
      set.height = height
    },
    appendChild(child: IconComponentPort) {
      set.children.push(child)
    },
    remove: vi.fn(),
    ...pluginData()
  }
  return set
}

function vector(): IconVectorPort {
  return {
    type: 'VECTOR',
    name: '',
    x: 2,
    y: 2,
    width: 20,
    height: 20,
    fills: [],
    strokes: [],
    remove: vi.fn()
  }
}

function rectangle(): IconRectanglePort {
  const item: IconRectanglePort = {
    type: 'RECTANGLE',
    name: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    cornerRadius: 0,
    fills: [],
    resize(width, height) {
      item.width = width
      item.height = height
    },
    remove: vi.fn()
  }
  return item
}

function repository(options: {
  components?: IconComponentPort[]
  existing?: IconComponentPort | IconComponentSetPort | null
  set?: IconComponentSetPort
  throwOnSvg?: boolean
} = {}) {
  const components = [...(options.components ?? [])]
  const set = options.set ?? componentSet('set:new')
  const combineAsVariants = vi.fn((items: IconComponentPort[]) => {
    if (items.length < 2) {
      throw new Error('real Component Sets require at least two variants')
    }
    set.children = [...items]
    return set
  })
  return {
    port: {
      createComponent: () => components.shift() ?? component('component:auto'),
      createRectangle: rectangle,
      createNodeFromSvg: () => {
        if (options.throwOnSvg) throw new Error('invalid svg')
        return {
          type: 'FRAME',
          children: [vector()],
          remove: vi.fn()
        } as IconFramePort
      },
      flatten: (nodes: Array<IconVectorPort | IconRectanglePort>) =>
        nodes[0] as IconVectorPort,
      combineAsVariants,
      getNodeById: async () => options.existing ?? null,
      bindVectorColor: vi.fn(),
      bindRectangleColor: vi.fn()
    },
    combineAsVariants,
    set
  }
}

const variables = {
  primary: { id: 'variable:primary' },
  hoverBackgroundByIconId: new Map<string, { id: string }>()
}

describe('applyIconImportPlan evidence-only assets', () => {
  it('creates one Component and no Component Set when no state surface was observed', async () => {
    const created = component('component:plain')
    const fake = repository({ components: [created] })

    const result = await applyIconImportPlan(
      createIconImportPlan(scan(baseIcon), []),
      fake.port,
      variables
    )

    expect(fake.combineAsVariants).not.toHaveBeenCalled()
    expect(result.componentSets).toEqual([])
    expect(result.assets).toEqual([created])
    expect(result.applied[0]).toMatchObject({
      asset: created,
      componentSet: null,
      components: [created]
    })
    expect(created).toMatchObject({
      name: 'Icon/Navigation/Image',
      width: 24,
      height: 24
    })
    expect(created.getPluginData(ICON_NODE_OWNERSHIP_KEY)).toBe(
      `https://example.com|icon:${baseIcon.id}`
    )
  })

  it('creates a reusable Glyph variant alongside one observed Hover surface', async () => {
    const hoverOnly: IconToken = {
      ...baseIcon,
      interactionSurfaces: [{
        state: 'hover',
        theme: 'light',
        background: { r: 0.92, g: 0.92, b: 0.92, a: 1 },
        width: 32,
        height: 32,
        radii: {
          topLeft: 4,
          topRight: 4,
          bottomRight: 4,
          bottomLeft: 4
        },
        occurrences: 1
      }]
    }
    const glyph = component('component:glyph')
    const hover = component('component:hover')
    const set = componentSet('set:hover')
    const fake = repository({ components: [glyph, hover], set })
    const hoverVariables = {
      ...variables,
      hoverBackgroundByIconId: new Map([[
        baseIcon.id,
        { id: 'variable:hover' }
      ]])
    }

    const result = await applyIconImportPlan(
      createIconImportPlan(scan(hoverOnly), []),
      fake.port,
      hoverVariables
    )

    expect(fake.combineAsVariants).toHaveBeenCalledWith([glyph, hover])
    expect(result.applied[0]!.entry.states).toEqual(['Glyph', 'Hover'])
    expect(glyph).toMatchObject({ width: 24, height: 24 })
    expect(glyph.children).toEqual([
      expect.objectContaining({ type: 'VECTOR', x: 2, y: 2 })
    ])
    expect(hover).toMatchObject({ width: 32, height: 32 })
    expect(hover.children).toEqual([
      expect.objectContaining({
        type: 'RECTANGLE',
        name: 'Hover background',
        width: 32,
        height: 32,
        topLeftRadius: 4,
        topRightRadius: 4,
        bottomRightRadius: 4,
        bottomLeftRadius: 4
      }),
      expect.objectContaining({ type: 'VECTOR', x: 6, y: 6 })
    ])
  })

  it('creates a Glyph master plus the two distinct observed surface variants', async () => {
    const stateful: IconToken = {
      ...baseIcon,
      interactionSurfaces: [
        {
          state: 'default',
          theme: 'light',
          background: { r: 1, g: 1, b: 1, a: 0 },
          width: 36,
          height: 36,
          radii: {
            topLeft: 18,
            topRight: 18,
            bottomRight: 18,
            bottomLeft: 18
          },
          occurrences: 1
        },
        {
          state: 'hover',
          theme: 'light',
          background: { r: 0.92, g: 0.92, b: 0.92, a: 1 },
          width: 32,
          height: 32,
          radii: {
            topLeft: 4,
            topRight: 4,
            bottomRight: 4,
            bottomLeft: 4
          },
          occurrences: 1
        }
      ]
    }
    const glyphComponent = component('component:glyph')
    const defaultComponent = component('component:default')
    const hoverComponent = component('component:hover')
    const set = componentSet('set:stateful')
    const fake = repository({
      components: [glyphComponent, defaultComponent, hoverComponent],
      set
    })

    const result = await applyIconImportPlan(
      createIconImportPlan(scan(stateful), []),
      fake.port,
      {
        primary: variables.primary,
        defaultBackgroundByIconId: new Map([[
          baseIcon.id,
          { id: 'variable:default' }
        ]]),
        hoverBackgroundByIconId: new Map([[
          baseIcon.id,
          { id: 'variable:hover' }
        ]])
      }
    )

    expect(fake.combineAsVariants).toHaveBeenCalledOnce()
    expect(fake.combineAsVariants).toHaveBeenCalledWith([
      glyphComponent,
      defaultComponent,
      hoverComponent
    ])
    expect(result.assets).toEqual([set])
    expect(result.componentSets).toEqual([set])
    expect(result.applied[0]).toMatchObject({
      asset: set,
      componentSet: set,
      components: [glyphComponent, defaultComponent, hoverComponent]
    })
    expect(set.children.map(child => child.name)).toEqual([
      'State=Glyph',
      'State=Default',
      'State=Hover'
    ])
    expect(set.children.map(child => [child.x, child.y, child.width, child.height]))
      .toEqual([
        [0, 0, 24, 24],
        [40, 0, 36, 36],
        [92, 0, 36, 36]
      ])
  })

  it('uses the per-icon accent variable for every evidence-backed state', async () => {
    const created = component('component:accent')
    const fake = repository({ components: [created] })

    await applyIconImportPlan(
      createIconImportPlan(scan(baseIcon), []),
      fake.port,
      {
        ...variables,
        accentByIconId: new Map([[
          baseIcon.id,
          { id: 'variable:accent' }
        ]])
      }
    )

    expect(fake.port.bindVectorColor).toHaveBeenCalledOnce()
    expect(fake.port.bindVectorColor).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'variable:accent' }
    )
  })
})

describe('applyIconImportPlan safe migrations', () => {
  it('migrates an owned legacy two-state set to one Component and keeps the replacement stable on repeat import', async () => {
    const oldDefault = component('old:default')
    oldDefault.name = 'State=Default'
    const oldHover = component('old:hover')
    oldHover.name = 'State=Hover'
    const legacySet = componentSet('set:legacy', [oldDefault, oldHover])
    legacySet.name = 'Icon/Navigation/Image'
    const ownershipId = `https://example.com|icon:${baseIcon.id}`
    const replacement = component('component:replacement')
    const first = repository({
      components: [replacement],
      existing: legacySet
    })
    const existing = [{
      id: legacySet.id,
      type: legacySet.type,
      name: legacySet.name,
      ownershipId
    }]

    const migrated = await applyIconImportPlan(
      createIconImportPlan(scan(baseIcon), existing),
      first.port,
      variables
    )

    expect(first.combineAsVariants).not.toHaveBeenCalled()
    expect(legacySet.remove).toHaveBeenCalledOnce()
    expect(replacement.remove).not.toHaveBeenCalled()
    expect(migrated.updated).toEqual([replacement])
    expect(replacement.getPluginData(ICON_NODE_OWNERSHIP_KEY)).toBe(ownershipId)

    const staging = component('component:staging')
    const second = repository({
      components: [staging],
      existing: replacement
    })
    const repeated = await applyIconImportPlan(
      createIconImportPlan(scan(baseIcon), [{
        id: replacement.id,
        type: replacement.type,
        name: replacement.name,
        ownershipId
      }]),
      second.port,
      variables
    )

    expect(repeated.updated).toEqual([replacement])
    expect(repeated.assets).toEqual([replacement])
    expect(staging.remove).toHaveBeenCalledOnce()
    expect(replacement.id).toBe('component:replacement')
    expect(legacySet.remove).toHaveBeenCalledOnce()
  })

  it('keeps the owned legacy set intact when replacement configuration fails', async () => {
    const legacySet = componentSet('set:legacy', [
      component('old:default'),
      component('old:hover')
    ])
    legacySet.name = 'Icon/Navigation/Image'
    const replacement = component('component:replacement')
    const fake = repository({
      components: [replacement],
      existing: legacySet,
      throwOnSvg: true
    })

    await expect(applyIconImportPlan(
      createIconImportPlan(scan(baseIcon), [{
        id: legacySet.id,
        type: legacySet.type,
        name: legacySet.name,
        ownershipId: `https://example.com|icon:${baseIcon.id}`
      }]),
      fake.port,
      variables
    )).rejects.toThrow('invalid svg')

    expect(replacement.remove).toHaveBeenCalledOnce()
    expect(legacySet.remove).not.toHaveBeenCalled()
    expect(legacySet.children).toHaveLength(2)
  })

  it('replaces all variants before removing old variants so a real set never drops below two children', async () => {
    const events: string[] = []
    const oldDefault = component('old:default')
    oldDefault.name = 'State=Default'
    const oldHover = component('old:hover')
    oldHover.name = 'State=Hover'
    const replacementGlyph = component('new:glyph')
    const replacementDefault = component('new:default')
    const replacementHover = component('new:hover')
    const set = componentSet('set:existing', [oldDefault, oldHover])
    set.name = 'Icon/Navigation/Image'
    set.appendChild = item => {
      events.push(`append:${item.id}`)
      set.children.push(item)
    }
    const removeOld = (item: IconComponentPort) => {
      if (set.children.length <= 2) {
        throw new Error('component set dissolved')
      }
      set.children = set.children.filter(child => child !== item)
      events.push(`remove:${item.id}`)
    }
    oldDefault.remove = vi.fn(() => removeOld(oldDefault))
    oldHover.remove = vi.fn(() => removeOld(oldHover))
    const stateful: IconToken = {
      ...baseIcon,
      interactionSurfaces: [
        {
          state: 'default',
          theme: 'light',
          background: { r: 1, g: 1, b: 1, a: 0 },
          width: 36,
          height: 36,
          radii: {
            topLeft: 18,
            topRight: 18,
            bottomRight: 18,
            bottomLeft: 18
          },
          occurrences: 1
        },
        {
          state: 'hover',
          theme: 'light',
          background: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
          width: 32,
          height: 32,
          radii: {
            topLeft: 4,
            topRight: 4,
            bottomRight: 4,
            bottomLeft: 4
          },
          occurrences: 1
        }
      ]
    }
    const fake = repository({
      components: [replacementGlyph, replacementDefault, replacementHover],
      existing: set
    })

    await applyIconImportPlan(
      createIconImportPlan(scan(stateful), [{
        id: set.id,
        type: set.type,
        name: set.name,
        ownershipId: `https://example.com|icon:${baseIcon.id}`
      }]),
      fake.port,
      variables
    )

    expect(fake.combineAsVariants).not.toHaveBeenCalled()
    expect(events).toEqual([
      'append:new:glyph',
      'append:new:default',
      'append:new:hover',
      'remove:old:default',
      'remove:old:hover'
    ])
    expect(set.children.map(child => child.name)).toEqual([
      'State=Glyph',
      'State=Default',
      'State=Hover'
    ])
  })
})
