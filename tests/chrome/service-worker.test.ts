import { afterEach, describe, expect, it, vi } from 'vitest'

import { runScanWorkflow } from '../../src/chrome/background/scan-workflow'
import type { InspectResult } from '../../src/chrome/background/scan-site'

describe('service worker scan lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not synthesize heartbeats while inspection progress is unchanged', async () => {
    vi.useFakeTimers()
    const storageSet = vi.fn().mockResolvedValue(undefined)
    let resolveInspection!: (value: InspectResult) => void
    let markInspectionStarted!: () => void
    const inspectionStarted = new Promise<void>(resolve => {
      markInspectionStarted = resolve
    })
    const inspection = new Promise<InspectResult>(resolve => {
      resolveInspection = resolve
    })
    const adapter = {
      open: vi.fn().mockResolvedValue(77),
      inspect: vi.fn(() => {
        markInspectionStarted()
        return inspection
      }),
      navigate: vi.fn().mockResolvedValue(undefined),
      reportProgress: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
    const workflow = runScanWorkflow({
      tabId: 77,
      url: 'https://example.com/',
      locale: 'en',
      platform: 'MacIntel'
    }, {
      createAdapter: () => adapter,
      storageSet
    })
    await inspectionStarted
    const callsAtLastRealProgress = storageSet.mock.calls.length

    await vi.advanceTimersByTimeAsync(60_001)
    const callsWithoutProgress = storageSet.mock.calls.length - callsAtLastRealProgress
    resolveInspection({
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
    })
    await workflow

    expect(callsWithoutProgress).toBe(0)
  })
})
