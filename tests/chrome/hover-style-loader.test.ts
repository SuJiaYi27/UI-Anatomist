import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import {
  HOVER_PROBE_ATTRIBUTE,
  installHoverStyle
} from '../../src/chrome/content/hover-style-loader'

type SheetStub = {
  href: string | null
  cssRules: ArrayLike<CSSRule>
}

function blockedSheet(href: string): SheetStub {
  const sheet = { href } as SheetStub
  Object.defineProperty(sheet, 'cssRules', {
    get() { throw new DOMException('Blocked', 'SecurityError') }
  })
  return sheet
}

function setSheets(document: Document, sheets: SheetStub[]): void {
  Object.defineProperty(document, 'styleSheets', {
    configurable: true,
    value: sheets
  })
}

describe('installHoverStyle', () => {
  it('fetches a blocked loaded stylesheet once and keeps only safe hover rules', async () => {
    const dom = new JSDOM('<button class="tool">Choice</button>', {
      url: 'https://example.com/'
    })
    const href = 'https://cdn.example.com/app.css'
    setSheets(dom.window.document, [blockedSheet(href), blockedSheet(href)])
    const fetchCss = vi.fn(async () => ({
      ok: true,
      text: async () => [
        '@import url("https://cdn.example.com/imported.css");',
        '.ordinary { color: red }',
        '.remote:hover { background-image: url("https://cdn.example.com/image.png") }',
        '@media (hover:hover) { .tool:hover { background: rgb(238, 238, 238); border-radius: 12px } }'
      ].join('\n')
    }))

    const style = await installHoverStyle(dom.window.document, { fetchCss })

    expect(fetchCss).toHaveBeenCalledTimes(1)
    expect(fetchCss).toHaveBeenCalledWith(href, expect.objectContaining({
      credentials: 'omit',
      signal: expect.any(AbortSignal)
    }))
    expect(style?.textContent).toContain(
      `.tool[${HOVER_PROBE_ATTRIBUTE}="true"]`
    )
    expect(style?.textContent).toContain('@media (hover:hover)')
    expect(style?.textContent).not.toContain('@import')
    expect(style?.textContent).not.toContain('.ordinary')
    expect(style?.textContent).not.toContain('.remote')
  })

  it('runs at most four external stylesheet requests at once', async () => {
    const dom = new JSDOM('<button>Choice</button>', {
      url: 'https://example.com/'
    })
    setSheets(dom.window.document, Array.from({ length: 6 }, (_, index) =>
      blockedSheet(`https://cdn.example.com/${index}.css`)
    ))
    let active = 0
    let maximum = 0
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const fetchCss = vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await gate
      active -= 1
      return {
        ok: true,
        text: async () => '.tool:hover { color: red }'
      }
    })

    const pending = installHoverStyle(dom.window.document, { fetchCss })
    await vi.waitFor(() => expect(fetchCss).toHaveBeenCalledTimes(4))
    expect(maximum).toBe(4)
    release()
    await pending

    expect(fetchCss).toHaveBeenCalledTimes(6)
    expect(maximum).toBe(4)
  })

  it('aborts unfinished requests at the shared deadline', async () => {
    const dom = new JSDOM('<button>Choice</button>', {
      url: 'https://example.com/'
    })
    setSheets(dom.window.document, [
      blockedSheet('https://cdn.example.com/slow.css')
    ])
    let aborted = false
    const fetchCss = vi.fn((_url: string, init: RequestInit) =>
      new Promise<{ ok: boolean; text(): Promise<string> }>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    )

    const pending = installHoverStyle(dom.window.document, {
      fetchCss,
      timeoutMs: 10
    })
    const settled = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50))
    ])

    expect(settled).toBe(true)
    expect(aborted).toBe(true)
    expect(await pending).toBeNull()
  })
})
