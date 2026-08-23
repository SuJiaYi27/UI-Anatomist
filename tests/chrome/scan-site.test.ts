import { describe, expect, it, vi } from 'vitest'
import type {
  BorderRadiusToken,
  Colors,
  ControlToken,
  IconToken,
  PrimitiveColorToken,
  SemanticColorToken,
  ShadowToken,
  SpacingToken,
  TypographyStyle
} from '../../src/shared/schema'
import { scanSite } from '../../src/chrome/background/scan-site'
import { stableIconId } from '../../src/shared/stable-id'

const style: TypographyStyle = {
  id: `sha256:${'a'.repeat(64)}`,
  name: 'body-regular',
  fontFamilyStack: ['Arial'],
  fontStyle: 'normal',
  fontSizePx: 16,
  fontWeight: 400,
  lineHeightPx: 24,
  letterSpacingPx: 0,
  role: 'body',
  occurrences: 1
}

const radius: BorderRadiusToken = {
  id: `sha256:${'b'.repeat(64)}`,
  name: 'radius-8',
  kind: 'px',
  value: 8,
  occurrences: 1
}

const shadow: ShadowToken = {
  id: `sha256:${'c'.repeat(64)}`,
  name: 'shadow-outer-x0-y4-b12-s0-a15',
  layers: [{
    kind: 'outer',
    offsetX: 0,
    offsetY: 4,
    blur: 12,
    spread: 0,
    color: { r: 0, g: 0, b: 0, a: 0.15 }
  }],
  occurrences: 1
}

const whitePrimitive: PrimitiveColorToken = {
  id: `sha256:${'d'.repeat(64)}`,
  name: 'neutral-0',
  value: { r: 1, g: 1, b: 1, a: 1 },
  family: 'neutral',
  step: 0,
  provenance: 'observed',
  occurrences: 1
}

const backgroundColor: SemanticColorToken = {
  id: `sha256:${'e'.repeat(64)}`,
  name: 'background-primary',
  group: 'background',
  value: whitePrimitive.value,
  primitiveId: whitePrimitive.id,
  provenance: 'observed',
  occurrences: 1
}

const colors: Colors = {
  primitives: [whitePrimitive],
  semantic: [backgroundColor],
  interactive: []
}

const emptyColors = (): Colors => ({ primitives: [], semantic: [], interactive: [] })

const spacingToken = (
  idCharacter: string,
  value: number,
  evidence: SpacingToken['evidence']
): SpacingToken => ({
  id: `sha256:${idCharacter.repeat(64)}`,
  name: `spacing-${value}`,
  value,
  occurrences: evidence.padding + evidence.gap + evidence.margin,
  evidence,
  stateOccurrences: 1
})

const control: ControlToken = {
  id: `sha256:${'6'.repeat(64)}`,
  groupId: `sha256:${'7'.repeat(64)}`,
  name: 'button-primary-md',
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
    fontFamilyStack: ['Arial'],
    fontStyle: 'normal',
    fontSizePx: 14,
    fontWeight: 400,
    lineHeightPx: 20,
    letterSpacingPx: 0
  },
  slots: { leading: null, trailing: null },
  occurrences: 1,
  stateOccurrences: 1
}

const radiusToken = (
  idCharacter: string,
  kind: BorderRadiusToken['kind'],
  value: number | null
): BorderRadiusToken => ({
  id: `sha256:${idCharacter.repeat(64)}`,
  name: kind === 'full' ? 'radius-full' : `radius-${value}`,
  kind,
  value,
  occurrences: 1
} as BorderRadiusToken)

const emptyInspection = () => ({
  typography: [],
  borderRadii: [],
  shadows: [],
  colors: emptyColors(),
  spacing: [],
  controls: [],
  composites: [],
  icons: [],
  diagnostics: { disclosures: [] },
  revealedStates: 0,
  candidates: [],
  filtered: { brandAssets: 0, personalTextNodes: 0 }
})

const icon: IconToken = {
  id: `sha256:${'f'.repeat(64)}`,
  name: 'search',
  category: 'navigation',
  vectorSvg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4z"/></svg>',
  viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
  observedSizes: [{ width: 20, height: 20, occurrences: 1 }],
  themes: [{
    theme: 'light',
    color: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
    occurrences: 1
  }],
  occurrences: 1,
  stateOccurrences: 1
}

