import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { collectBorderRadii, normalizeRadiusPart } from '../../src/chrome/content/border-radii'

function visibleRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 56,
    height: 56,
    top: 0,
    right: 56,
    bottom: 56,
    left: 0,
    toJSON: () => ({})
  }
}

describe('collectBorderRadii', () => {
  it('collects every normalized non-zero UI radius without a fixed token count or asset identity', async () => {
    const dom = new JSDOM(readFileSync('tests/fixtures/border-radii.html', 'utf8'), {
      pretendToBeVisual: true,
      url: 'https://example.com/'
    })
    dom.window.document.querySelectorAll<HTMLElement>('[data-visible]').forEach(element => {
      element.getBoundingClientRect = visibleRect
    })

    const result = await collectBorderRadii(dom.window.document)

    expect(result.map(item => [item.kind, item.value])).toEqual([
      ['px', 2],
      ['px', 4],
      ['px', 8],
      ['px', 10],
      ['px', 10.5],
      ['px', 18],
      ['px', 20],
      ['percent', 25],
      ['full', null]
    ])
    expect(result.find(item => item.kind === 'full')?.occurrences).toBe(3)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('brand logo')
    expect(serialized).not.toContain('data:image')
  })

  it('does not read element text while collecting geometry', async () => {
    const dom = new JSDOM('<div id="surface" style="border-radius:8px">secret content</div>', {
      pretendToBeVisual: true
    })
    const surface = dom.window.document.querySelector<HTMLElement>('#surface')!
    surface.getBoundingClientRect = visibleRect
    Object.defineProperty(surface, 'textContent', {
      configurable: true,
      get: () => { throw new Error('text content must not be read') }
    })

    await expect(collectBorderRadii(dom.window.document)).resolves.toMatchObject([
      { kind: 'px', value: 8, occurrences: 1 }
    ])
  })

  it('keeps website-applied media wrapper geometry without reading the author payload', async () => {
    const dom = new JSDOM(`
      <article class="markdown-body">
        <figure id="media-frame" style="border-radius:13px;overflow:hidden">
          <img id="payload" src="data:image/png;base64,AA==" alt="author payload"/>
        </figure>
      </article>
    `, { pretendToBeVisual: true })
    const frame = dom.window.document.querySelector<HTMLElement>('#media-frame')!
    const payload = dom.window.document.querySelector<HTMLElement>('#payload')!
    frame.getBoundingClientRect = () => ({
      ...visibleRect(),
      width: 240,
      height: 160,
      right: 240,
      bottom: 160
    })
    payload.getBoundingClientRect = frame.getBoundingClientRect

    const result = await collectBorderRadii(dom.window.document)

    expect(result).toContainEqual(expect.objectContaining({
      kind: 'px',
      value: 13,
      occurrences: 1
    }))
    expect(JSON.stringify(result)).not.toContain('author payload')
  })

  it('normalizes browser scientific notation as full', () => {
    expect(normalizeRadiusPart('1.67772e+07px')).toEqual({ kind: 'full', value: null })
  })

  it('classifies a px radius as full only when rendered geometry reaches half the short side', async () => {
    const dom = new JSDOM(`
      <div id="circle" style="border-radius:28px">Circle</div>
      <div id="pill" style="border-radius:28px">Pill</div>
      <div id="card" style="border-radius:28px">Card</div>
      <div id="fallback" style="border-radius:999px">Fallback</div>
      <div id="large" style="border-radius:999px">Large surface</div>
    `, { pretendToBeVisual: true })
    const rect = (width: number, height: number): DOMRect => ({
      x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0, toJSON: () => ({})
    })
    dom.window.document.querySelector<HTMLElement>('#circle')!.getBoundingClientRect = () => rect(56, 56)
    dom.window.document.querySelector<HTMLElement>('#pill')!.getBoundingClientRect = () => rect(200, 56)
    dom.window.document.querySelector<HTMLElement>('#card')!.getBoundingClientRect = () => rect(200, 100)
    dom.window.document.querySelector<HTMLElement>('#fallback')!.getBoundingClientRect = () => rect(200, 100)
    dom.window.document.querySelector<HTMLElement>('#large')!.getBoundingClientRect = () => rect(3000, 3000)

    const result = await collectBorderRadii(dom.window.document)

    expect(result.map(item => [item.kind, item.value, item.occurrences])).toEqual([
      ['px', 28, 1],
      ['px', 999, 1],
      ['full', null, 3]
    ])
    expect(normalizeRadiusPart('28px')).toEqual({ kind: 'px', value: 28 })
    expect(normalizeRadiusPart('28px', 28)).toEqual({ kind: 'full', value: null })
    expect(normalizeRadiusPart('999px')).toEqual({ kind: 'full', value: null })
    expect(normalizeRadiusPart('999px', 1500)).toEqual({ kind: 'px', value: 999 })
  })

  it('does not collect the extension progress overlay', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-overlay="true" style="border-radius:14px">Scanning</div>
      <div id="surface" style="border-radius:8px">Page</div>
    `, { pretendToBeVisual: true })
    dom.window.document.querySelectorAll<HTMLElement>('div').forEach(element => {
      element.getBoundingClientRect = visibleRect
    })

    const result = await collectBorderRadii(dom.window.document)

    expect(result.some(item => item.kind === 'px' && item.value === 14)).toBe(false)
    expect(result.some(item => item.kind === 'px' && item.value === 8)).toBe(true)
  })
})
