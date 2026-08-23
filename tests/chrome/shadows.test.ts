import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  collectShadows,
  parseBoxShadow,
  parseFilterDropShadows,
  parseTextShadow,
  splitShadowList
} from '../../src/chrome/content/shadows'

const outer = {
  kind: 'outer' as const,
  offsetX: 0,
  offsetY: 4,
  blur: 12,
  spread: 0,
  color: { r: 0, g: 0, b: 0, a: 0.15 }
}

function visibleRect(): DOMRect {
  return {
    x: 0, y: 0, width: 100, height: 40,
    top: 0, right: 100, bottom: 40, left: 0,
    toJSON: () => ({})
  }
}

function setRect(element: Element, width: number, height: number): void {
  element.getBoundingClientRect = () => ({
    x: 0, y: 0, width, height,
    top: 0, right: width, bottom: height, left: 0,
    toJSON: () => ({})
  }) as DOMRect
}

describe('shadow CSS parsing', () => {
  it('splits only top-level commas', () => {
    expect(splitShadowList('rgba(0, 0, 0, .15) 0 4px 12px, 0 -1px 0 #fff')).toEqual([
      'rgba(0, 0, 0, .15) 0 4px 12px',
      '0 -1px 0 #fff'
    ])
  })

  it('parses ordered outer and inset layers including a zero-blur sharp edge', () => {
    expect(parseBoxShadow(
      'rgba(0, 0, 0, 0.15) 0px 4px 12px 0px, inset 0 -1px 0 #fff'
    )).toEqual([
      outer,
      {
        kind: 'inner',
        offsetX: 0,
        offsetY: -1,
        blur: 0,
        spread: 0,
        color: { r: 1, g: 1, b: 1, a: 1 }
      }
    ])
  })

  it('parses modern rgb text shadows and filters with multiple drop-shadow functions', () => {
    expect(parseTextShadow('rgb(0 0 0 / 20%) 1px 2px 3px')).toEqual([{
      kind: 'outer', offsetX: 1, offsetY: 2, blur: 3, spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.2 }
    }])
    expect(parseFilterDropShadows(
      'blur(1px) drop-shadow(rgba(0,0,0,.1) 0 2px 4px) drop-shadow(0 -1px 0 #000)'
    )).toEqual([
      { kind: 'outer', offsetX: 0, offsetY: 2, blur: 4, spread: 0,
        color: { r: 0, g: 0, b: 0, a: 0.1 } },
      { kind: 'outer', offsetX: 0, offsetY: -1, blur: 0, spread: 0,
        color: { r: 0, g: 0, b: 0, a: 1 } }
    ])
  })
})