describe('scanSite', () => {
  it('merges anonymous disclosure diagnostics across inspected pages', async () => {
    const diagnostic = {
      candidateId: `sha256:${'1'.repeat(64)}`,
      elementKind: 'native-button' as const,
      popupKind: 'menu' as const,
      hasExpanded: true,
      hasControls: false,
      nativeDetails: false,
      fileRisk: 'none' as const,
      risk: 'safe' as const,
      riskReason: 'structural-disclosure' as const,
      stage: 'classified' as const,
      occurrences: 2
    }
    const controlDiagnostic = {
      candidateId: `sha256:${'2'.repeat(64)}`,
      pageId: `sha256:${'3'.repeat(64)}`,
      family: 'input' as const,
      stage: 'rejected-no-painted-frame' as const,
      occurrences: 2
    }
    let inspection = 0
    const result = await scanSite({
      async open() { return 1 },
      async inspect() {
        const first = inspection++ === 0
        return {
          ...emptyInspection(),
          diagnostics: {
            disclosures: [{
              ...diagnostic,
              occurrences: first ? 2 : 3
            }],
            controls: [{
              ...controlDiagnostic,
              occurrences: first ? 2 : 3
            }]
          },
          candidates: first ? [{
            target: 'navigate' as const,
            url: 'https://example.com/projects',
            risk: 'safe' as const
          }] : []
        }
      },
      async navigate() {},
      async close() {}
    }, {
      startUrl: 'https://example.com/',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.diagnostics.disclosures).toEqual([{ ...diagnostic, occurrences: 5 }])
    expect(result.diagnostics.controls).toEqual([{
      ...controlDiagnostic,
      occurrences: 5
    }])
  })

  it('keeps content instances separate and links only matching logical state evidence', async () => {
    const templateId = `sha256:${'1'.repeat(64)}`
    const firstLogicalId = `sha256:${'2'.repeat(64)}`
    const secondLogicalId = `sha256:${'3'.repeat(64)}`
    const firstInstanceId = `sha256:${'4'.repeat(64)}`
    const secondInstanceId = `sha256:${'5'.repeat(64)}`
    const defaultId = control.id
    const hoverId = `sha256:${'8'.repeat(64)}`
    const compositeLogicalId = `sha256:${'9'.repeat(64)}`
    const compositeTemplateId = `sha256:${'a'.repeat(64)}`
    const baseControls = [{
      ...control,
      id: defaultId,
      groupId: templateId,
      templateId,
      logicalControlId: firstLogicalId,
      instanceId: firstInstanceId,
      sampleText: { value: 'Search the web', source: 'visible-text' as const }
    }, {
      ...control,
      id: defaultId,
      groupId: templateId,
      templateId,
      logicalControlId: secondLogicalId,
      instanceId: secondInstanceId,
      sampleText: { value: 'Create an image', source: 'visible-text' as const }
    }]
    const compositeBase = {
      templateId: compositeTemplateId,
      logicalCompositeId: compositeLogicalId,
      name: 'menu-vertical',
      kind: 'menu' as const,
      geometry: {
        width: 240,
        height: 96,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 4,
        radius: 12,
        borderWidth: 0
      },
      appearance: control.appearance,
      layout: {
        direction: 'vertical' as const,
        align: 'stretch' as const,
        justify: 'start' as const,
        wrap: false,
        widthBehavior: 'hug' as const
      },
      occurrences: 1,
      stateOccurrences: 1
    }
    let inspection = 0
    const adapter = {
      async open() { return 65 },
      async inspect() {
        const first = inspection++ === 0
        const controls = first ? baseControls : [{
          ...baseControls[0]!,
          id: hoverId,
          state: 'hover' as const,
          appearance: {
            ...control.appearance,
            background: { r: 0.9, g: 0.9, b: 0.9, a: 1 }
          }
        }, baseControls[1]!]
        return {
          ...emptyInspection(),
          controls,
          composites: [{
            ...compositeBase,
            id: `sha256:${(first ? 'b' : 'c').repeat(64)}`,
            state: first ? 'default' as const : 'hover' as const,
            children: controls.map(item => ({
              kind: 'control' as const,
              controlId: item.id,
              instanceId: item.instanceId,
              state: item.state
            }))
          }],
          candidates: first ? [{
            target: 'navigate' as const,
            url: 'https://example.com/plugins',
            risk: 'safe' as const
          }] : []
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.controls).toHaveLength(3)
    expect(result.controls.filter(token => token.logicalControlId === firstLogicalId)
      .map(token => token.state).sort()).toEqual(['default', 'hover'])
    expect(result.controls.filter(token => token.logicalControlId === secondLogicalId))
      .toHaveLength(1)
    expect(result.composites).toHaveLength(2)
    expect(result.composites.every(composite =>
      composite.logicalCompositeId === compositeLogicalId
    )).toBe(true)
  })

  it('carries explored interaction families across page inspections in one scan', async () => {
    const contexts: string[][] = []
    let inspection = 0
    const adapter = {
      async open() { return 68 },
      async inspect(
        _tabId: number,
        context?: { exploredInteractionFamilies: string[] }
      ) {
        contexts.push(context?.exploredInteractionFamilies ?? [])
        inspection += 1
        return {
          ...emptyInspection(),
          interactionFamilies: inspection === 1 ? ['settings-family'] : [],
          candidates: inspection === 1 ? [{
            target: 'navigate' as const,
            url: 'https://example.com/library',
            risk: 'safe' as const
          }] : []
        }
      },
      async navigate() {},
      async close() {}
    }

    await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(contexts).toEqual([[], ['settings-family']])
  })

  it('quarantines identity geometry across pages even when another state misclassifies it as a UI icon', async () => {
    const vectorSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4z"/></svg>'
    const identityId = await stableIconId({ vectorSvg })
    let inspection = 0
    const adapter = {
      async open() { return 69 },
      async inspect() {
        inspection += 1
        return inspection === 1
          ? {
              ...emptyInspection(),
              excludedGraphicIds: [identityId],
              candidates: [{
                target: 'navigate' as const,
                url: 'https://example.com/library',
                risk: 'safe' as const
              }]
            }
          : {
              ...emptyInspection(),
              controls: [{
                ...control,
                slots: {
                  leading: {
                    width: 20,
                    height: 20,
                    assetType: 'ui-icon' as const,
                    vectorSvg
                  },
                  trailing: null
                },
                content: { kind: 'icon-leading' as const }
              }],
              icons: [{
                ...icon,
                id: identityId,
                vectorSvg
              }]
            }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.icons).toEqual([])
    expect(result.controls).toHaveLength(1)
    expect(result.controls[0]?.slots.leading).toEqual({
      width: 20,
      height: 20,
      assetType: 'unknown'
    })
  })

  it('prioritizes structural routes without entering arbitrary personal content from the home page', async () => {
    const navigated: string[] = []
    let inspection = 0
    const adapter = {
      async open() { return 70 },
      async inspect() {
        inspection += 1
        return {
          ...emptyInspection(),
          candidates: inspection === 1 ? [
            { target: 'navigate' as const, url: 'https://example.com/c/bbbbbbb', risk: 'safe' as const },
            { target: 'navigate' as const, url: 'https://example.com/c/aaaaaaa', risk: 'safe' as const },
            { target: 'navigate' as const, url: 'https://example.com/plugins', risk: 'safe' as const },
            { target: 'navigate' as const, url: 'https://example.com/library', risk: 'safe' as const }
          ] : []
        }
      },
      async navigate(_tabId: number, url: string) { navigated.push(url) },
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com/',
      maxDepth: 1,
      maxPages: 4
    })

    expect(navigated).toEqual([
      'https://example.com/library',
      'https://example.com/plugins'
    ])
    expect(result.traversal.skippedUncertain).toBe(2)
  })

  it('visits only safe routes, respects limits, and deduplicates styles', async () => {
    const visited: string[] = []
    const progress: Array<{ completed: number; maximum: number }> = []
    let inspections = 0
    const adapter = {
      async open(url: string) { visited.push(url); return 77 },
      async inspect() {
        const candidates = inspections++ === 0
          ? [
              { target: 'navigate' as const, url: 'https://example.com/plugins', risk: 'safe' as const },
              { target: 'navigate' as const, url: 'https://example.com/logout', risk: 'blocked' as const },
              { target: 'navigate' as const, url: 'https://other.example/', risk: 'uncertain' as const }
            ]
          : []
        return {
          typography: [style],
          borderRadii: [radius],
          shadows: [shadow],
          colors,
          spacing: [spacingToken('8', 8, { padding: 1, gap: 0, margin: 0 })],
          controls: [control],
          icons: [icon],
          revealedStates: 1,
          candidates,
          filtered: { brandAssets: 1, personalTextNodes: 2 }
        }
      },
      async navigate(_tabId: number, url: string) { visited.push(url) },
      async reportProgress(_tabId: number, value: { completed: number; maximum: number }) {
        progress.push(value)
      },
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 2,
      maxPages: 2
    })

    expect(visited).toEqual(['https://example.com/', 'https://example.com/plugins'])
    expect(progress).toEqual([
      { completed: 1, maximum: 2 },
      { completed: 2, maximum: 2 }
    ])
    expect(result.traversal).toEqual({ visitedStates: 4, skippedUnsafe: 1, skippedUncertain: 1, failures: 0 })
    expect(result.typography).toEqual([{ ...style, occurrences: 2 }])
    expect(result.borderRadii).toEqual([{ ...radius, occurrences: 2 }])
    expect(result.shadows).toEqual([{ ...shadow, occurrences: 2 }])
    expect(result.colors.primitives).toEqual([{ ...whitePrimitive, occurrences: 2 }])
    expect(result.colors.semantic).toEqual([{ ...backgroundColor, occurrences: 2 }])
    expect(result.colors.interactive).toEqual([])
    expect(result.spacing).toEqual([{
      ...spacingToken('8', 8, { padding: 1, gap: 0, margin: 0 }),
      occurrences: 2,
      evidence: { padding: 2, gap: 0, margin: 0 },
      stateOccurrences: 2
    }])
    expect(result.controls).toEqual([{
      ...control,
      occurrences: 2,
      stateOccurrences: 2
    }])
    expect(result.icons).toEqual([{
      ...icon,
      nameSource: 'visible-text',
      observedSizes: [{ width: 20, height: 20, occurrences: 2 }],
      themes: [{ ...icon.themes[0], occurrences: 2 }],
      occurrences: 2,
      stateOccurrences: 2
    }])
    expect(result.filtered).toEqual({ brandAssets: 2, personalTextNodes: 4 })
  })

  it('visits an already-classified read-only settings route without authorizing child actions', async () => {
    const visited: string[] = []
    let inspections = 0
    const adapter = {
      async open(url: string) { visited.push(url); return 78 },
      async inspect() {
        inspections += 1
        return {
          ...emptyInspection(),
          candidates: inspections === 1
            ? [
                { target: 'navigate' as const, url: 'https://example.com/settings', risk: 'safe' as const },
                { target: 'navigate' as const, url: 'https://example.com/settings/billing', risk: 'blocked' as const }
              ]
            : []
        }
      },
      async navigate(_tabId: number, url: string) { visited.push(url) },
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(visited).toEqual([
      'https://example.com/',
      'https://example.com/settings'
    ])
    expect(result.traversal.skippedUnsafe).toBe(1)
  })

  it('chooses the most frequent safe control label across visited pages', async () => {
    let inspections = 0
    const adapter = {
      async open() { return 78 },
      async inspect() {
        const first = inspections++ === 0
        return {
          typography: [],
          borderRadii: [],
          shadows: [],
          colors: emptyColors(),
          spacing: [],
          controls: [{
            ...control,
            occurrences: first ? 2 : 1,
            sampleText: {
              value: first ? 'Share' : 'Upgrade',
              source: 'visible-text' as const
            },
            sampleTextEvidence: [{
              value: first ? 'Share' : 'Upgrade',
              source: 'visible-text' as const,
              occurrences: first ? 2 : 1
            }]
          }],
          icons: [],
          revealedStates: 0,
          candidates: first
            ? [{
                target: 'navigate' as const,
                url: 'https://example.com/plugins',
                risk: 'safe' as const
              }]
            : [],
          filtered: { brandAssets: 0, personalTextNodes: 0 }
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.controls).toEqual([{
      ...control,
      occurrences: 3,
      stateOccurrences: 2,
      sampleText: { value: 'Share', source: 'visible-text' }
    }])
    expect(JSON.stringify(result.controls)).not.toContain('sampleTextEvidence')
  })

  it('keeps compound primary and supporting copy paired across visited pages', async () => {
    let inspections = 0
    const adapter = {
      async open() { return 79 },
      async inspect() {
        const first = inspections++ === 0
        const sampleText = {
          value: first ? 'Zulu option' : 'Alpha option',
          source: 'visible-text' as const
        }
        const supportingText = {
          value: first ? 'Second detail' : 'First detail',
          source: 'visible-text' as const
        }
        return {
          ...emptyInspection(),
          controls: [{
            ...control,
            content: {
              kind: 'compound-row' as const,
              trailing: 'none' as const,
              textFlow: 'stacked' as const,
              textGap: 4
            },
            layout: { widthBehavior: 'hug' as const },
            sampleText,
            supportingText,
            supportingStyle: {
              foreground: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
              typography: control.typography
            },
            sampleTextEvidence: [{
              ...sampleText,
              supportingText,
              occurrences: 1
            }]
          }],
          candidates: first
            ? [{
                target: 'navigate' as const,
                url: 'https://example.com/languages',
                risk: 'safe' as const
              }]
            : []
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.controls).toHaveLength(1)
    expect(result.controls[0]).toMatchObject({
      occurrences: 2,
      sampleText: {
        value: 'Alpha option',
        source: 'visible-text'
      },
      supportingText: {
        value: 'First detail',
        source: 'visible-text'
      }
    })
    expect(JSON.stringify(result.controls)).not.toContain('sampleTextEvidence')
  })

  it('always closes the duplicate tab after an inspection failure', async () => {
    let closed = false
    const adapter = {
      async open() { return 88 },
      async inspect() { throw new Error('page failed') },
      async navigate() {},
      async close() { closed = true }
    }
    const result = await scanSite(adapter, { startUrl: 'https://example.com', maxDepth: 0, maxPages: 1 })
    expect(result.traversal.failures).toBe(1)
    expect(closed).toBe(true)
  })

  it('keeps collected typography and continues safely when a route navigation fails', async () => {
    let inspection = 0
    let closed = false
    const adapter = {
      async open() { return 99 },
      async inspect() {
        inspection += 1
        return {
          typography: [style],
          borderRadii: [radius],
          shadows: [shadow],
          colors,
          spacing: [],
          controls: [],
          icons: [],
          revealedStates: 0,
          candidates: inspection === 1
            ? [{ target: 'navigate' as const, url: 'https://example.com/plugins', risk: 'safe' as const }]
            : [],
          filtered: { brandAssets: 0, personalTextNodes: 0 }
        }
      },
      async navigate() { throw new Error('navigation failed') },
      async close() { closed = true }
    }

    const result = await scanSite(adapter, { startUrl: 'https://example.com', maxDepth: 1, maxPages: 2 })

    expect(result.typography).toEqual([style])
    expect(result.borderRadii).toEqual([radius])
    expect(result.shadows).toEqual([shadow])
    expect(result.traversal.failures).toBe(1)
    expect(result.traversal.failureStages).toEqual({
      navigation: 1,
      inspection: 0
    })
    expect(closed).toBe(true)
  })

  it('reports inspection failures separately without serializing a route or error message', async () => {
    let inspections = 0
    const adapter = {
      async open() { return 100 },
      async inspect() {
        inspections += 1
        if (inspections === 2) throw new Error('private route details')
        return {
          ...emptyInspection(),
          candidates: inspections === 1
            ? [{
                target: 'navigate' as const,
                url: 'https://example.com/library',
                risk: 'safe' as const
              }]
            : []
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com/',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.traversal.failureStages).toEqual({
      navigation: 0,
      inspection: 1
    })
    expect(JSON.stringify(result.traversal)).not.toContain('private route details')
    expect(JSON.stringify(result.traversal)).not.toContain('/library')
  })

  it('sorts the final cross-page radius set by px, percent, then full', async () => {
    let inspection = 0
    const adapter = {
      async open() { return 101 },
      async inspect() {
        inspection += 1
        return {
          typography: [],
          shadows: [],
          colors: emptyColors(),
          spacing: [],
          controls: [],
          icons: [],
          borderRadii: inspection === 1
            ? [radiusToken('8', 'px', 8), radiusToken('f', 'full', null)]
            : [radiusToken('2', 'px', 2), radiusToken('p', 'percent', 25)],
          revealedStates: 0,
          candidates: inspection === 1
            ? [{ target: 'navigate' as const, url: 'https://example.com/projects', risk: 'safe' as const }]
            : [],
          filtered: { brandAssets: 0, personalTextNodes: 0 }
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.borderRadii.map(token => [token.kind, token.value])).toEqual([
      ['px', 2],
      ['px', 8],
      ['percent', 25],
      ['full', null]
    ])
  })

  it('disambiguates typography names again after merging multiple pages', async () => {
    let inspection = 0
    const caption = (idCharacter: string, lineHeightPx: number): TypographyStyle => ({
      ...style,
      id: `sha256:${idCharacter.repeat(64)}`,
      name: 'caption-regular',
      fontSizePx: 12,
      lineHeightPx,
      role: 'caption'
    })
    const adapter = {
      async open() { return 102 },
      async inspect() {
        inspection += 1
        return {
          typography: inspection === 1 ? [caption('c', 16)] : [caption('d', 17.1429)],
          borderRadii: [],
          shadows: [],
          colors: emptyColors(),
          spacing: [],
          controls: [],
          icons: [],
          revealedStates: 0,
          candidates: inspection === 1
            ? [{ target: 'navigate' as const, url: 'https://example.com/projects', risk: 'safe' as const }]
            : [],
          filtered: { brandAssets: 0, personalTextNodes: 0 }
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.typography.map(token => token.name).sort()).toEqual([
      'caption-regular-lh16',
      'caption-regular-lh17.14'
    ])
  })

  it('disambiguates shadow names again after merging multiple pages', async () => {
    let inspection = 0
    const blueShadow: ShadowToken = {
      ...shadow,
      id: `sha256:${'d'.repeat(64)}`,
      layers: [{
        ...shadow.layers[0]!,
        color: { r: 0, g: 0.25, b: 1, a: 0.15 }
      }]
    }
    const adapter = {
      async open() { return 103 },
      async inspect() {
        inspection += 1
        return {
          typography: [],
          borderRadii: [],
          shadows: inspection === 1 ? [shadow] : [blueShadow],
          colors: emptyColors(),
          spacing: [],
          controls: [],
          icons: [],
          revealedStates: 0,
          candidates: inspection === 1
            ? [{ target: 'navigate' as const, url: 'https://example.com/projects', risk: 'safe' as const }]
            : [],
          filtered: { brandAssets: 0, personalTextNodes: 0 }
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(new Set(result.shadows.map(token => token.name)).size).toBe(2)
    expect(result.shadows.map(token => token.id).sort()).toEqual([shadow.id, blueShadow.id].sort())
  })

  it('refuses to revisit an active action route as the initial scan URL', async () => {
    let opened = false
    const adapter = {
      async open() { opened = true; return 1 },
      async inspect() { throw new Error('must not inspect') },
      async navigate() {},
      async close() {}
    }

    await expect(scanSite(adapter, {
      startUrl: 'https://example.com/settings',
      maxDepth: 1,
      maxPages: 2
    })).rejects.toThrow('home page')
    expect(opened).toBe(false)
  })

  it('keeps only observed colors after the site-wide color merge', async () => {
    let inspection = 0
    const black: PrimitiveColorToken = {
      ...whitePrimitive,
      id: `sha256:${'f'.repeat(64)}`,
      name: 'neutral-1000',
      value: { r: 0, g: 0, b: 0, a: 1 },
      step: 1000
    }
    const adapter = {
      async open() { return 104 },
      async inspect() {
        inspection += 1
        return {
          ...emptyInspection(),
          colors: {
            primitives: inspection === 1 ? [whitePrimitive] : [black],
            semantic: [],
            interactive: []
          },
          candidates: inspection === 1
            ? [{ target: 'navigate' as const, url: 'https://example.com/projects', risk: 'safe' as const }]
            : []
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2
    })

    expect(result.colors.primitives).toHaveLength(2)
    expect(result.colors.primitives.filter(token => token.provenance === 'inferred'))
      .toHaveLength(0)
    expect(result.colors.primitives.every(token => token.family === 'neutral')).toBe(true)
  })

  it('upgrades color provenance after a later page confirms real usage', async () => {
    let inspection = 0
    const adapter = {
      async open() { return 105 },
      async inspect() {
        inspection += 1
        const provenance = inspection === 1 ? 'declared' as const : 'observed' as const
        return {
          ...emptyInspection(),
          colors: {
            primitives: [{ ...whitePrimitive, provenance }],
            semantic: [{ ...backgroundColor, provenance }],
            interactive: [],
          },
          candidates: inspection === 1
            ? [{ target: 'navigate' as const, url: 'https://example.com/projects', risk: 'safe' as const }]
            : []
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com', maxDepth: 1, maxPages: 2
    })
    expect(result.colors.primitives[0]?.provenance).toBe('observed')
    expect(result.colors.semantic[0]?.provenance).toBe('observed')
  })

  it('keeps padding or gap evidence immediately but requires bounded margin on two states', async () => {
    let inspection = 0
    const adapter = {
      async open() { return 106 },
      async inspect() {
        inspection += 1
        return {
          ...emptyInspection(),
          spacing: inspection === 1
            ? [
                spacingToken('8', 8, { padding: 1, gap: 0, margin: 0 }),
                spacingToken('c', 12, { padding: 0, gap: 0, margin: 1 }),
                spacingToken('e', 20, { padding: 0, gap: 0, margin: 1 }),
                spacingToken('large-margin', 86, { padding: 0, gap: 0, margin: 1 }),
                spacingToken('large-padding', 96, { padding: 1, gap: 0, margin: 0 })
              ]
            : [
                spacingToken('c', 12, { padding: 0, gap: 0, margin: 1 }),
                spacingToken('large-margin', 86, { padding: 0, gap: 0, margin: 1 })
              ],
          candidates: inspection === 1
            ? [{ target: 'navigate' as const, url: 'https://example.com/projects', risk: 'safe' as const }]
            : []
        }
      },
      async navigate() {},
      async close() {}
    }

    const result = await scanSite(adapter, {
      startUrl: 'https://example.com', maxDepth: 1, maxPages: 2
    })

    expect(result.spacing.map(token => token.value)).toEqual([8, 12, 96])
    expect(result.spacing.find(token => token.value === 12)).toMatchObject({
      occurrences: 2,
      stateOccurrences: 2,
      evidence: { padding: 0, gap: 0, margin: 2 }
    })
  })

  it('keeps a scoped scan on the current product surface instead of adding the root page', async () => {
    const events: string[] = []
    const adapter = {
      async open(url: string) { events.push(`open:${url}`); return 77 },
      async inspect() { events.push('inspect'); return emptyInspection() },
      async navigate(_tabId: number, url: string) { events.push(`navigate:${url}`) },
      async close() { events.push('close') }
    }

    await scanSite(adapter, {
      currentUrl: 'https://example.com/conversation/abc',
      startUrl: 'https://example.com/',
      maxDepth: 0,
      maxPages: 1
    })

    expect(events).toEqual([
      'open:https://example.com/conversation/abc',
      'inspect',
      'close'
    ])
  })

  it('keeps a generic nested content page inside its current path scope', async () => {
    const opened: string[] = []
    const navigated: string[] = []
    let inspections = 0
    const adapter = {
      async open(url: string) { opened.push(url); return 82 },
      async inspect() {
        inspections += 1
        return {
          ...emptyInspection(),
          candidates: inspections === 1 ? [
            { target: 'navigate' as const, url: 'https://example.com/', risk: 'safe' as const },
            { target: 'navigate' as const, url: 'https://example.com/collections', risk: 'safe' as const },
            {
              target: 'navigate' as const,
              url: 'https://example.com/enterprise/premium-support',
              risk: 'safe' as const
            },
            {
              target: 'navigate' as const,
              url: 'https://example.com/team/project/issues',
              risk: 'safe' as const
            },
            {
              target: 'navigate' as const,
              url: 'https://example.com/settings',
              risk: 'safe' as const
            }
          ] : []
        }
      },
      async navigate(_tabId: number, url: string) { navigated.push(url) },
      async close() {}
    }

    await scanSite(adapter, {
      currentUrl: 'https://example.com/team/project',
      startUrl: 'https://example.com/',
      maxDepth: 1,
      maxPages: 6
    })

    expect(opened).toEqual(['https://example.com/team/project'])
    expect(navigated).toEqual([
      'https://example.com/settings',
      'https://example.com/team/project/issues'
    ])
    expect(inspections).toBe(3)
  })

  it('keeps the user-selected content page, skips sibling content, and follows an explicit safe route', async () => {
    const navigated: string[] = []
    let inspections = 0
    const adapter = {
      async open() { return 81 },
      async inspect() {
        inspections += 1
        return {
          ...emptyInspection(),
          candidates: inspections === 1 ? [
            { target: 'navigate' as const, url: 'https://example.com/c/bbbbbbb', risk: 'safe' as const },
            { target: 'navigate' as const, url: 'https://example.com/settings', risk: 'safe' as const }
          ] : []
        }
      },
      async navigate(_tabId: number, url: string) { navigated.push(url) },
      async close() {}
    }

    await scanSite(adapter, {
      currentUrl: 'https://example.com/c/aaaaaaa',
      startUrl: 'https://example.com/',
      maxDepth: 1,
      maxPages: 3
    })

    expect(navigated).toEqual([
      'https://example.com/settings'
    ])
    expect(inspections).toBe(2)
  })

  it('does not sample the root twice when it is already current', async () => {
    let inspections = 0
    const adapter = {
      async open() { return 78 },
      async inspect() { inspections += 1; return emptyInspection() },
      async navigate() { throw new Error('must not navigate') },
      async close() {}
    }

    const result = await scanSite(adapter, {
      currentUrl: 'https://example.com/',
      startUrl: 'https://example.com/',
      maxDepth: 0,
      maxPages: 1
    })

    expect(inspections).toBe(1)
    expect(result.traversal.visitedStates).toBe(1)
  })

  it('does not force a redundant origin-root visit from a shallow app landing route', async () => {
    const events: string[] = []
    const adapter = {
      async open() { events.push('open-current'); return 78 },
      async inspect() { events.push('inspect'); return emptyInspection() },
      async navigate(_tabId: number, url: string) { events.push(`navigate:${url}`) },
      async close() { events.push('close') }
    }

    const result = await scanSite(adapter, {
      currentUrl: 'https://example.com/app',
      startUrl: 'https://example.com/',
      maxDepth: 1,
      maxPages: 2
    })

    expect(events).toEqual(['open-current', 'inspect', 'close'])
    expect(result.traversal).toMatchObject({
      visitedStates: 1,
      failures: 0
    })
  })

  it('does not broaden to the root when current-page inspection fails', async () => {
    const events: string[] = []
    let inspections = 0
    const adapter = {
      async open() { events.push('open-current'); return 79 },
      async inspect() {
        inspections += 1
        events.push('inspect')
        if (inspections === 1) throw new Error('current page failed')
        return emptyInspection()
      },
      async navigate(_tabId: number, url: string) { events.push(`navigate:${url}`) },
      async close() { events.push('close') }
    }

    const result = await scanSite(adapter, {
      currentUrl: 'https://example.com/conversation/abc',
      startUrl: 'https://example.com/',
      maxDepth: 0,
      maxPages: 1
    })

    expect(events).toEqual([
      'open-current',
      'inspect',
      'close'
    ])
    expect(result.traversal.failures).toBe(1)
    expect(result.traversal.visitedStates).toBe(0)
  })

  it('aborts immediately on an interaction restore failure and preserves it over cleanup failure', async () => {
    let inspections = 0
    const navigate = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockRejectedValue(new Error('overlay cleanup failed'))
    const fatal = Object.assign(
      new Error('private page interaction details'),
      { code: 'interaction-restore-abort' }
    )
    const adapter = {
      open: vi.fn().mockResolvedValue(91),
      inspect: vi.fn(async () => {
        inspections += 1
        if (inspections === 2) throw fatal
        return {
          ...emptyInspection(),
          candidates: [
            { target: 'navigate' as const, url: 'https://example.com/first', risk: 'safe' as const },
            { target: 'navigate' as const, url: 'https://example.com/second', risk: 'safe' as const }
          ]
        }
      }),
      navigate,
      close
    }

    let thrown: unknown
    try {
      await scanSite(adapter, {
        startUrl: 'https://example.com/',
        maxDepth: 1,
        maxPages: 3
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(fatal)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(adapter.inspect).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledWith(91, 'dirty-abort')
  })
})
