import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { findPaintedIconSurface } from '../../src/chrome/content/icon-interaction-surface'

function setRect(
  element: Element,
  width: number,
  height: number,
  x = 0,
  y = 0
): void {
  ;(element as HTMLElement).getBoundingClientRect = () => ({
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({})
  })
}

describe('findPaintedIconSurface', () => {
  it('chooses the smallest painted layer containing the icon', () => {
    const dom = new JSDOM(`
      <button id="outer" style="width:36px;height:36px;border-radius:8px;background:transparent">
        <span id="surface" style="display:block;width:32px;height:32px;border-radius:4px;background:rgb(238,238,238)">
          <svg id="icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
        </span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#outer')!, 36, 36)
    setRect(document.querySelector('#surface')!, 32, 32, 2, 2)
    setRect(document.querySelector('#icon')!, 24, 24, 6, 6)

    expect(findPaintedIconSurface(
      document.querySelector('#icon')!,
      dom.window as unknown as Window
    )).toMatchObject({
      width: 32,
      height: 32,
      radii: {
        topLeft: 4,
        topRight: 4,
        bottomRight: 4,
        bottomLeft: 4
      }
    })
  })

  it('keeps a visually painted surface that is only aria-hidden', () => {
    const dom = new JSDOM(`
      <button id="outer" style="width:36px;height:36px;border-radius:0;background:rgb(248,248,248)">
        <span id="surface" aria-hidden="true"
          style="display:block;width:32px;height:32px;border-radius:4px;background:rgb(238,238,238)">
          <svg id="icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
        </span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#outer')!, 36, 36)
    setRect(document.querySelector('#surface')!, 32, 32, 2, 2)
    setRect(document.querySelector('#icon')!, 24, 24, 6, 6)

    expect(findPaintedIconSurface(
      document.querySelector('#icon')!,
      dom.window as unknown as Window
    )).toMatchObject({
      width: 32,
      height: 32,
      radii: {
        topLeft: 4,
        topRight: 4,
        bottomRight: 4,
        bottomLeft: 4
      }
    })
  })

  it('keeps an ordinary single-layer icon control', () => {
    const dom = new JSDOM(`
      <button id="outer" style="width:32px;height:32px;border-radius:6px;background:rgb(238,238,238)">
        <svg id="icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#outer')!, 32, 32)
    setRect(document.querySelector('#icon')!, 24, 24, 4, 4)

    expect(findPaintedIconSurface(
      document.querySelector('#icon')!,
      dom.window as unknown as Window
    )).toMatchObject({
      width: 32,
      height: 32,
      radii: {
        topLeft: 6,
        topRight: 6,
        bottomRight: 6,
        bottomLeft: 6
      }
    })
  })

  it('recognizes a painted graphic host as its own tight surface', () => {
    const dom = new JSDOM(`
      <button id="outer" style="width:36px;height:36px;border-radius:0;background:transparent">
        <svg id="icon" viewBox="0 0 20 20" style="background:white;border-radius:50%">
          <path d="M4 10l4 4 8-8"/>
        </svg>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#outer')!, 36, 36)
    setRect(document.querySelector('#icon')!, 20, 20, 8, 8)

    expect(findPaintedIconSurface(
      document.querySelector('#icon')!,
      dom.window as unknown as Window
    )).toMatchObject({
      source: 'element',
      width: 20,
      height: 20,
      radii: {
        topLeft: 10,
        topRight: 10,
        bottomRight: 10,
        bottomLeft: 10
      }
    })
  })

  it('uses a smaller painted pseudo-element instead of the outer hit area', () => {
    const dom = new JSDOM(`
      <button id="outer" style="width:36px;height:36px;border-radius:0;background:rgb(248,248,248)">
        <svg id="icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const outer = document.querySelector('#outer')!
    const icon = document.querySelector('#icon')!
    setRect(outer, 36, 36)
    setRect(icon, 24, 24, 6, 6)

    const getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
    const view = {
      getComputedStyle(element: Element, pseudo?: string) {
        if (element === outer && pseudo === '::before') {
          return {
            content: '""',
            display: 'block',
            visibility: 'visible',
            opacity: '1',
            backgroundColor: 'rgb(238, 238, 238)',
            width: '32px',
            height: '32px',
            left: '2px',
            right: '2px',
            top: '2px',
            bottom: '2px',
            borderRadius: '4px',
            borderTopLeftRadius: '4px',
            borderTopRightRadius: '4px',
            borderBottomRightRadius: '4px',
            borderBottomLeftRadius: '4px'
          } as CSSStyleDeclaration
        }
        if (pseudo) {
          return {
            content: 'none',
            display: 'none',
            visibility: 'hidden',
            opacity: '0',
            backgroundColor: 'transparent'
          } as CSSStyleDeclaration
        }
        return getComputedStyle(element)
      }
    } as unknown as Window

    expect(findPaintedIconSurface(icon, view)).toMatchObject({
      width: 32,
      height: 32,
      radii: {
        topLeft: 4,
        topRight: 4,
        bottomRight: 4,
        bottomLeft: 4
      }
    })
  })

  it('includes a geometrically containing sibling paint layer inside the control', () => {
    const dom = new JSDOM(`
      <button id="outer" style="width:36px;height:36px;border-radius:0;background:rgb(248,248,248)">
        <span id="surface" style="position:absolute;width:32px;height:32px;border-radius:4px;background:rgb(238,238,238)"></span>
        <svg id="icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#outer')!, 36, 36)
    setRect(document.querySelector('#surface')!, 32, 32, 2, 2)
    setRect(document.querySelector('#icon')!, 24, 24, 6, 6)

    expect(findPaintedIconSurface(
      document.querySelector('#icon')!,
      dom.window as unknown as Window
    )).toMatchObject({
      width: 32,
      height: 32,
      radii: {
        topLeft: 4,
        topRight: 4,
        bottomRight: 4,
        bottomLeft: 4
      }
    })
  })

  it('includes a painted sibling layer inside the nearest control wrapper', () => {
    const dom = new JSDOM(`
      <div id="wrapper">
        <span id="surface" style="position:absolute;width:32px;height:32px;border-radius:4px;background:rgb(238,238,238)"></span>
        <button id="outer" style="width:36px;height:36px;border-radius:0;background:rgb(248,248,248)">
          <svg id="icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
        </button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    setRect(document.querySelector('#wrapper')!, 36, 36)
    setRect(document.querySelector('#outer')!, 36, 36)
    setRect(document.querySelector('#surface')!, 32, 32, 2, 2)
    setRect(document.querySelector('#icon')!, 24, 24, 6, 6)

    expect(findPaintedIconSurface(
      document.querySelector('#icon')!,
      dom.window as unknown as Window
    )).toMatchObject({
      width: 32,
      height: 32,
      radii: {
        topLeft: 4,
        topRight: 4,
        bottomRight: 4,
        bottomLeft: 4
      }
    })
  })
})