describe('collectShadows', () => {
  it('collects UI effects, merges visual duplicates, and excludes brand assets', async () => {
    const dom = new JSDOM(readFileSync('tests/fixtures/shadows.html', 'utf8'), {
      pretendToBeVisual: true,
      url: 'https://example.com/'
    })
    dom.window.document.querySelectorAll<HTMLElement>('[data-visible]').forEach(element => {
      element.getBoundingClientRect = visibleRect
    })

    const result = await collectShadows(dom.window.document)

    expect(result).toHaveLength(4)
    expect(result.find(token => token.layers.length === 1 && token.layers[0]?.blur === 12)?.occurrences)
      .toBe(2)
    expect(result.some(token => token.layers[0]?.kind === 'inner')).toBe(true)
    expect(result.some(token => token.layers.length === 2)).toBe(true)
    expect(new Set(result.map(token => token.name)).size).toBe(result.length)
    expect(JSON.stringify(result)).not.toMatch(/private|brand|logo|data:image/i)
  })

  it('does not read element text while collecting visual styles', async () => {
    const dom = new JSDOM('<div id="surface" style="box-shadow:0 1px 2px #000">secret</div>', {
      pretendToBeVisual: true
    })
    const surface = dom.window.document.querySelector<HTMLElement>('#surface')!
    surface.getBoundingClientRect = visibleRect
    Object.defineProperty(surface, 'textContent', {
      configurable: true,
      get: () => { throw new Error('text content must not be read') }
    })

    await expect(collectShadows(dom.window.document)).resolves.toMatchObject([
      { occurrences: 1, layers: [{ offsetY: 1, blur: 2 }] }
    ])
  })

  it('excludes compact image and SVG asset-shell shadows while keeping UI shadows', async () => {
    const dom = new JSDOM(`
      <section id="plugin-row" style="box-shadow:0 3px 9px rgba(0,0,0,.2)">
        <a id="image-shell" href="#safe" style="box-shadow:0 0 8px 8px rgb(252,252,252)">
          <img id="plugin-image" alt="" />
        </a>
        <span id="svg-shell" style="box-shadow:0 1px 7px rgba(1,2,3,.4)">
          <svg id="plugin-svg" role="img"><path /></svg>
        </span>
        <button id="icon-button" style="box-shadow:0 5px 11px rgba(4,5,6,.5)">
          <svg id="button-icon"><path /></svg>
        </button>
      </section>
    `, { pretendToBeVisual: true })
    setRect(dom.window.document.documentElement, 1024, 768)
    setRect(dom.window.document.body, 1024, 768)
    setRect(dom.window.document.querySelector('#plugin-row')!, 520, 72)
    setRect(dom.window.document.querySelector('#image-shell')!, 48, 48)
    setRect(dom.window.document.querySelector('#plugin-image')!, 32, 32)
    setRect(dom.window.document.querySelector('#svg-shell')!, 40, 40)
    setRect(dom.window.document.querySelector('#plugin-svg')!, 24, 24)
    setRect(dom.window.document.querySelector('#icon-button')!, 40, 40)
    setRect(dom.window.document.querySelector('#button-icon')!, 20, 20)

    const result = await collectShadows(dom.window.document)

    expect(result.some(token => token.layers[0]?.blur === 9)).toBe(true)
    expect(result.some(token => token.layers[0]?.blur === 11)).toBe(true)
    expect(result.some(token =>
      token.layers[0]?.blur === 8 && token.layers[0]?.spread === 8
    )).toBe(false)
    expect(result.some(token => token.layers[0]?.blur === 7)).toBe(false)
  })

  it('excludes a compact image shell before its descendant image has layout bounds', async () => {
    const dom = new JSDOM(`
      <main>
        <a id="image-shell" href="#safe" style="box-shadow:0 0 8px 8px rgb(252,252,252)">
          <img id="plugin-image" alt="" />
        </a>
        <button id="real-control" style="box-shadow:0 5px 11px rgba(4,5,6,.5)">
          <svg><path /></svg>
        </button>
      </main>
    `, { pretendToBeVisual: true })
    setRect(dom.window.document.documentElement, 1024, 768)
    setRect(dom.window.document.body, 1024, 768)
    setRect(dom.window.document.querySelector('main')!, 520, 72)
    setRect(dom.window.document.querySelector('#image-shell')!, 48, 48)
    setRect(dom.window.document.querySelector('#plugin-image')!, 0, 0)
    setRect(dom.window.document.querySelector('#real-control')!, 40, 40)
    setRect(dom.window.document.querySelector('svg')!, 20, 20)

    const result = await collectShadows(dom.window.document)

    expect(result.some(token =>
      token.layers[0]?.blur === 8 && token.layers[0]?.spread === 8
    )).toBe(false)
    expect(result.some(token => token.layers[0]?.blur === 11)).toBe(true)
  })

  it('keeps a website-applied shadow on an author-content presentation shell', async () => {
    const dom = new JSDOM(`
      <article class="markdown-body">
        <figure id="media-shell" style="box-shadow:0 2px 6px rgba(0,0,0,.25)">
          <img id="payload" alt="author supplied image"
            style="box-shadow:0 0 19px rgba(255,0,0,.8)" />
        </figure>
      </article>
    `, { pretendToBeVisual: true })
    setRect(dom.window.document.documentElement, 1024, 768)
    setRect(dom.window.document.body, 1024, 768)
    setRect(dom.window.document.querySelector('article')!, 520, 240)
    setRect(dom.window.document.querySelector('#media-shell')!, 120, 80)
    setRect(dom.window.document.querySelector('#payload')!, 120, 80)

    const result = await collectShadows(dom.window.document)

    expect(result.some(token =>
      token.layers[0]?.offsetY === 2 && token.layers[0]?.blur === 6
    )).toBe(true)
    expect(result.some(token => token.layers[0]?.blur === 19)).toBe(false)
    expect(JSON.stringify(result)).not.toContain('author supplied image')
  })
})
