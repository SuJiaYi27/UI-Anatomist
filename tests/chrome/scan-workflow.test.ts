import { describe, expect, it, vi } from 'vitest'
import { runScanWorkflow } from '../../src/chrome/background/scan-workflow'

describe('runScanWorkflow', () => {
  it('does not build or publish a partial export after a fatal recovery abort', async () => {
    const storageSet = vi.fn().mockResolvedValue(undefined)
    const fatal = Object.assign(
      new Error('private page interaction details'),
      { code: 'interaction-restore-abort' }
    )
    let inspections = 0
    const adapter = {
      open: vi.fn().mockResolvedValue(73),
      inspect: vi.fn(async () => {
        inspections += 1
        if (inspections === 2) throw fatal
        return {
          typography: [],
          borderRadii: [],
          shadows: [],
          colors: { primitives: [], semantic: [], interactive: [] },
          spacing: [],
          controls: [],
          composites: [],
          icons: [],
          diagnostics: { disclosures: [] },
          revealedStates: 0,
          candidates: [{
            target: 'navigate' as const,
            url: 'https://example.com/next',
            risk: 'safe' as const
          }],
          filtered: { brandAssets: 0, personalTextNodes: 0 }
        }
      }),
      navigate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }

    let thrown: unknown
    try {
      await runScanWorkflow({
        tabId: 73,
        url: 'https://example.com/',
        locale: 'en',
        platform: 'MacIntel'
      }, {
        createAdapter: () => adapter,
        storageSet
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(fatal)
    expect(storageSet).not.toHaveBeenCalledWith(expect.objectContaining({
      scanStatus: 'ready'
    }))
    expect(storageSet).not.toHaveBeenCalledWith(expect.objectContaining({
      scanJson: expect.any(String)
    }))
  })

  it('does not publish a ready JSON when every page inspection fails', async () => {
    const storageSet = vi.fn().mockResolvedValue(undefined)
    const adapter = {
      open: vi.fn().mockResolvedValue(73),
      inspect: vi.fn().mockRejectedValue(new Error('HTTP 503')),
      navigate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }

    await expect(runScanWorkflow({
      tabId: 73,
      url: 'https://example.com/',
      locale: 'en',
      platform: 'MacIntel'
    }, {
      createAdapter: () => adapter,
      storageSet
    })).rejects.toThrow('UI-Anatomist could not inspect any page')

    expect(storageSet).not.toHaveBeenCalledWith(expect.objectContaining({
      scanStatus: 'ready'
    }))
  })

  it('stores only a schema-valid ready JSON result', async () => {
    const storageSet = vi.fn()
    const createAdapter = vi.fn()
    let inspections = 0
    const navigate = vi.fn()
    const open = vi.fn().mockResolvedValue(1)
    const adapter = {
      open,
      async inspect() {
        inspections += 1
        return {
          typography: [],
          borderRadii: [{
            id: `sha256:${'2'.repeat(64)}`,
            name: 'radius-full',
            kind: 'full' as const,
            value: null,
            occurrences: 2
          }],
          shadows: [{
            id: `sha256:${'3'.repeat(64)}`,
            name: 'shadow-outer-x0-y2-b8-s0-a10',
            layers: [{
              kind: 'outer' as const,
              offsetX: 0,
              offsetY: 2,
              blur: 8,
              spread: 0,
              color: { r: 0, g: 0, b: 0, a: 0.1 }
            }],
            occurrences: 1
          }],
          colors: {
            primitives: [{
              id: `sha256:${'4'.repeat(64)}`,
              name: 'neutral-0',
              value: { r: 1, g: 1, b: 1, a: 1 },
              family: 'neutral' as const,
              step: 0,
              provenance: 'observed' as const,
              occurrences: 1
            }],
            semantic: [],
            interactive: []
          },
          spacing: [{
            id: `sha256:${'5'.repeat(64)}`,
            name: 'spacing-8',
            value: 8,
            occurrences: 1,
            evidence: { padding: 1, gap: 0, margin: 0 },
            stateOccurrences: 1
          }],
          controls: [{
            id: `sha256:${'6'.repeat(64)}`,
            groupId: `sha256:${'7'.repeat(64)}`,
            templateId: `sha256:${'7'.repeat(64)}`,
            logicalControlId: `sha256:${'8'.repeat(64)}`,
            instanceId: `sha256:${'9'.repeat(64)}`,
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
            occurrences: 1,
            stateOccurrences: 1
          }],
          composites: [],
          revealedStates: 0,
          candidates: [],
          filtered: { brandAssets: 2, personalTextNodes: 9 }
        }
      },
      navigate,
      async close() {}
    }
    createAdapter.mockReturnValue(adapter)
    const result = await runScanWorkflow({
      tabId: 73,
      url: 'https://example.com/private?secret=1',
      locale: 'zh-CN',
      platform: 'macOS'
    }, { createAdapter, storageSet })

    expect(result).toEqual({
      ok: true,
      typography: 0,
      borderRadii: 1,
      shadows: 1,
      colors: { primitives: 1, semantic: 0, interactive: 0 },
      spacing: 1,
      controls: 1,
      composites: 0,
      icons: 0
    })
    expect(createAdapter).toHaveBeenCalledWith({
      tabId: 73,
      originalUrl: 'https://example.com/private?secret=1'
    })
    expect(open).toHaveBeenCalledWith('https://example.com/private?secret=1')
    expect(inspections).toBe(1)
    expect(navigate).not.toHaveBeenCalled()
    const stored = storageSet.mock.calls.at(-1)?.[0] as { scanStatus: string; scanJson: string }
    expect(stored.scanStatus).toBe('ready')
    expect(stored.scanJson).not.toContain('private')
    expect(stored.scanJson).not.toContain('secret')
    expect(JSON.parse(stored.scanJson)).toMatchObject({
      schemaVersion: '1.12.0',
      borderRadii: [{ name: 'radius-full' }],
      shadows: [{ name: 'shadow-outer-x0-y2-b8-s0-a10' }],
      colors: { primitives: [{ name: 'neutral-0' }], semantic: [], interactive: [] },
      spacing: [{ name: 'spacing-8' }],
      controls: [{ name: 'button-primary-md' }],
      composites: [],
      diagnostics: { disclosures: [] }
    })
  })

  it('refreshes the scan heartbeat when progress advances', async () => {
    const storageSet = vi.fn().mockResolvedValue(undefined)
    const reportProgress = vi.fn().mockResolvedValue(undefined)
    const adapter = {
      open: vi.fn().mockResolvedValue(77),
      inspect: vi.fn().mockResolvedValue({
        typography: [],
        borderRadii: [],
        shadows: [],
        colors: { primitives: [], semantic: [], interactive: [] },
        spacing: [],
        controls: [],
        composites: [],
        icons: [],
        revealedStates: 0,
        candidates: [],
        filtered: { brandAssets: 0, personalTextNodes: 0 }
      }),
      navigate: vi.fn().mockResolvedValue(undefined),
      reportProgress,
      close: vi.fn().mockResolvedValue(undefined)
    }

    await runScanWorkflow({
      tabId: 77,
      url: 'https://example.com/',
      locale: 'en',
      platform: 'MacIntel'
    }, {
      createAdapter: () => adapter,
      storageSet
    })

    expect(storageSet).toHaveBeenCalledWith(expect.objectContaining({
      scanStatus: 'scanning',
      scanHeartbeatAt: expect.any(Number),
      scanProgress: expect.objectContaining({
        completed: expect.any(Number),
        maximum: expect.any(Number)
      })
    }))
    expect(reportProgress).toHaveBeenCalled()
  })

})
