import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  actionsForStatus,
  initializePopup,
  isStaleScan,
  originPermissionPattern,
  readyStatus
} from '../../src/chrome/popup/popup'

describe('Chrome popup', () => {
  it('shows only the approved actions for each status', () => {
    expect(actionsForStatus('idle')).toEqual(['smart-scan'])
    expect(actionsForStatus('scanning')).toEqual([])
    expect(actionsForStatus('ready')).toEqual(['smart-scan', 'copy-json', 'download-json'])
    expect(actionsForStatus('error')).toEqual(['smart-scan'])
  })

  it('requests only the active origin', () => {
    expect(originPermissionPattern('https://chatgpt.com/c/private?id=1')).toBe('https://chatgpt.com/*')
  })

  it('treats a missing or expired scan heartbeat as stale', () => {
    expect(isStaleScan('scanning', undefined, 100_000)).toBe(true)
    expect(isStaleScan('scanning', 20_000, 100_000)).toBe(true)
    expect(isStaleScan('scanning', 50_001, 100_000)).toBe(false)
    expect(isStaleScan('ready', undefined, 100_000)).toBe(false)
  })

  it('recovers a stale scanning state when the popup is reopened', async () => {
    const dom = new JSDOM(`
      <button id="smart-scan"></button><button id="copy-json"></button>
      <button id="download-json"></button><div id="ready-actions"></div><p id="status"></p>
    `)
    const store: Record<string, unknown> = {
      scanStatus: 'scanning',
      scanJson: '',
      scanHeartbeatAt: Date.now() - 60_001
    }
    const set = vi.fn(async (value: Record<string, unknown>) => Object.assign(store, value))
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com/' }]) },
      storage: {
        session: {
          get: vi.fn(async () => ({ ...store })),
          set
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: { request: vi.fn() },
      action: { setBadgeText: vi.fn().mockResolvedValue(undefined) },
      runtime: { sendMessage: vi.fn() }
    })

    await initializePopup()

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ scanStatus: 'error' }))
    expect(dom.window.document.getElementById('status')?.textContent)
      .toBe('Scan stopped safely. Try again.')
    expect(dom.window.document.getElementById('smart-scan')?.hidden).toBe(false)
    vi.unstubAllGlobals()
  })

  it('sends the complete active URL so the scanner can restore the exact page', async () => {
    const dom = new JSDOM(`
      <button id="smart-scan"></button><button id="copy-json"></button>
      <button id="download-json"></button><div id="ready-actions"></div><p id="status"></p>
    `)
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    const request = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 77, url: 'https://chatgpt.com/c/abc?model=5#reply' }]) },
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({ scanStatus: 'idle', scanJson: '' }),
          set: vi.fn().mockResolvedValue(undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: { request },
      action: { setBadgeText: vi.fn().mockResolvedValue(undefined) },
      runtime: { sendMessage }
    })

    await initializePopup()
    dom.window.document.getElementById('smart-scan')?.click()

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'START_SCAN',
      tabId: 77,
      url: 'https://chatgpt.com/c/abc?model=5#reply'
    }))
    expect(request).toHaveBeenCalledWith({ origins: ['https://chatgpt.com/*'] })
    vi.unstubAllGlobals()
  })

  it('clears partial scan data and asks for a refresh after a recovery abort', async () => {
    const dom = new JSDOM(`
      <button id="smart-scan"></button><button id="copy-json"></button>
      <button id="download-json"></button><div id="ready-actions"></div><p id="status"></p>
    `)
    const store: Record<string, unknown> = {
      scanStatus: 'idle',
      scanJson: '{"stale":true}',
      scanProgress: { completed: 2, maximum: 8 }
    }
    const set = vi.fn(async (value: Record<string, unknown>) => Object.assign(store, value))
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 77, url: 'https://example.com/private' }]) },
      storage: {
        session: {
          get: vi.fn(async () => ({ ...store })),
          set
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: { request: vi.fn().mockResolvedValue(true) },
      action: { setBadgeText: vi.fn().mockResolvedValue(undefined) },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          ok: false,
          code: 'interaction-restore-abort'
        })
      }
    })

    await initializePopup()
    dom.window.document.getElementById('smart-scan')?.click()

    await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      scanStatus: 'error',
      scanJson: '',
      scanProgress: null,
      scanHeartbeatAt: 0,
      scanErrorCode: 'interaction-restore-abort'
    })))
    expect(dom.window.document.getElementById('status')?.textContent)
      .toBe('Refresh this page before running UI-Anatomist again. [unknown]')
    expect(dom.window.document.getElementById('ready-actions')?.hidden).toBe(true)
    vi.unstubAllGlobals()
  })

  it('describes a generic design-system scan and reports all result counts', () => {
    const html = readFileSync(new URL('../../src/chrome/popup/index.html', import.meta.url), 'utf8')
    expect(html).toContain('safe design-system scan')
    expect(html).toContain('Starts at current page')
    expect(html).not.toContain('Starts at site home')
    expect(html).not.toContain('typography only')
    expect(readyStatus(JSON.stringify({
      typography: [{}, {}],
      borderRadii: [{}, {}, {}],
      shadows: [{}, {}, {}, {}],
      colors: { primitives: [{}, {}], semantic: [{}, {}, {}], interactive: [{}] },
      spacing: [{}, {}, {}, {}, {}],
      controls: [{}, {}, {}, {}],
      icons: [{}, {}]
    }))).toBe('JSON is ready · 2 type styles · 3 radii · 4 shadows · 2 primitive · 3 semantic · 1 interactive · 5 spacing · 4 controls · 2 icons')
    expect(readyStatus('not json')).toBe('JSON is ready')
  })

  it('keeps a ready JSON copy action working on a non-http active tab', async () => {
    const dom = new JSDOM(`
      <button id="smart-scan"></button><button id="copy-json"></button>
      <button id="download-json"></button><div id="ready-actions"></div><p id="status"></p>
    `)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'chrome://extensions' }]) },
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({ scanStatus: 'ready', scanJson: '{"ok":true}' }),
          set: vi.fn().mockResolvedValue(undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: { request: vi.fn() },
      action: { setBadgeText: vi.fn().mockResolvedValue(undefined) },
      runtime: { sendMessage: vi.fn() }
    })

    await initializePopup()
    dom.window.document.getElementById('copy-json')?.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('{"ok":true}'))
    vi.unstubAllGlobals()
  })

  it('clears a stale READY badge when the popup opens', async () => {
    const dom = new JSDOM(`
      <button id="smart-scan"></button><button id="copy-json"></button>
      <button id="download-json"></button><div id="ready-actions"></div><p id="status"></p>
    `)
    const setBadgeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com/' }]) },
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({ scanStatus: 'ready', scanJson: '{"ok":true}' }),
          set: vi.fn().mockResolvedValue(undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: { request: vi.fn() },
      action: { setBadgeText },
      runtime: { sendMessage: vi.fn() }
    })

    await initializePopup()

    expect(setBadgeText).toHaveBeenCalledWith({ text: '' })
    vi.unstubAllGlobals()
  })

  it('still renders the ready result when badge cleanup fails', async () => {
    const dom = new JSDOM(`
      <button id="smart-scan"></button><button id="copy-json"></button>
      <button id="download-json"></button><div id="ready-actions"></div><p id="status"></p>
    `)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com/' }]) },
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({
            scanStatus: 'ready',
            scanJson: '{"typography":[],"borderRadii":[],"shadows":[],"colors":{"primitives":[],"semantic":[],"interactive":[]},"spacing":[],"controls":[]}'
          }),
          set: vi.fn().mockResolvedValue(undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: { request: vi.fn() },
      action: { setBadgeText: vi.fn().mockRejectedValue(new Error('badge unavailable')) },
      runtime: { sendMessage: vi.fn() }
    })

    await expect(initializePopup()).resolves.toBeUndefined()
    expect(dom.window.document.getElementById('status')?.textContent)
      .toBe('JSON is ready · 0 type styles · 0 radii · 0 shadows · 0 primitive · 0 semantic · 0 interactive · 0 spacing · 0 controls · 0 icons')
    vi.unstubAllGlobals()
  })
})
