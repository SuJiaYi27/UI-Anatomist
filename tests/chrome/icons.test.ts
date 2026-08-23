import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  collectExcludedGraphicIds,
  collectIcons
} from '../../src/chrome/content/icons'
import { HOVER_TARGET_ATTRIBUTE } from '../../src/chrome/content/hover-state-explorer'

function rect(width: number, height: number, x = 0, y = 0): DOMRect {
  return {
    x, y, width, height, top: y, right: x + width, bottom: y + height, left: x,
    toJSON: () => ({})
  }
}

function setRect(
  element: Element,
  width: number,
  height: number,
  x = 0,
  y = 0
): void {
  ;(element as HTMLElement).getBoundingClientRect = () => rect(width, height, x, y)
}

describe('collectIcons', () => {
  it('does not derive an icon identity from the current control value', async () => {
    const dom = new JSDOM(`
      <button>
        <svg id="current-value-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 12h16"/>
        </svg>
        <span>Current value</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#current-value-icon')!
    setRect(icon, 24, 24)

    const icons = await collectIcons(dom.window.document)

    expect(icons).toHaveLength(1)
    expect(icons[0]).toMatchObject({
      name: expect.stringMatching(/^icon-[a-f0-9]{6}$/),
      nameSource: 'geometry'
    })
    expect(icons[0]?.name).not.toContain('current-value')
  })

  it('collects SVG and font-backed UI graphics through the same vector contract', async () => {
    const fontBase64 = readFileSync(
      'tests/fixtures/font-icon-ligature.woff2.base64',
      'utf8'
    ).trim()
    const dom = new JSDOM(`
      <style>
        @font-face {
          font-family: "Material Symbols Outlined";
          src: url(data:font/woff2;base64,${fontBase64}) format("woff2");
        }
      </style>
      <body style="background:#fff;color:#111">
        <button aria-label="Search">
          <svg id="svg-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 12h16"/>
          </svg>
        </button>
        <button aria-label="Settings">
          <span id="font-icon" data-mat-icon-type="font" data-mat-icon-name="settings"
            style="font-family:'Material Symbols Outlined';display:inline-block">settings</span>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
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
    setRect(document.querySelector('#svg-icon')!, 24, 24)
    setRect(document.querySelector('#font-icon')!, 24, 24)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(2)
    expect(icons.every(icon => /^icon-[a-f0-9]{6}$/.test(icon.name))).toBe(true)
    expect(icons.every(icon => icon.nameSource === 'geometry')).toBe(true)
    expect(icons.every(icon => icon.vectorSvg.includes('<path'))).toBe(true)
    expect(JSON.stringify(icons)).not.toContain(fontBase64.slice(0, 40))
  })

  it('discovers an aria-hidden ligature custom element with strict icon semantics', async () => {
    const fontBase64 = readFileSync(
      'tests/fixtures/font-icon-ligature.woff2.base64',
      'utf8'
    ).trim()
    const dom = new JSDOM(`
      <style>
        @font-face {
          font-family: "Interface Symbols";
          src: url(data:font/woff2;base64,${fontBase64}) format("woff2");
        }
      </style>
      <button aria-label="Settings">
        <mat-icon id="font-icon" aria-hidden="true"
          class="notranslate interface-symbols ligature-font"
          style="font-family:'Interface Symbols';display:inline-block">settings</mat-icon>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#font-icon')!
    setRect(icon, 24, 24)
    ;(dom.window as unknown as { fetch: typeof fetch }).fetch =
      globalThis.fetch.bind(globalThis)

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
    const icons = await collectIcons(dom.window.document)

    expect(icons).toEqual([
      expect.objectContaining({
        name: expect.stringMatching(/^icon-[a-f0-9]{6}$/),
        nameSource: 'geometry',
        vectorSvg: expect.stringContaining('<path')
      })
    ])
  })

  it('keeps visually rendered aria-hidden control icons but excludes standalone branded images', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button aria-label="Open sidebar">
          <svg id="control" aria-hidden="true" role="img" aria-label="sidebar" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h16v16H4z"/>
          </svg>
        </button>
        <svg id="brand" role="img" aria-label="Acme logo" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 2h20v20H2z"/>
        </svg>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    setRect(dom.window.document.querySelector('#control')!, 20, 20)
    setRect(dom.window.document.querySelector('#brand')!, 24, 24)

    const icons = await collectIcons(dom.window.document)

    expect(icons).toEqual([
      expect.objectContaining({
        name: expect.stringMatching(/^icon-[a-f0-9]{6}$/),
        nameSource: 'geometry'
      })
    ])
  })

  it('deduplicates original SVG geometry while merging sizes and light-theme evidence', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#0d0d0d">
        <nav>
          <button aria-label="Search">
            <svg id="first" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M4 4h16v16H4z"/>
            </svg>
          </button>
          <button aria-label="Search">
            <svg id="second" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M4 4h16v16H4z"/>
            </svg>
          </button>
        </nav>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#first')!, 20, 20)
    setRect(document.querySelector('#second')!, 24, 24)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]).toMatchObject({
      name: expect.stringMatching(/^icon-[a-f0-9]{6}$/),
      nameSource: 'geometry',
      category: 'navigation',
      viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
      occurrences: 2,
      stateOccurrences: 1,
      observedSizes: [
        { width: 20, height: 20, occurrences: 1 },
        { width: 24, height: 24, occurrences: 1 }
      ],
      themes: [{
        theme: 'light',
        color: { r: 0.051, g: 0.051, b: 0.051, a: 1 },
        occurrences: 2
      }]
    })
    expect(icons[0]?.vectorSvg).toContain('fill-rule="evenodd"')
    expect(icons[0]?.vectorSvg).toContain('clip-rule="evenodd"')
  })

  it('records the exact rendered icon-only interaction surface instead of assigning a global radius', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger" aria-label="Add files"
          style="width:32px;height:32px;background:rgb(238,238,238);
            border-radius:4px 6px 8px 10px">
          <svg id="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4v16M4 12h16"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 32, 32)
    setRect(document.querySelector('#icon')!, 24, 24, 4, 4)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.interactionSurfaces).toEqual([{
      state: 'default',
      theme: 'light',
      background: { r: 0.9333, g: 0.9333, b: 0.9333, a: 1 },
      width: 32,
      height: 32,
      radii: {
        topLeft: 4,
        topRight: 6,
        bottomRight: 8,
        bottomLeft: 10
      },
      occurrences: 1
    }])
  })

  it('keeps an icon-only surface when its label is clipped for screen readers', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger"
          style="width:32px;height:32px;background:rgb(238,238,238);border-radius:6px">
          <svg id="icon" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4v16M4 12h16"/>
          </svg>
          <span id="sr-label" style="
            position:absolute;width:1px;height:1px;overflow:hidden;
            clip:rect(0 0 0 0);clip-path:inset(50%)
          ">Add files</span>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 32, 32)
    setRect(document.querySelector('#icon')!, 24, 24, 4, 4)
    setRect(document.querySelector('#sr-label')!, 1, 1)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.interactionSurfaces).toEqual([
      expect.objectContaining({
        state: 'default',
        width: 32,
        height: 32,
        radii: {
          topLeft: 6,
          topRight: 6,
          bottomRight: 6,
          bottomLeft: 6
        }
      })
    ])
    expect(icons[0]?.nameSource).toBe('geometry')
  })

  it('does not treat a visibly labelled action as an icon-only surface', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger"
          style="width:96px;height:32px;background:rgb(238,238,238);border-radius:6px">
          <svg id="icon" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4v16M4 12h16"/>
          </svg>
          <span id="label">Add files</span>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 96, 32)
    setRect(document.querySelector('#icon')!, 24, 24, 4, 4)
    setRect(document.querySelector('#label')!, 56, 20, 36, 6)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.interactionSurfaces).toBeUndefined()
  })

  it('records a forced CSS hover surface as hover evidence', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger" aria-label="Add files"
          ${HOVER_TARGET_ATTRIBUTE}="true"
          style="width:32px;height:32px;background:rgb(238,238,238);border-radius:4px">
          <svg id="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4v16M4 12h16"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 32, 32)
    setRect(document.querySelector('#icon')!, 24, 24, 4, 4)

    const icons = await collectIcons(document)

    expect(icons[0]?.interactionSurfaces).toEqual([
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
  })

  it.each([
    ['offscreen', 'position:absolute;left:-10000px', -10000],
    ['zero-sized glyphs', 'font-size:0', 0],
    ['transparent glyphs', 'color:transparent', 0]
  ])('keeps an icon-only surface when its label uses %s visual hiding', async (_case, style, x) => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger"
          style="width:32px;height:32px;background:rgb(238,238,238);border-radius:6px">
          <svg id="icon" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4v16M4 12h16"/>
          </svg>
          <span id="label" style="${style}">Add files</span>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 32, 32)
    setRect(document.querySelector('#icon')!, 24, 24, 4, 4)
    setRect(document.querySelector('#label')!, 56, 20, x, 0)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.interactionSurfaces).toEqual([
      expect.objectContaining({ state: 'default', width: 32, height: 32 })
    ])
  })

  it.each([
    'inset(50%)',
    'inset(100%)',
    'inset(50% 0 50% 0)',
    'circle(0)',
    'ellipse(0 0)'
  ])('does not collect a graphic fully clipped by %s even when its layout box is nonzero', async clipPath => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger" style="width:32px;height:32px;background:#eee">
          <span style="clip-path:${clipPath}">
            <svg id="ghost" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 2h20v20H2Z"/>
            </svg>
          </span>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 32, 32)
    setRect(document.querySelector('#ghost')!, 24, 24, 4, 4)

    expect(await collectIcons(document)).toEqual([])
  })

  it('records the smallest Hover-painted layer instead of the larger control shell', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger" aria-label="Add files"
          ${HOVER_TARGET_ATTRIBUTE}="true"
          style="width:36px;height:36px;background:transparent;border-radius:8px">
          <span id="surface"
            style="display:block;width:32px;height:32px;background:rgb(238,238,238);border-radius:4px">
            <svg id="icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4v16M4 12h16"/>
            </svg>
          </span>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 36, 36)
    setRect(document.querySelector('#surface')!, 32, 32, 2, 2)
    setRect(document.querySelector('#icon')!, 24, 24, 6, 6)

    const icons = await collectIcons(document)

    expect(icons[0]?.interactionSurfaces).toEqual([
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
  })

  it('does not turn a full-row overlay into an icon interaction surface', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button id="trigger" aria-label="Outline"
          style="width:902px;height:48px;background:rgb(255,255,255);border-radius:6px">
          <svg id="icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 4h8v8H4z"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#trigger')!, 902, 48)
    setRect(document.querySelector('#icon')!, 16, 16, 870, 16)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.interactionSurfaces).toBeUndefined()
  })

  it('does not derive a reusable icon name from several control aria-labels', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button aria-label="Actions for Figma">
          <svg id="figma" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 12h16"/>
          </svg>
        </button>
        <button aria-label="Actions for GitHub">
          <svg id="github" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 12h16"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    setRect(dom.window.document.querySelector('#figma')!, 20, 20)
    setRect(dom.window.document.querySelector('#github')!, 20, 20)

    const icons = await collectIcons(dom.window.document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.name).toMatch(/^icon-[a-f0-9]{6}$/)
    expect(icons[0]?.nameSource).toBe('geometry')
    expect(JSON.stringify(icons)).not.toMatch(/figma|github|actions/i)
  })

  it('falls back to a stable geometry name when one reusable icon has unrelated labels', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button aria-label="Business operations">
          <svg id="business" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h12v12H6z"/>
          </svg>
        </button>
        <button aria-label="Communication">
          <svg id="communication" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h12v12H6z"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    setRect(dom.window.document.querySelector('#business')!, 20, 20)
    setRect(dom.window.document.querySelector('#communication')!, 20, 20)

    const icons = await collectIcons(dom.window.document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.name).toMatch(/^icon-[a-f0-9]{6}$/)
    expect(icons[0]?.nameSource).toBe('geometry')
  })

  it('does not serialize accessible control names for shared geometry', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#111">
        <button aria-label="Open sidebar">
          <svg id="button-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3h18v18H3z"/>
          </svg>
        </button>
        <a href="/" aria-label="ChatGPT"><span>ChatGPT</span>
          <svg id="link-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3h18v18H3z"/>
          </svg>
        </a>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    setRect(dom.window.document.querySelector('#button-icon')!, 20, 20)
    setRect(dom.window.document.querySelector('#link-icon')!, 20, 20)

    const icons = await collectIcons(dom.window.document)

    expect(icons).toHaveLength(1)
    expect(icons[0]).toMatchObject({
      name: expect.stringMatching(/^icon-[a-f0-9]{6}$/),
      nameSource: 'geometry'
    })
    expect(JSON.stringify(icons)).not.toMatch(/open-sidebar|chatgpt/i)
  })

  it('keeps transforms and resolves same-document use references without href', async () => {
    const dom = new JSDOM(`
      <body style="background:#111;color:#fff">
        <svg aria-hidden="true" width="0" height="0" style="display:none">
          <symbol id="plus" viewBox="0 0 20 20">
            <g transform="translate(2 2)">
              <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-linecap="round"/>
            </g>
          </symbol>
        </svg>
        <main>
          <button aria-label="Create">
            <svg id="icon" viewBox="0 0 20 20"><use href="#plus"/></svg>
          </button>
        </main>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    setRect(dom.window.document.querySelector('#icon')!, 20, 20)

    const icons = await collectIcons(dom.window.document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('transform="translate(2 2)"')
    expect(icons[0]?.vectorSvg).not.toContain('<use')
    expect(icons[0]?.vectorSvg).not.toContain('href=')
    expect(icons[0]?.themes[0]?.theme).toBe('dark')
  })

  it('materializes computed outline presentation instead of turning CSS-stroked icons into solid fills', async () => {
    const dom = new JSDOM(`
      <style>
        #plugins path {
          fill: none;
          stroke: currentColor;
          stroke-width: 1.33;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
      </style>
      <body style="background:#fff;color:#0d0d0d">
        <nav>
          <button aria-label="Plugins">
            <svg id="plugins" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 10c0-4 3-7 7-7s7 3 7 7"/>
            </svg>
          </button>
        </nav>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const path = document.querySelector('#plugins path')!
    const nativeGetComputedStyle = dom.window.getComputedStyle.bind(dom.window)
    dom.window.getComputedStyle = ((element: Element) => {
      const style = nativeGetComputedStyle(element)
      if (element !== path) return style
      return new Proxy(style, {
        get(target, property, receiver) {
          if (property === 'fill') return 'none'
          if (property === 'stroke') return 'rgb(13, 13, 13)'
          if (property === 'strokeWidth') return '1.33px'
          if (property === 'strokeLinecap') return 'round'
          if (property === 'strokeLinejoin') return 'round'
          return Reflect.get(target, property, receiver)
        }
      })
    }) as typeof dom.window.getComputedStyle
    setRect(document.querySelector('#plugins')!, 20, 20)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('fill="none"')
    expect(icons[0]?.vectorSvg).toContain('stroke="currentColor"')
    expect(icons[0]?.vectorSvg).toContain('stroke-width="1.33"')
    expect(icons[0]?.vectorSvg).toContain('stroke-linecap="round"')
    expect(icons[0]?.vectorSvg).toContain('stroke-linejoin="round"')
  })

  it('preserves outline geometry when isolated computed styles lose inherited stroke paint', async () => {
    const dom = new JSDOM(`
      <body style="background:#fff;color:#0d0d0d">
        <nav>
          <button aria-label="Library">
            <svg id="library" viewBox="0 0 20 20" fill="currentColor">
              <path stroke-width="1.33" stroke-linecap="round"
                d="M3 4v12M7 4v12M11 4l3 12"/>
            </svg>
          </button>
        </nav>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const path = document.querySelector('#library path')!
    const nativeGetComputedStyle = dom.window.getComputedStyle.bind(dom.window)
    dom.window.getComputedStyle = ((element: Element) => {
      const style = nativeGetComputedStyle(element)
      if (element !== path) return style
      return new Proxy(style, {
        get(target, property, receiver) {
          if (property === 'fill') return 'rgb(13, 13, 13)'
          if (property === 'stroke') return 'none'
          return Reflect.get(target, property, receiver)
        }
      })
    }) as typeof dom.window.getComputedStyle
    setRect(document.querySelector('#library')!, 20, 20)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('fill="none"')
    expect(icons[0]?.vectorSvg).toContain('stroke="currentColor"')
    expect(icons[0]?.vectorSvg).toContain('stroke-width="1.33"')
    expect(icons[0]?.vectorSvg).toContain('stroke-linecap="round"')
  })

  it('excludes explicit logos, avatars, raster assets and unsafe personal labels', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <button aria-label="Account 12345678">
          <svg id="private" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h16v16H4z"/>
          </svg>
        </button>
        <svg id="logo" class="brand-logo" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 2h20v20H2z"/>
        </svg>
        <svg id="asset-a" class="brandLogo" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 3h18v18H3z"/>
        </svg>
        <svg id="asset-b" class="MuiAvatar-root" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 5h14v14H5z"/>
        </svg>
        <img src="avatar.png" alt="Avatar">
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    setRect(dom.window.document.querySelector('#private')!, 24, 24)
    setRect(dom.window.document.querySelector('#logo')!, 24, 24)
    setRect(dom.window.document.querySelector('#asset-a')!, 24, 24)
    setRect(dom.window.document.querySelector('#asset-b')!, 24, 24)

    const icons = await collectIcons(dom.window.document)

    expect(icons).toEqual([])
    expect(JSON.stringify(icons)).not.toContain('12345678')
    expect(JSON.stringify(icons)).not.toContain('avatar.png')
  })

  it('excludes the leading identity graphic of a selected compound option but keeps its trailing UI marker', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <div role="menu">
        <div id="row" tabindex="0" aria-selected="true">
          <svg id="identity" viewBox="0 0 24 24" fill="none">
            <path d="M2 2h20v20H2z" stroke="currentColor"/>
          </svg>
          <span id="primary">Standard plan</span>
          <span id="supporting">General purpose</span>
          <svg id="check" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l4 4L19 6" stroke="currentColor"/>
          </svg>
        </div>
        </div>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#row')!, 360, 52)
    setRect(document.querySelector('#identity')!, 20, 20, 8, 16)
    setRect(document.querySelector('#primary')!, 120, 18, 42, 7)
    setRect(document.querySelector('#supporting')!, 150, 18, 42, 29)
    setRect(document.querySelector('#check')!, 16, 16, 336, 18)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('M5 12l4 4L19 6')
    expect(JSON.stringify(icons)).not.toContain('M2 2h20v20H2z')
  })

  it('excludes a compound-row identity even when selection is exposed only visually', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <div role="menu">
          <div id="row" style="cursor:pointer">
            <svg id="identity" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 2h20v20H2z"/>
            </svg>
            <span id="primary">Standard plan</span>
            <span id="supporting">General purpose</span>
            <svg id="check" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l4 4L19 6" stroke="currentColor"/>
            </svg>
          </div>
        </div>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#row')!, 360, 52)
    setRect(document.querySelector('#identity')!, 20, 20, 8, 16)
    setRect(document.querySelector('#primary')!, 120, 18, 42, 7)
    setRect(document.querySelector('#supporting')!, 150, 18, 42, 29)
    setRect(document.querySelector('#check')!, 16, 16, 336, 18)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('M5 12l4 4L19 6')
    expect(JSON.stringify(icons)).not.toContain('M2 2h20v20H2z')
  })

  it('finds the compound row when the leading identity is wrapped in an inner control', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <div role="menu">
          <div id="row" style="cursor:pointer">
            <button id="identity-control">
              <svg id="identity" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 2h20v20H2z"/>
              </svg>
            </button>
            <span id="primary">Standard plan</span>
            <span id="supporting">General purpose</span>
            <svg id="check" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l4 4L19 6" stroke="currentColor"/>
            </svg>
          </div>
        </div>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#row')!, 360, 52)
    setRect(document.querySelector('#identity-control')!, 24, 24, 6, 14)
    setRect(document.querySelector('#identity')!, 20, 20, 8, 16)
    setRect(document.querySelector('#primary')!, 120, 18, 42, 7)
    setRect(document.querySelector('#supporting')!, 150, 18, 42, 29)
    setRect(document.querySelector('#check')!, 16, 16, 336, 18)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('M5 12l4 4L19 6')
    expect(JSON.stringify(icons)).not.toContain('M2 2h20v20H2z')
  })

  it('excludes a nested leading identity in a real menuitemradio compound row', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <div role="menu">
          <div id="row" role="menuitemradio" data-radix-collection-item style="cursor:pointer">
            <div id="content">
              <div id="leading-wrap">
                <svg id="identity" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 2h20v20H2z"/>
                </svg>
              </div>
              <div id="text-stack">
                <span id="primary">Standard plan</span>
                <div id="supporting">General purpose</div>
              </div>
            </div>
            <div id="trailing-wrap">
              <svg id="check" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l4 4L19 6" stroke="currentColor"/>
              </svg>
            </div>
          </div>
        </div>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#row')!, 298, 51, 285, 101)
    setRect(document.querySelector('#content')!, 164, 39, 295, 107)
    setRect(document.querySelector('#leading-wrap')!, 20, 20, 295, 117)
    setRect(document.querySelector('#identity')!, 20, 20, 295, 117)
    setRect(document.querySelector('#text-stack')!, 138, 39, 321, 107)
    setRect(document.querySelector('#primary')!, 138, 20, 321, 107)
    setRect(document.querySelector('#supporting')!, 138, 17, 321, 127)
    setRect(document.querySelector('#trailing-wrap')!, 16, 16, 557, 119)
    setRect(document.querySelector('#check')!, 16, 16, 557, 119)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('M5 12l4 4L19 6')
    expect(JSON.stringify(icons)).not.toContain('M2 2h20v20H2z')
  })

  it('excludes a leading identity graphic when the selected compound row uses a trailing text action', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <button id="row" aria-selected="true">
          <svg id="identity" viewBox="0 0 24 24" fill="none">
            <path d="M2 2h20v20H2z" stroke="currentColor"/>
          </svg>
          <span id="primary">Standard plan</span>
          <span id="supporting">General purpose</span>
          <span id="action">Selected</span>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#row')!, 360, 52)
    setRect(document.querySelector('#identity')!, 20, 20, 8, 16)
    setRect(document.querySelector('#primary')!, 120, 18, 42, 7)
    setRect(document.querySelector('#supporting')!, 150, 18, 42, 29)
    setRect(document.querySelector('#action')!, 58, 18, 292, 17)

    expect(await collectIcons(document)).toEqual([])
  })

  it('excludes a self-describing entity-card graphic without using a site or product name', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <a id="entity-card" href="/collections/workspace-hub">
          <svg id="entity" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 2h20v20H2z"/>
          </svg>
          <div>
            <span id="entity-primary">Workspace Hub</span>
            <span id="entity-supporting">All things about Workspace Hub</span>
          </div>
        </a>
        <a id="functional-card" href="/sync">
          <svg id="functional" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 12h16"/>
          </svg>
          <div>
            <span id="functional-primary">Sync controls</span>
            <span id="functional-supporting">Manage remote changes</span>
          </div>
        </a>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#entity-card')!, 320, 96)
    setRect(document.querySelector('#entity')!, 24, 24, 16, 36)
    setRect(document.querySelector('#entity-primary')!, 112, 20, 56, 22)
    setRect(document.querySelector('#entity-supporting')!, 220, 18, 56, 50)
    setRect(document.querySelector('#functional-card')!, 320, 96, 0, 120)
    setRect(document.querySelector('#functional')!, 24, 24, 16, 156)
    setRect(document.querySelector('#functional-primary')!, 112, 20, 56, 142)
    setRect(document.querySelector('#functional-supporting')!, 190, 18, 56, 170)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('M4 12h16')
    expect(JSON.stringify(icons)).not.toContain('M2 2h20v20H2z')
  })

  it('keeps self-describing graphics when repeated sibling cards prove a navigation category system', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <div id="category-grid">
          <a id="card-one" href="/collections/3943089-account-area">
            <svg id="icon-one" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 3h20v18H2z"/>
            </svg>
            <div><span id="primary-one">Account area</span><span id="supporting-one">All things about Account area</span></div>
          </a>
          <a id="card-two" href="/collections/6864542-workspace-area">
            <svg id="icon-two" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 4h18v16H3z"/>
            </svg>
            <div><span id="primary-two">Workspace area</span><span id="supporting-two">All things about Workspace area</span></div>
          </a>
          <a id="card-three" href="/collections/9135784-security-area">
            <svg id="icon-three" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 5h16v14H4z"/>
            </svg>
            <div><span id="primary-three">Security area</span><span id="supporting-three">All things about Security area</span></div>
          </a>
        </div>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#category-grid')!, 1024, 320)
    for (const [index, y] of [0, 120, 240].entries()) {
      const number = ['one', 'two', 'three'][index]!
      setRect(document.querySelector(`#card-${number}`)!, 320, 96, 0, y)
      setRect(document.querySelector(`#icon-${number}`)!, 32, 32, 16, y + 32)
      setRect(document.querySelector(`#primary-${number}`)!, 120, 20, 64, y + 20)
      setRect(document.querySelector(`#supporting-${number}`)!, 220, 18, 64, y + 50)
    }

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(3)
    expect(await collectExcludedGraphicIds(document)).toEqual([])
    expect(icons.map(icon => icon.name)).toEqual(expect.arrayContaining([
      'account-area',
      'workspace-area',
      'security-area'
    ]))
    expect(icons.map(icon => icon.vectorSvg)).toEqual(expect.arrayContaining([
      expect.stringContaining('M2 3h20v18H2z'),
      expect.stringContaining('M3 4h18v16H3z'),
      expect.stringContaining('M4 5h16v14H4z')
    ]))
  })

  it('excludes an author graphic payload but keeps a website operation inside the same content block', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <article class="markdown-body">
          <p>Published prose remains available to the typography collector.</p>
          <svg id="payload" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 2h20v20H2z"/>
          </svg>
          <button id="reply" aria-label="Reply">
            <svg id="reply-icon" viewBox="0 0 24 24" fill="none">
              <path d="M20 12H6m0 0 5-5m-5 5 5 5" stroke="currentColor"/>
            </svg>
          </button>
        </article>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#payload')!, 24, 24)
    setRect(document.querySelector('#reply')!, 36, 36, 40)
    setRect(document.querySelector('#reply-icon')!, 20, 20, 48, 8)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.name).toMatch(/^icon-[a-f0-9]{6}$/)
    expect(icons[0]?.nameSource).toBe('geometry')
    expect(icons[0]?.vectorSvg).toContain('M20 12H6')
    expect(JSON.stringify(icons)).not.toContain('M2 2h20v20H2z')
  })

  it('normalizes an explicit monochrome category icon without admitting a self-describing identity card', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <a id="functional-card" href="/collections/billing">
          <span id="functional-tile" style="background:rgb(20,20,20);color:white">
            <svg id="functional" viewBox="0 0 24 24" fill="none">
              <path d="M4 7h16v12H4zM7 4h10" stroke="#fff" stroke-width="2"/>
            </svg>
          </span>
          <span id="functional-primary">Billing help</span>
          <span id="functional-supporting">Manage invoices and receipts</span>
        </a>
        <a id="identity-card" href="/collections/workspace-hub">
          <svg id="identity" viewBox="0 0 24 24" fill="#fff">
            <path d="M2 2h20v20H2z"/>
          </svg>
          <span id="identity-primary">Workspace Hub</span>
          <span id="identity-supporting">All things about Workspace Hub</span>
        </a>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#functional-card')!, 320, 96)
    setRect(document.querySelector('#functional-tile')!, 84, 84)
    setRect(document.querySelector('#functional')!, 32, 32, 26, 26)
    setRect(document.querySelector('#functional-primary')!, 112, 20, 104, 22)
    setRect(document.querySelector('#functional-supporting')!, 200, 18, 104, 50)
    setRect(document.querySelector('#identity-card')!, 320, 96, 0, 120)
    setRect(document.querySelector('#identity')!, 32, 32, 26, 146)
    setRect(document.querySelector('#identity-primary')!, 112, 20, 104, 142)
    setRect(document.querySelector('#identity-supporting')!, 220, 18, 104, 170)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('stroke="currentColor"')
    expect(icons[0]?.vectorSvg).not.toContain('#fff')
    expect(JSON.stringify(icons)).not.toContain('M2 2h20v20H2z')
  })

  it('excludes a clustered set of graphic-only external brand links while keeping a labeled external action', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <footer id="footer">
          <nav id="brand-links">
            <a id="organization" href="/organizations/example" aria-label="Example organization">
              <svg id="organization-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 1h22v22H1z"/>
              </svg>
              <span id="organization-label" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Example organization</span>
            </a>
            <a id="network-one" href="https://network-one.example/example" aria-label="Example on network one">
              <svg id="network-one-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 2h20v20H2z"/>
              </svg>
              <span id="network-one-sr" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">
                <span id="network-one-label">Example on network one</span>
              </span>
            </a>
            <a id="network-two" href="https://network-two.example/example" aria-label="Example on network two">
              <svg id="network-two-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h18v18H3z"/>
              </svg>
              <span id="network-two-label" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Example on network two</span>
            </a>
            <a id="network-three" href="https://network-three.example/example" aria-label="Example on network three">
              <svg id="network-three-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 4h16v16H4z"/>
              </svg>
              <span id="network-three-label" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Example on network three</span>
            </a>
          </nav>
          <a id="documentation" href="https://docs.example.net/guide">
            <span id="documentation-label">Documentation</span>
            <svg id="external-action" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 12h14"/>
            </svg>
          </a>
        </footer>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#footer')!, 640, 120)
    setRect(document.querySelector('#brand-links')!, 240, 32)
    for (const [index, id] of [
      '#organization',
      '#network-one',
      '#network-two',
      '#network-three'
    ].entries()) {
      setRect(document.querySelector(id)!, 24, 24, index * 40, 0)
    }
    for (const [index, id] of [
      '#organization-icon',
      '#network-one-icon',
      '#network-two-icon',
      '#network-three-icon'
    ].entries()) {
      setRect(document.querySelector(id)!, 24, 24, index * 40, 0)
    }
    for (const id of [
      '#organization-label',
      '#network-one-sr',
      '#network-one-label',
      '#network-two-label',
      '#network-three-label'
    ]) {
      setRect(document.querySelector(id)!, 1, 1)
    }
    setRect(document.querySelector('#documentation')!, 160, 32, 0, 64)
    setRect(document.querySelector('#documentation-label')!, 112, 20, 0, 70)
    setRect(document.querySelector('#external-action')!, 24, 24, 128, 68)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.vectorSvg).toContain('M5 12h14')
    expect(JSON.stringify(icons)).not.toContain('M1 1h22v22H1z')
    expect(JSON.stringify(icons)).not.toContain('M4 4h16v16H4z')
  })

  it('excludes titled wordmarks and non-interactive asset strips without naming a company', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <section id="asset-strip">
          <svg id="wordmark-one" viewBox="0 0 120 32">
            <title>Example One</title>
            <path d="M0 0h120v32H0z" fill="currentColor"/>
          </svg>
          <svg id="wordmark-two" viewBox="0 0 96 32">
            <title>Example Two</title>
            <path d="M0 0h96v32H0z" fill="currentColor"/>
          </svg>
          <svg id="wordmark-three" viewBox="0 0 80 32">
            <title>Example Three</title>
            <path d="M0 0h80v32H0z" fill="currentColor"/>
          </svg>
        </section>
        <button aria-label="Open details">
          <svg id="functional-action" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 12h14"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#asset-strip')!, 360, 40)
    setRect(document.querySelector('#wordmark-one')!, 120, 32)
    setRect(document.querySelector('#wordmark-two')!, 96, 32, 132)
    setRect(document.querySelector('#wordmark-three')!, 80, 32, 240)
    setRect(document.querySelector('#functional-action')!, 24, 24, 0, 64)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.name).toMatch(/^icon-[a-f0-9]{6}$/)
    expect(icons[0]?.nameSource).toBe('geometry')
    expect(icons[0]?.vectorSvg).toContain('M5 12h14')
  })

  it('keeps a functional icon but replaces count or date-derived names with its geometry name', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <a aria-label="184.2k stars · latest Jul 29, 2026" href="/metrics">
          <svg id="metric-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>
          </svg>
        </a>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#metric-icon')!, 24, 24)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.nameSource).toBe('geometry')
    expect(icons[0]?.name).toMatch(/^icon-[0-9a-f]{6}$/)
  })

  it('keeps a functional glyph but never derives its name from an embedded entity path', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <button aria-label="Star acme-labs/widget-kit">
          <svg id="star-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#star-icon')!, 24, 24)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]).toMatchObject({
      name: expect.stringMatching(/^icon-[0-9a-f]{6}$/),
      nameSource: 'geometry'
    })
    expect(icons[0]?.name).not.toMatch(/acme|widget/i)
    expect(icons[0]?.vectorSvg).toContain('M12 2l3 6')
  })

  it('never serializes a control aria-label as icon naming evidence', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <button aria-label="Open details">
          <svg id="details-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 12h14"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#details-icon')!, 24, 24)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]).toMatchObject({
      name: expect.stringMatching(/^icon-[0-9a-f]{6}$/),
      nameSource: 'geometry'
    })
    expect(JSON.stringify(icons)).not.toMatch(/open[- ]details/i)
  })

  it('excludes a named site mark while keeping a functional question-mark icon', async () => {
    const dom = new JSDOM(`
      <body style="background:white;color:black">
        <a href="/" aria-label="Homepage">
          <svg id="site-mark" class="interface-mark-example" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 2h20v20H2z"/>
          </svg>
        </a>
        <button aria-label="Help">
          <svg id="help" class="interface-question-mark-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 18v.01M9 9a3 3 0 1 1 4 2.8c-.7.3-1 1-1 1.7"/>
          </svg>
        </button>
      </body>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#site-mark')!, 24, 24)
    setRect(document.querySelector('#help')!, 24, 24, 40)

    const icons = await collectIcons(document)

    expect(icons).toHaveLength(1)
    expect(icons[0]?.name).toMatch(/^icon-[a-f0-9]{6}$/)
    expect(icons[0]?.nameSource).toBe('geometry')
    expect(icons[0]?.vectorSvg).toContain('M12 18v.01')
  })

  it('rejects cross-origin sprite references instead of approximating them', async () => {
    const dom = new JSDOM(`
      <button aria-label="External icon">
        <svg id="icon" width="20" height="20">
          <use href="https://cdn.example.net/icons.svg#external" fill="currentColor"/>
        </svg>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    setRect(dom.window.document.querySelector('#icon')!, 20, 20)

    expect(await collectIcons(dom.window.document)).toEqual([])
  })
})
