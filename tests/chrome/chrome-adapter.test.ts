import { afterEach, describe, expect, it, vi } from 'vitest'

import { createChromeAdapter } from '../../src/chrome/background/chrome-adapter'
import type { ChromePageSession } from '../../src/chrome/background/page-session'

function pageSession(options: { hasDraft?: boolean } = {}): ChromePageSession {
  return {
    hasDraft: vi.fn().mockResolvedValue(options.hasDraft ?? false),
    readScroll: vi.fn().mockResolvedValue({ x: 5, y: 80 }),
    readUiState: vi.fn().mockResolvedValue({
      toggles: [{ subject: 'sidebar', action: 'open' as const }]
    }),
    restoreUiState: vi.fn().mockResolvedValue(undefined),
    restoreScroll: vi.fn().mockResolvedValue(undefined),
    showProgress: vi.fn().mockResolvedValue(undefined),
    hideProgress: vi.fn().mockResolvedValue(undefined)
  }
}

function tabsRuntime(initialUrl: string) {
  let currentUrl = initialUrl
  const update = vi.fn(async (_tabId: number, properties: chrome.tabs.UpdateProperties) => {
    if (properties.url) currentUrl = properties.url
    return { id: 77, status: 'complete', url: currentUrl }
  })
  return {
    update,
    get: vi.fn(async () => ({ id: 77, status: 'complete', url: currentUrl })),
    create: vi.fn(),
    remove: vi.fn(),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
  }
}

