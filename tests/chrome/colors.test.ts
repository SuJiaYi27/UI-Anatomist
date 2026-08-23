import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import type { PrimitiveColorToken } from '../../src/shared/schema'
import {
  collectColors,
  colorFamily,
  inferNeutralRamp,
  parseCssColor
} from '../../src/chrome/content/colors'

function id(character: string): string {
  return `sha256:${character.repeat(64)}`
}

function withVisibleLayout(dom: JSDOM): JSDOM {
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 100, height: 20,
    top: 0, right: 100, bottom: 20, left: 0,
    toJSON: () => ({})
  }) as DOMRect
  return dom
}

function setRect(element: Element, width: number, height: number): void {
  element.getBoundingClientRect = () => ({
    x: 0, y: 0, width, height,
    top: 0, right: width, bottom: height, left: 0,
    toJSON: () => ({})
  }) as DOMRect
}

describe('parseCssColor', () => {
  it.each([
    ['#369', { r: 0.2, g: 0.4, b: 0.6, a: 1 }],
    ['#33669980', { r: 0.2, g: 0.4, b: 0.6, a: 0.502 }],
    ['rgb(51, 102, 153)', { r: 0.2, g: 0.4, b: 0.6, a: 1 }],
    ['rgb(20% 40% 60% / 50%)', { r: 0.2, g: 0.4, b: 0.6, a: 0.5 }],
    ['color(srgb 0.2 0.4 0.6 / .25)', { r: 0.2, g: 0.4, b: 0.6, a: 0.25 }],
    ['oklab(0 0 0 / 0.0418629)', { r: 0, g: 0, b: 0, a: 0.0419 }],
    ['oklab(0.627955 0.224863 0.125846)', { r: 1, g: 0, b: 0, a: 1 }],
    ['white', { r: 1, g: 1, b: 1, a: 1 }],
    ['black', { r: 0, g: 0, b: 0, a: 1 }],
    ['transparent', { r: 0, g: 0, b: 0, a: 0 }]
  ])('parses %s without floating noise', (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected)
  })

  it.each([
    '', 'none', 'currentColor', 'var(--surface)', 'linear-gradient(#fff, #000)',
    'rgb(999 0 0)', 'rgb(1foo 2 3)', 'rgba(1,2,3,0.5oops)', 'rgb(1, 2 3)'
  ])
    ('rejects unsupported or invalid %s', input => {
      expect(parseCssColor(input)).toBeNull()
    })
})

describe('colorFamily', () => {
  it('recognizes neutral and numeric hue families without using names', () => {
    expect(colorFamily({ r: 0.4, g: 0.41, b: 0.42, a: 1 })).toBe('neutral')
    expect(colorFamily({ r: 0.1, g: 0.4, b: 0.9, a: 1 })).toBe('blue')
    expect(colorFamily({ r: 0.9, g: 0.1, b: 0.5, a: 1 })).toBe('pink')
  })
})

describe('inferNeutralRamp', () => {
  const token = (
    key: string,
    value: PrimitiveColorToken['value'],
    family: PrimitiveColorToken['family'] = 'neutral'
  ): PrimitiveColorToken => ({
    id: id(key),
    name: `${family}-${key}`,
    value,
    family,
    step: null,
    provenance: 'observed',
    occurrences: 1
  })

  it('fills a standard neutral ramp only when light and dark anchors exist', async () => {
    const source = [
      token('a', { r: 1, g: 1, b: 1, a: 1 }),
      token('b', { r: 0, g: 0, b: 0, a: 1 }),
      token('c', { r: 0.95, g: 0.1, b: 0.5, a: 1 }, 'pink')
    ]
    const result = await inferNeutralRamp(source)
    const inferred = result.filter(item => item.provenance === 'inferred')
    expect(inferred.map(item => item.step)).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
    expect(inferred.every(item => item.family === 'neutral' && item.occurrences === 0)).toBe(true)
    expect(result.filter(item => item.family === 'pink')).toEqual([source[2]])
  })

  it('does not infer from a narrow neutral range or a chromatic pair', async () => {
    const narrow = [
      token('a', { r: 0.8, g: 0.8, b: 0.8, a: 1 }),
      token('b', { r: 0.4, g: 0.4, b: 0.4, a: 1 })
    ]
    const chromatic = [
      token('c', { r: 0.95, g: 0.1, b: 0.5, a: 1 }, 'pink'),
      token('d', { r: 0.2, g: 0.01, b: 0.1, a: 1 }, 'pink')
    ]
    expect(await inferNeutralRamp(narrow)).toEqual(narrow)
    expect(await inferNeutralRamp(chromatic)).toEqual(chromatic)
  })

  it('keeps a nearby real color instead of creating an inferred duplicate', async () => {
    const realMid = token('c', { r: 0.502, g: 0.502, b: 0.502, a: 1 })
    const result = await inferNeutralRamp([
      token('a', { r: 1, g: 1, b: 1, a: 1 }),
      realMid,
      token('b', { r: 0, g: 0, b: 0, a: 1 })
    ])
    expect(result.filter(item => item.step === 500)).toEqual([])
    expect(result).toContain(realMid)
  })
})

