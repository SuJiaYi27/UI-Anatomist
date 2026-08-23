import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  pageHasDraft,
  pageHideProgress,
  pageReadUiState,
  pageRestoreUiState,
  pageShowProgress,
  SMART_SCAN_OVERLAY_SELECTOR
} from '../../src/chrome/background/page-session'

function install(html: string): JSDOM {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://example.com/app' })
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
  return dom
}

describe('Chrome current-page session', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('detects a visible unsent draft without reading file inputs', () => {
    install('<textarea>draft</textarea><input type="file">')
    expect(pageHasDraft()).toBe(true)
  })

  it('records a visible structural toggle', () => {
    install('<button aria-label="Open sidebar">Open</button>')
    expect(pageReadUiState()).toEqual({
      toggles: [{ subject: 'sidebar', action: 'open' }]
    })
  })

  it('ignores hidden and disabled structural toggles', () => {
    install(`
      <button hidden aria-label="Open menu">Open</button>
      <button disabled aria-label="Open panel">Open</button>
      <button aria-label="Open history">Open</button>
    `)
    expect(pageReadUiState()).toEqual({
      toggles: [{ subject: 'history', action: 'open' }]
    })
  })

  it('restores an exact structural toggle through the opposite action', async () => {
    vi.useFakeTimers()
    const dom = install('<button id="toggle" aria-label="Close sidebar">Close</button>')
    const button = dom.window.document.querySelector<HTMLButtonElement>('#toggle')!
    let clicks = 0
    button.addEventListener('click', () => {
      clicks += 1
      button.setAttribute('aria-label', 'Open sidebar')
    })
    const restoration = pageRestoreUiState({
      toggles: [{ subject: 'sidebar', action: 'open' }]
    })
    await vi.runAllTimersAsync()
    await restoration
    expect(clicks).toBe(1)
  })

  it('renders and removes only the UI-Anatomist progress overlay', () => {
    const dom = install('<main>Page</main>')
    pageShowProgress({ completed: 2, maximum: 8 })
    expect(dom.window.document.querySelector(SMART_SCAN_OVERLAY_SELECTOR)?.textContent)
      .toBe('UI-Anatomist · Scanning 2 / 8')
    pageHideProgress()
    expect(dom.window.document.querySelector(SMART_SCAN_OVERLAY_SELECTOR)).toBeNull()
  })
})
