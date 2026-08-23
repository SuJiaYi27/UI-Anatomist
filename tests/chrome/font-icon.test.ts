import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isFontIconCandidate,
  sanitizeFontIcon
} from '../../src/chrome/content/font-icon'

function fixtureBytes(): Uint8Array {
  // Google Material Symbols is Apache-2.0 licensed. This official Google Fonts
  // subset contains only the neutral "settings" ligature and no brand asset.
  const base64 = readFileSync(
    'tests/fixtures/font-icon-ligature.woff2.base64',
    'utf8'
  ).trim()
  return Uint8Array.from(Buffer.from(base64, 'base64'))
}

function setRect(element: Element, width = 24, height = 24): void {
  ;(element as HTMLElement).getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({})
  })
}

describe('font icon extraction', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requires direct icon evidence instead of treating ordinary styled text as a glyph', () => {
    const dom = new JSDOM(`
      <span id="icon" data-mat-icon-type="font" data-mat-icon-name="settings"
        style="font-family:'Material Symbols Outlined';display:inline-block">settings</span>
      <span id="text" style="font-family:'Material Symbols Outlined'">settings</span>
      <span id="nested" data-mat-icon-type="font" style="font-family:'Material Symbols Outlined'">
        <strong>private user sentence</strong>
      </span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    for (const node of document.querySelectorAll('span')) setRect(node)

    const view = dom.window as unknown as Window
    expect(isFontIconCandidate(document.querySelector('#icon')!, view)).toBe(true)
    expect(isFontIconCandidate(document.querySelector('#text')!, view)).toBe(false)
    expect(isFontIconCandidate(document.querySelector('#nested')!, view)).toBe(false)
  })

  it('accepts generic icon semantics with an icon-like computed font', () => {
    const dom = new JSDOM(`
      <span id="icon" role="img"
        style="font-family:'Interface Symbols';display:inline-block">settings</span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)

    expect(isFontIconCandidate(icon, dom.window as unknown as Window)).toBe(true)
  })

  it('accepts a rendered ligature custom element without role or vendor metadata', () => {
    const dom = new JSDOM(`
      <mat-icon id="icon" aria-hidden="true"
        class="notranslate interface-symbols ligature-font"
        style="font-family:'Interface Symbols';display:inline-block">settings</mat-icon>
      <span id="copy" class="symbol-description"
        style="font-family:Arial">settings</span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    const copy = dom.window.document.querySelector('#copy')!
    setRect(icon)
    setRect(copy, 80, 24)

    expect(isFontIconCandidate(icon, dom.window as unknown as Window)).toBe(true)
    expect(isFontIconCandidate(copy, dom.window as unknown as Window)).toBe(false)
  })

  it('lays out a WOFF2 ligature and returns only a sanitized vector outline', async () => {
    const dom = new JSDOM(`
      <button aria-label="Settings">
        <span id="icon" data-mat-icon-type="font" data-mat-icon-name="settings"
          style="font-family:'Material Symbols Outlined';display:inline-block">settings</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)

    const vector = await sanitizeFontIcon(icon, dom.window as unknown as Window, {
      loadFontResources: async () => [fixtureBytes()]
    })

    expect(vector).toMatchObject({
      viewBox: {
        minX: 78,
        minY: -880,
        width: 804,
        height: 800
      }
    })
    expect(vector?.vectorSvg).toMatch(/^<svg\b/)
    expect(vector?.vectorSvg).toContain('<path')
    expect(vector?.vectorSvg).toContain('fill="currentColor"')
    expect(vector?.vectorSvg).not.toContain('settings')
    expect(JSON.stringify(vector)).not.toContain('Material Symbols')
  })

  it('applies an observed variation to a transformed WOFF2 glyph instead of dropping it', async () => {
    const dom = new JSDOM(`
      <mat-icon id="icon" fonticon="settings"
        style="font-family:'Variable Symbols';font-variation-settings:'wght' 300;display:inline-block"></mat-icon>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)

    type TestPoint = {
      x: number
      y: number
      onCurve: boolean
      endContour: boolean
      copy: () => TestPoint
    }
    const point = (
      x: number,
      y: number,
      endContour = false
    ): TestPoint => ({
      x,
      y,
      onCurve: true,
      endContour,
      copy: () => point(x, y, endContour)
    })
    const glyphData = {
      numberOfContours: 1,
      points: [
        point(10, 10),
        point(30, 10),
        point(30, 30),
        point(10, 30, true)
      ]
    }
    let variationApplied = false
    const fakeFont = {
      type: 'WOFF2',
      familyName: 'Variable Symbols',
      fullName: 'Variable Symbols Regular',
      postscriptName: 'VariableSymbols-Regular',
      variationAxes: {
        wght: { name: 'Weight', min: 100, default: 400, max: 700 }
      },
      fvar: {
        axis: [{
          axisTag: 'wght',
          minValue: 100,
          defaultValue: 400,
          maxValue: 700
        }]
      },
      directory: {
        tables: {
          glyf: { transformed: true },
          gvar: {}
        }
      },
      variationCoords: null as number[] | null,
      _glyphs: {} as Record<number, unknown>,
      _transformedGlyphs: {
        1: glyphData
      } as Record<number, typeof glyphData>,
      get _variationProcessor() {
        return {
          transformPoints: (_glyphId: number, points: TestPoint[]) => {
            variationApplied = true
            for (const current of points.slice(0, 4)) current.x += 10
          }
        }
      },
      getVariation: () => {
        throw new TypeError('transformed WOFF2 variation layout is unavailable')
      },
      layout: () => ({
        glyphs: [{ id: 1 }]
      }),
      getGlyph: () => {
        const points = fakeFont._transformedGlyphs[1]!.points
        const xs = points.map(current => current.x)
        const ys = points.map(current => current.y)
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        const maxX = Math.max(...xs)
        const maxY = Math.max(...ys)
        return {
          id: 1,
          path: {
            bbox: {
              minX,
              minY,
              maxX,
              maxY,
              width: maxX - minX,
              height: maxY - minY
            },
            toSVG: () =>
              `M${points[0]!.x} ${points[0]!.y}` +
              `L${points[1]!.x} ${points[1]!.y}` +
              `L${points[2]!.x} ${points[2]!.y}` +
              `L${points[3]!.x} ${points[3]!.y}Z`
          }
        }
      }
    }

    const vector = await sanitizeFontIcon(
      icon,
      dom.window as unknown as Window,
      {
        loadFontResources: async () => [new Uint8Array([9, 9, 9])],
        createFont: () => fakeFont
      } as unknown as Parameters<typeof sanitizeFontIcon>[2]
    )

    expect(variationApplied).toBe(true)
    expect(vector?.viewBox).toEqual({
      minX: 20,
      minY: -30,
      width: 20,
      height: 20
    })
    expect(vector?.vectorSvg).toContain('<path')
  })

  it('keeps an explicitly identified font icon that is only aria-hidden', async () => {
    const dom = new JSDOM(`
      <button aria-label="Settings">
        <span id="icon" aria-hidden="true"
          data-mat-icon-type="font" data-mat-icon-name="settings"
          style="font-family:'Material Symbols Outlined';display:inline-block">settings</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)

    const vector = await sanitizeFontIcon(
      icon,
      dom.window as unknown as Window,
      { loadFontResources: async () => [fixtureBytes()] }
    )

    expect(vector?.vectorSvg).toContain('<path')
    expect(vector?.vectorSvg).not.toContain('settings')
  })

  it('returns no approximation when the loaded font is unavailable or invalid', async () => {
    const dom = new JSDOM(`
      <span id="icon" data-icon-type="font"
        style="font-family:'Interface Symbols';display:inline-block">settings</span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)

    expect(await sanitizeFontIcon(icon, dom.window as unknown as Window, {
      loadFontResources: async () => []
    })).toBeNull()
    expect(await sanitizeFontIcon(icon, dom.window as unknown as Window, {
      loadFontResources: async () => [new Uint8Array([1, 2, 3])]
    })).toBeNull()
  })

  it('accepts a uniquely matching ligature when CSS aliases the font family', async () => {
    const dom = new JSDOM(`
      <span id="icon" data-icon-type="font" data-icon-name="settings"
        style="font-family:'Interface Symbols';display:inline-block">settings</span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)

    const vector = await sanitizeFontIcon(icon, dom.window as unknown as Window, {
      loadFontResources: async () => [fixtureBytes()]
    })

    expect(vector?.vectorSvg).toContain('<path')
    expect(vector?.vectorSvg).not.toContain('settings')
  })

  it('loads an extensionless font resource initiated by CSS', async () => {
    const dom = new JSDOM(`
      <span id="icon" data-icon-type="font" data-icon-name="settings"
        style="font-family:'Interface Symbols';display:inline-block">settings</span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)
    Object.defineProperty(dom.window.performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{
        name: 'https://cdn.example.com/assets/opaque-resource-id',
        initiatorType: 'css'
      }]
    })
    Object.defineProperty(dom.window, 'fetch', {
      configurable: true,
      value: async () => {
        const bytes = fixtureBytes()
        const body = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
        return new Response(body, {
          status: 200,
          headers: { 'content-length': String(bytes.length) }
        })
      }
    })

    const vector = await sanitizeFontIcon(icon, dom.window as unknown as Window)

    expect(vector?.vectorSvg).toContain('<path')
  })

  it('stops waiting for an unresponsive observed font resource', async () => {
    vi.useFakeTimers()
    const dom = new JSDOM(`
      <span id="icon" data-icon-type="font" data-icon-name="settings"
        style="font-family:'Interface Symbols';display:inline-block">settings</span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)
    Object.defineProperty(dom.window.performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{
        name: 'https://cdn.example.com/assets/unresponsive-font-resource',
        initiatorType: 'css'
      }]
    })
    Object.defineProperty(dom.window, 'fetch', {
      configurable: true,
      value: () => new Promise<Response>(() => {})
    })

    const extraction = sanitizeFontIcon(
      icon,
      dom.window as unknown as Window
    ).then(value => ({ kind: 'result' as const, value }))
    const watchdog = new Promise<{ kind: 'watchdog' }>(resolve => {
      setTimeout(() => resolve({ kind: 'watchdog' }), 6_000)
    })

    await vi.advanceTimersByTimeAsync(6_000)

    await expect(Promise.race([extraction, watchdog])).resolves.toEqual({
      kind: 'result',
      value: null
    })
  })

  it('stops waiting when a font response body never finishes', async () => {
    vi.useFakeTimers()
    const dom = new JSDOM(`
      <span id="icon" data-icon-type="font" data-icon-name="settings"
        style="font-family:'Interface Symbols';display:inline-block">settings</span>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const icon = dom.window.document.querySelector('#icon')!
    setRect(icon)
    Object.defineProperty(dom.window.performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{
        name: 'https://cdn.example.com/assets/unresponsive-font-body',
        initiatorType: 'css'
      }]
    })
    Object.defineProperty(dom.window, 'fetch', {
      configurable: true,
      value: async () => ({
        ok: true,
        headers: new Headers({ 'content-length': '1024' }),
        arrayBuffer: () => new Promise<ArrayBuffer>(() => {})
      } as Response)
    })

    const extraction = sanitizeFontIcon(
      icon,
      dom.window as unknown as Window
    ).then(value => ({ kind: 'result' as const, value }))
    const watchdog = new Promise<{ kind: 'watchdog' }>(resolve => {
      setTimeout(() => resolve({ kind: 'watchdog' }), 6_000)
    })

    await vi.advanceTimersByTimeAsync(6_000)

    await expect(Promise.race([extraction, watchdog])).resolves.toEqual({
      kind: 'result',
      value: null
    })
  })
})