describe('createChromeAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('scans the supplied tab and restores its original URL and scroll', async () => {
    const tabs = tabsRuntime('https://example.com/conversation/abc')
    const session = pageSession()
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/conversation/abc',
      pageSession: session
    })

    const tabId = await adapter.open('https://example.com/')
    expect(tabs.update).not.toHaveBeenCalled()
    await adapter.navigate(tabId, 'https://example.com/')
    await adapter.navigate(tabId, 'https://example.com/plugins')
    await adapter.reportProgress?.(tabId, { completed: 2, maximum: 8 })
    await adapter.close(tabId)

    expect(tabId).toBe(77)
    expect(tabs.create).not.toHaveBeenCalled()
    expect(tabs.remove).not.toHaveBeenCalled()
    expect(tabs.update).toHaveBeenNthCalledWith(1, 77, {
      url: 'https://example.com/', active: true
    })
    expect(tabs.update).toHaveBeenNthCalledWith(2, 77, {
      url: 'https://example.com/plugins', active: true
    })
    expect(tabs.update).toHaveBeenNthCalledWith(3, 77, {
      url: 'https://example.com/conversation/abc', active: true
    })
    expect(session.restoreUiState).toHaveBeenCalledWith(77, {
      toggles: [{
        subject: 'sidebar',
        action: 'open'
      }]
    })
    expect(session.restoreScroll).toHaveBeenCalledWith(77, { x: 5, y: 80 })
    expect(session.showProgress).toHaveBeenLastCalledWith(77, { completed: 2, maximum: 8 })
    expect(session.hideProgress).toHaveBeenCalledWith(77)
  })

  it('does not reload the original URL when the scan never navigated away', async () => {
    const originalUrl = 'https://example.com/app'
    const tabs = tabsRuntime(originalUrl)
    const session = pageSession()
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl,
      pageSession: session
    })

    await adapter.open(originalUrl)
    await adapter.close(77)

    expect(tabs.update).not.toHaveBeenCalled()
    expect(session.restoreUiState).toHaveBeenCalledWith(77, {
      toggles: [{
        subject: 'sidebar',
        action: 'open'
      }]
    })
    expect(session.restoreScroll).toHaveBeenCalledWith(77, { x: 5, y: 80 })
    expect(session.hideProgress).toHaveBeenCalledWith(77)
  })

  it('shows progress before reading structural UI state on a large page', async () => {
    const tabs = tabsRuntime('https://example.com/plugins')
    const session = pageSession()
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/plugins',
      pageSession: session
    })

    await adapter.open('https://example.com/')

    expect(vi.mocked(session.showProgress).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(session.readUiState).mock.invocationCallOrder[0]!)
  })

  it('refuses to navigate when the current page contains an unsent draft', async () => {
    const tabs = tabsRuntime('https://example.com/')
    const session = pageSession({ hasDraft: true })
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/',
      pageSession: session
    })

    await expect(adapter.open('https://example.com/')).rejects.toThrow('未发送')

    expect(tabs.update).not.toHaveBeenCalled()
    expect(session.readScroll).not.toHaveBeenCalled()
    expect(session.readUiState).not.toHaveBeenCalled()
    expect(session.showProgress).not.toHaveBeenCalled()
  })

  it('reconstructs the typed recovery abort from a code-only inspection response', async () => {
    const tabs = {
      ...tabsRuntime('https://example.com/private'),
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        code: 'interaction-restore-abort',
        error: 'private DOM and URL details must be ignored'
      })
    }
    const session = pageSession()
    vi.stubGlobal('chrome', {
      tabs,
      scripting: { executeScript: vi.fn().mockResolvedValue([]) }
    })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/private',
      pageSession: session
    })

    let thrown: unknown
    try {
      await adapter.inspect(77)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'InteractionRestoreError',
      code: 'interaction-restore-abort'
    })
    expect(String(thrown)).not.toContain('private DOM')
  })

  it('keeps ordinary inspection errors compatible with the existing message', async () => {
    const tabs = {
      ...tabsRuntime('https://example.com/'),
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        error: 'ordinary inspection failed'
      })
    }
    vi.stubGlobal('chrome', {
      tabs,
      scripting: { executeScript: vi.fn().mockResolvedValue([]) }
    })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/',
      pageSession: pageSession()
    })

    await expect(adapter.inspect(77)).rejects.toEqual(
      expect.objectContaining({
        name: 'Error',
        message: 'ordinary inspection failed'
      })
    )
  })

  it('dirty-abort cleanup hides only the extension overlay', async () => {
    const tabs = tabsRuntime('https://example.com/changed-during-inspection')
    const session = pageSession()
    vi.mocked(session.hideProgress).mockRejectedValueOnce(new Error('overlay unavailable'))
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/original',
      pageSession: session
    })

    await expect(adapter.close(77, 'dirty-abort')).resolves.toBeUndefined()

    expect(session.hideProgress).toHaveBeenCalledWith(77)
    expect(tabs.update).not.toHaveBeenCalled()
    expect(session.restoreUiState).not.toHaveBeenCalled()
    expect(session.restoreScroll).not.toHaveBeenCalled()
  })

  it('cleans up without reloading when the initial progress overlay fails', async () => {
    const tabs = tabsRuntime('https://example.com/conversation/abc')
    const session = pageSession()
    vi.mocked(session.showProgress).mockRejectedValueOnce(new Error('progress failed'))
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/conversation/abc',
      pageSession: session
    })

    await expect(adapter.open('https://example.com/')).rejects.toThrow('progress failed')

    expect(tabs.update).not.toHaveBeenCalled()
    expect(session.hideProgress).toHaveBeenCalledWith(77)
  })

  it('reports a restore navigation failure when the original tab still exists', async () => {
    const tabs = tabsRuntime('https://example.com/conversation/abc')
    const session = pageSession()
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/conversation/abc',
      pageSession: session
    })

    await adapter.open('https://example.com/')
    await adapter.navigate(77, 'https://example.com/')
    tabs.update
      .mockRejectedValueOnce(new Error('restore navigation failed'))
      .mockRejectedValueOnce(new Error('restore navigation failed'))
    await expect(adapter.close(77)).rejects.toThrow('restore navigation failed')
    expect(session.hideProgress).toHaveBeenCalledWith(77)
  })

  it('recovers when the first restore navigation fails and the retry succeeds', async () => {
    const tabs = tabsRuntime('https://example.com/conversation/abc')
    const session = pageSession()
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/conversation/abc',
      pageSession: session
    })

    await adapter.open('https://example.com/')
    await adapter.navigate(77, 'https://example.com/')
    tabs.update
      .mockRejectedValueOnce(new Error('temporary restore failure'))
      .mockResolvedValueOnce({
        id: 77,
        status: 'complete',
        url: 'https://example.com/conversation/abc'
      })
    await expect(adapter.close(77)).resolves.toBeUndefined()

    expect(tabs.update).toHaveBeenCalledTimes(3)
    expect(session.restoreScroll).toHaveBeenCalledWith(77, { x: 5, y: 80 })
    expect(session.hideProgress).toHaveBeenCalledWith(77)
  })

  it('reports a restore scroll failure when the original tab still exists', async () => {
    const tabs = tabsRuntime('https://example.com/conversation/abc')
    const session = pageSession()
    vi.mocked(session.restoreScroll).mockRejectedValue(new Error('restore scroll failed'))
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/conversation/abc',
      pageSession: session
    })

    await adapter.open('https://example.com/')
    await expect(adapter.close(77)).rejects.toThrow('restore scroll failed')
    expect(session.hideProgress).toHaveBeenCalledWith(77)
  })

  it('ends recovery quietly only when Chrome confirms the tab was closed', async () => {
    const tabs = tabsRuntime('https://example.com/conversation/abc')
    tabs.update
      .mockRejectedValueOnce(new Error('No tab with id: 77'))
    tabs.get
      .mockRejectedValueOnce(new Error('No tab with id: 77'))
    const session = pageSession()
    vi.stubGlobal('chrome', { tabs })
    const adapter = createChromeAdapter({
      tabId: 77,
      originalUrl: 'https://example.com/conversation/abc',
      pageSession: session
    })

    await adapter.open('https://example.com/')
    await expect(adapter.close(77)).resolves.toBeUndefined()
  })
})
