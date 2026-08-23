import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { inspectDocument } from '../../src/chrome/content/index'

function rect(width: number, height: number, x = 0, y = 0): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({})
  }
}

function scrollMetrics(element: HTMLElement, clientHeight: number, scrollHeight: number): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight }
  })
}

describe('generic rendered-state regression', () => {
  it('covers SVG/font icons, base/revealed scrolling, safe settings, and exact Hover paint', async () => {
    const html = readFileSync(
      'tests/fixtures/generic-rendered-state-page.html',
      'utf8'
    )
    const fontBase64 = readFileSync(
      'tests/fixtures/font-icon-ligature.woff2.base64',
      'utf8'
    ).trim()
    const dom = new JSDOM(html, {
      pretendToBeVisual: true,
      url: 'https://example.com/'
    })
    const document = dom.window.document
    ;(dom.window as unknown as { fetch: typeof fetch }).fetch = globalThis.fetch.bind(globalThis)
    Object.defineProperty(dom.window.performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{
        name: `data:font/woff2;base64,${fontBase64}`,
        entryType: 'resource',
        startTime: 0,
        duration: 0,
        toJSON: () => ({})
      }]
    })

    document.querySelectorAll<HTMLElement>('button').forEach(element => {
      element.getBoundingClientRect = () => rect(120, 36)
    })
    document.querySelectorAll<HTMLElement>('span').forEach(element => {
      element.getBoundingClientRect = () => rect(24, 24, 6, 6)
    })
    document.querySelectorAll<SVGElement>('svg').forEach(element => {
      element.getBoundingClientRect = () => rect(24, 24, 6, 6)
    })
    const hoverControl = document.querySelector<HTMLElement>('#hover-control')!
    const hoverSurface = document.querySelector<HTMLElement>('.hover-surface')!
    hoverControl.getBoundingClientRect = () => rect(36, 36)
    hoverSurface.getBoundingClientRect = () => rect(32, 32, 2, 2)

    const primary = document.querySelector<HTMLElement>('#primary')!
    const panel = document.querySelector<HTMLElement>('#settings-panel')!
    primary.getBoundingClientRect = () => rect(320, 100)
    panel.getBoundingClientRect = () => rect(320, 100)
    scrollMetrics(primary, 100, 600)
    scrollMetrics(panel, 100, 400)

    const trigger = document.querySelector<HTMLButtonElement>('#settings-trigger')!
    let forbiddenClicks = 0
    trigger.addEventListener('click', () => {
      const open = trigger.getAttribute('aria-expanded') !== 'true'
      trigger.setAttribute('aria-expanded', String(open))
      panel.toggleAttribute('hidden', !open)
    })
    document.querySelector('#forbidden-toggle')?.addEventListener('click', () => {
      forbiddenClicks += 1
    })
    document.querySelector('#forbidden-save')?.addEventListener('click', () => {
      forbiddenClicks += 1
    })
    document.querySelector('#file-picker')?.addEventListener('click', () => {
      forbiddenClicks += 1
    })

    const result = await inspectDocument(document, {
      stability: {
        minimumWaitMs: 0,
        quietPeriodMs: 0,
        maximumWaitMs: 50
      }
    })

    expect(result.icons).toHaveLength(3)
    expect(result.icons.every(icon => icon.vectorSvg.includes('<path'))).toBe(true)
    expect(result.controls.some(token =>
      token.slots.leading?.assetType === 'ui-icon' &&
      token.slots.leading.vectorSvg?.includes('<path')
    )).toBe(true)
    const interactiveIcon = result.icons.find(icon =>
      icon.interactionSurfaces?.some(surface => surface.state === 'hover')
    )
    expect(interactiveIcon).toMatchObject({
      name: expect.stringMatching(/^icon-[a-f0-9]{6}$/),
      nameSource: 'geometry'
    })
    expect(interactiveIcon?.interactionSurfaces).toEqual([
      expect.objectContaining({
        state: 'hover',
        width: 32,
        height: 32,
        radii: {
          topLeft: 4,
          topRight: 4,
          bottomRight: 4,
          bottomLeft: 4
        }
      })
    ])
    // The revealed state is sampled once, twice while the primary region moves,
    // and twice while its own panel moves.
    expect(result.shadows.find(token => token.layers[0]?.blur === 19)?.occurrences).toBe(5)
    expect(result.revealedStates).toBe(1)
    expect(forbiddenClicks).toBe(0)
    expect(primary.scrollTop).toBe(0)
    expect(panel.scrollTop).toBe(0)
    expect(panel.hidden).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(JSON.stringify(result.controls)).not.toContain('"value":"settings"')
    expect(JSON.stringify(result)).not.toContain(fontBase64.slice(0, 40))
  })
})