describe('collectColors', () => {
  it('ignores unused global and unmatched component palettes', async () => {
    const dom = withVisibleLayout(new JSDOM(`<!doctype html><html><head><style>
      :root {
        --unused-pink: #ff00aa;
        --unused-purple: #9933ff;
        --visible-surface: #ffffff;
      }
      .unused-component:hover { color:#ff00aa; background:#9933ff; }
    </style></head><body>
      <main style="background:var(--visible-surface);color:#0d0d0d">Private</main>
    </body></html>`, { pretendToBeVisual: true }))

    const result = await collectColors(dom.window.document)
    expect(result.primitives.some(token => token.family === 'pink')).toBe(false)
    expect(result.primitives.some(token => token.family === 'purple')).toBe(false)
    expect(result.semantic.every(token => token.provenance === 'observed')).toBe(true)
    expect(result.interactive.every(token => token.provenance === 'observed')).toBe(true)
  })

  it('keeps primitive and semantic names unique for near endpoints and alpha', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <div style="color:#000;background:#0d0d0d;border:1px solid rgba(0,0,0,.101)">Private</div>
      <div style="border:1px solid rgba(0,0,0,.104)">Private</div>
    `, { pretendToBeVisual: true }))
    const result = await collectColors(dom.window.document)
    expect(new Set(result.primitives.map(token => token.name)).size).toBe(result.primitives.length)
    expect(new Set(result.semantic.map(token => token.name)).size).toBe(result.semantic.length)
  })

  it('collects real rendered UI roles while excluding declarations, brand assets and private text', async () => {
    const dom = withVisibleLayout(new JSDOM(`<!doctype html><html><head><style>
      :root {
        --surface-primary: #ffffff;
        --button-primary-hover: rgb(230 230 230);
        --danger-disabled-border: #cc2222;
        --brand-pink: #ff00aa;
      }
      body { color: #111; background: #fff; }
      main { background-color: rgb(250, 250, 250); }
      p { color: rgb(34, 34, 34); border: 1px solid rgb(220, 220, 220); }
      a { color: rgb(20, 90, 200); }
      button { color: white; background-color: black; outline-color: rgb(10, 100, 220); }
      [role="alert"] { color: rgb(200, 30, 30); }
      .logo { color: rgb(255, 0, 170); background: rgb(255, 220, 240); }
      [hidden] { color: rgb(1, 2, 3); }
    </style></head><body>
      <main><p>private paragraph</p><a href="#safe">private link</a></main>
      <button disabled>private button</button>
      <div role="alert">private alert</div>
      <div class="logo">private logo</div>
      <div hidden>private hidden</div>
      <div data-smart-scan-overlay="true" style="color:rgb(9,9,9)">overlay</div>
    </body></html>`, { pretendToBeVisual: true }))

    const result = await collectColors(dom.window.document)
    expect(result.primitives.some(token => token.value.r === 1 && token.value.g === 0 && token.value.b > 0.6)).toBe(false)
    expect(result.semantic.some(token => token.group === 'background')).toBe(true)
    expect(result.semantic.some(token => token.group === 'text')).toBe(true)
    expect(result.semantic.some(token => token.group === 'border')).toBe(true)
    expect(result.semantic.some(token => token.group === 'link')).toBe(true)
    expect(result.semantic.some(token => token.group === 'status')).toBe(true)
    expect(result.interactive.some(token =>
      token.intent === 'primary' && token.state === 'disabled' && token.usage === 'background'
    )).toBe(true)
    expect(result.primitives.every(token => token.provenance === 'observed')).toBe(true)
    expect(result.semantic.every(token => token.provenance === 'observed')).toBe(true)
    expect(result.interactive.every(token => token.provenance === 'observed')).toBe(true)

    const primitiveIds = new Set(result.primitives.map(token => token.id))
    expect(result.semantic.every(token => primitiveIds.has(token.primitiveId))).toBe(true)
    expect(result.interactive.every(token => primitiveIds.has(token.primitiveId))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('.logo')
    expect(JSON.stringify(result)).not.toContain('--brand-pink')
  })

  it('counts one identical border color per element instead of four sides', async () => {
    const dom = withVisibleLayout(new JSDOM('<div style="border: 1px solid rgb(100, 110, 120)">x</div>'))
    const result = await collectColors(dom.window.document)
    const border = result.semantic.find(token => token.group === 'border')
    expect(border?.occurrences).toBe(1)
  })

  it('keeps an icon-button container color while excluding the icon asset itself', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <button class="icon-button" style="background:rgb(12,34,56);color:white">
        <svg style="color:rgb(255,0,170)" role="img"><path /></svg>
      </button>
    `))
    const result = await collectColors(dom.window.document)
    expect(result.primitives.some(token =>
      token.value.r === 0.0471 && token.value.g === 0.1333 && token.value.b === 0.2196
    )).toBe(true)
    expect(result.primitives.some(token =>
      token.value.r === 1 && token.value.g === 0 && token.value.b > 0.6
    )).toBe(false)
  })

  it('excludes compact image and SVG asset shells while keeping real UI surfaces', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <section id="plugin-row" style="background:rgb(11,22,33)">
        <a id="image-shell" href="#safe" style="background:rgb(58,131,247)">
          <img id="plugin-image" alt="" />
        </a>
        <span id="svg-shell" style="background:rgb(250,66,62)">
          <svg id="plugin-svg" role="img"><path /></svg>
        </span>
        <button id="icon-button" style="background:rgb(12,34,56)">
          <svg id="button-icon"><path /></svg>
        </button>
      </section>
    `))
    setRect(dom.window.document.querySelector('#plugin-row')!, 520, 72)
    setRect(dom.window.document.querySelector('#image-shell')!, 48, 48)
    setRect(dom.window.document.querySelector('#plugin-image')!, 32, 32)
    setRect(dom.window.document.querySelector('#svg-shell')!, 40, 40)
    setRect(dom.window.document.querySelector('#plugin-svg')!, 24, 24)
    setRect(dom.window.document.querySelector('#icon-button')!, 40, 40)
    setRect(dom.window.document.querySelector('#button-icon')!, 20, 20)

    const result = await collectColors(dom.window.document)
    const keys = new Set(result.primitives.map(token =>
      `${token.value.r}|${token.value.g}|${token.value.b}`
    ))

    expect(keys).toContain('0.0431|0.0863|0.1294')
    expect(keys).toContain('0.0471|0.1333|0.2196')
    expect(keys).not.toContain('0.2275|0.5137|0.9686')
    expect(keys).not.toContain('0.9804|0.2588|0.2431')
  })

  it('excludes compact image-shell colors before the image has layout bounds', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <main style="background:rgb(11,22,33)">
        <a id="image-shell" href="#safe" style="background:rgb(58,131,247)">
          <img id="plugin-image" alt="" />
        </a>
        <button id="real-control" style="background:rgb(12,34,56)">
          <svg><path /></svg>
        </button>
      </main>
    `))
    setRect(dom.window.document.querySelector('main')!, 520, 72)
    setRect(dom.window.document.querySelector('#image-shell')!, 48, 48)
    setRect(dom.window.document.querySelector('#plugin-image')!, 0, 0)
    setRect(dom.window.document.querySelector('#real-control')!, 40, 40)
    setRect(dom.window.document.querySelector('svg')!, 20, 20)

    const result = await collectColors(dom.window.document)
    const keys = new Set(result.primitives.map(token =>
      `${token.value.r}|${token.value.g}|${token.value.b}`
    ))

    expect(keys).toContain('0.0431|0.0863|0.1294')
    expect(keys).toContain('0.0471|0.1333|0.2196')
    expect(keys).not.toContain('0.2275|0.5137|0.9686')
  })

  it('keeps website-applied content presentation colors while excluding the graphic payload', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <article class="markdown-body">
        <figure id="media-shell" style="
          background:rgb(58,131,247);
          border:1px solid rgb(31,99,201)
        ">
          <img id="payload" alt="author supplied image" style="background:rgb(250,66,62)" />
        </figure>
      </article>
    `))
    setRect(dom.window.document.querySelector('article')!, 520, 240)
    setRect(dom.window.document.querySelector('#media-shell')!, 120, 80)
    setRect(dom.window.document.querySelector('#payload')!, 120, 80)

    const result = await collectColors(dom.window.document)
    const keys = new Set(result.primitives.map(token =>
      `${token.value.r}|${token.value.g}|${token.value.b}`
    ))

    expect(keys).toContain('0.2275|0.5137|0.9686')
    expect(keys).toContain('0.1216|0.3882|0.7882')
    expect(keys).not.toContain('0.9804|0.2588|0.2431')
    expect(JSON.stringify(result)).not.toContain('author supplied image')
  })

  it('keeps website typography, wrappers and operations but rejects direct author colors', async () => {
    const dom = withVisibleLayout(new JSDOM(`<!doctype html><html><head><style>
      .markdown-body { color: rgb(34, 34, 34); }
      .reply { color: white; background: rgb(31, 99, 201); }
    </style></head><body>
      <article class="markdown-body">
        <p><span id="author-color" style="color:rgb(222,33,99)">Author text</span></p>
        <figure id="website-wrapper" style="background:rgb(240,246,252)">
          <img id="payload" alt="" />
        </figure>
        <button class="reply">Reply</button>
      </article>
    </body></html>`, { pretendToBeVisual: true }))
    setRect(dom.window.document.querySelector('article')!, 520, 240)
    setRect(dom.window.document.querySelector('#website-wrapper')!, 120, 80)
    setRect(dom.window.document.querySelector('#payload')!, 120, 80)

    const result = await collectColors(dom.window.document)
    const keys = new Set(result.primitives.map(token =>
      `${token.value.r}|${token.value.g}|${token.value.b}`
    ))

    expect(keys).toContain('0.1333|0.1333|0.1333')
    expect(keys).toContain('0.9412|0.9647|0.9882')
    expect(keys).toContain('0.1216|0.3882|0.7882')
    expect(keys).not.toContain('0.8706|0.1294|0.3882')
  })

  it('quarantines a one-off compact inline data color', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <main style="color:rgb(31,35,40)">
        <span id="data-color" style="display:inline-block;background:rgb(241,224,90)"></span>
      </main>
    `))
    setRect(dom.window.document.querySelector('#data-color')!, 12, 12)

    const result = await collectColors(dom.window.document)

    expect(result.primitives.some(token =>
      token.value.r === 0.9451 &&
      token.value.g === 0.8784 &&
      token.value.b === 0.3529
    )).toBe(false)
    expect(result.primitives.some(token =>
      token.value.r === 0.1216 &&
      token.value.g === 0.1373 &&
      token.value.b === 0.1569
    )).toBe(true)
  })

  it('keeps the current computed theme and ignores unmatched theme declarations', async () => {
    const dom = withVisibleLayout(new JSDOM(`<!doctype html><html class="light"><head><style>
      :root { --unused-green: #33aa88; --unused-pink: #ff44bb; }
      .light .toast { background: #33aa88; }
      .dark .toast { background: #ff44bb; }
    </style></head><body><div class="toast">Private</div></body></html>`, { pretendToBeVisual: true }))
    const result = await collectColors(dom.window.document)
    expect(result.primitives.some(token =>
      token.value.r === 0.2 && token.value.g === 0.6667 && token.value.b === 0.5333
    )).toBe(true)
    expect(result.primitives.some(token => token.family === 'pink')).toBe(false)
  })

  it('classifies a real selected control and ignores unused interactive declarations', async () => {
    const dom = withVisibleLayout(new JSDOM(`<!doctype html><html><head><style>
      :root { --interactive-primary-background: #eeeeee; --primary-active-background: #ff00aa; }
    </style></head><body><button aria-pressed="true" style="background:#dddddd">Private</button></body></html>`))
    const result = await collectColors(dom.window.document)
    expect(result.interactive.some(token =>
      token.state === 'selected' && token.usage === 'background' &&
      token.value.r === 0.8667 && token.value.g === 0.8667 && token.value.b === 0.8667
    )).toBe(true)
    expect(result.primitives.some(token => token.family === 'pink')).toBe(false)
  })

  it('excludes camelCase brand and logo asset markers', async () => {
    const dom = withVisibleLayout(new JSDOM(`<!doctype html><html><head><style>
      :root { --logoColor: #00ffcc; --brandColor: #aa00ff; }
      .appLogo { background: #00ffcc; color: #aa00ff; }
    </style></head><body><div class="appLogo">Asset</div></body></html>`))
    const result = await collectColors(dom.window.document)
    expect(result.primitives.some(token =>
      token.value.g === 1 && token.value.b === 0.8
    )).toBe(false)
    expect(result.primitives.some(token =>
      token.value.r > 0.6 && token.value.b === 1
    )).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/logo|brand/i)
  })

  it('excludes font-icon colors without excluding an icon-button container', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <button class="icon-button" style="background:rgb(12,34,56);color:white">
        <span class="leadingIcon" style="color:rgb(255,0,170)">x</span>
      </button>
    `))
    const result = await collectColors(dom.window.document)
    expect(result.primitives.some(token =>
      token.value.r === 0.0471 && token.value.g === 0.1333 && token.value.b === 0.2196
    )).toBe(true)
    expect(result.primitives.some(token =>
      token.value.r === 1 && token.value.g === 0 && token.value.b > 0.6
    )).toBe(false)
  })

  it('ignores elements with no rendered area', async () => {
    const dom = withVisibleLayout(new JSDOM(`
      <main style="color:rgb(20,30,40)">Visible</main>
      <div id="zero" style="color:rgb(250,10,180)">No rendered box</div>
    `))
    dom.window.document.querySelector('#zero')!.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({})
    }) as DOMRect

    const result = await collectColors(dom.window.document)
    expect(result.primitives.some(token =>
      token.value.r > 0.9 && token.value.g < 0.1 && token.value.b > 0.6
    )).toBe(false)
  })
})
