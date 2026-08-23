import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  createHoverStateSession,
  exploreHoverStates,
  HOVER_PROBE_ATTRIBUTE,
  HOVER_TARGET_ATTRIBUTE
} from '../../src/chrome/content/hover-state-explorer'

function rect(width = 32, height = 32): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({})
  } as DOMRect
}

function page(html: string): JSDOM {
  return new JSDOM(html, {
    pretendToBeVisual: true,
    url: 'https://example.com/app'
  })
}

describe('exploreHoverStates P3 behavior', () => {
  it('samples a reversible event-driven hover surface and restores it', async () => {
    const dom = page('<button id="target">Menu</button>')
    const { document } = dom.window
    const button = document.querySelector<HTMLButtonElement>('#target')!
    button.getBoundingClientRect = () => rect()
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = 'rgb(0, 0, 0)'
    })
    button.addEventListener('mouseleave', () => {
      button.style.removeProperty('background-color')
    })

    const snapshots = await exploreHoverStates(document, async () => ({
      target: button.hasAttribute(HOVER_TARGET_ATTRIBUTE),
      background: button.style.backgroundColor
    }))

    expect(snapshots).toEqual([{
      target: true,
      background: 'rgb(0, 0, 0)'
    }])
    expect(button.style.backgroundColor).toBe('')
    expect(document.querySelector(`[${HOVER_TARGET_ATTRIBUTE}]`)).toBeNull()
    expect(document.querySelector(`[${HOVER_PROBE_ATTRIBUTE}]`)).toBeNull()
  })

  it('does not hover a native file control or its label', async () => {
    const dom = page('<label id="label">Upload<input id="file" type="file"></label>')
    const { document } = dom.window
    const label = document.querySelector<HTMLElement>('#label')!
    const file = document.querySelector<HTMLInputElement>('#file')!
    label.getBoundingClientRect = () => rect()
    file.getBoundingClientRect = () => rect()
    let entries = 0
    label.addEventListener('mouseenter', () => { entries += 1 })
    file.addEventListener('mouseenter', () => { entries += 1 })

    expect(await exploreHoverStates(document, async () => 'sample')).toEqual([])
    expect(entries).toBe(0)
  })

  it('samples one representative per structural family across calls', async () => {
    const dom = page('<button class="tool">Menu</button>')
    const { document } = dom.window
    const button = document.querySelector<HTMLButtonElement>('button')!
    button.getBoundingClientRect = () => rect()
    button.addEventListener('mouseenter', () => {
      button.style.color = 'rgb(255, 0, 0)'
    })
    button.addEventListener('mouseleave', () => button.style.removeProperty('color'))
    const session = createHoverStateSession()

    expect(await exploreHoverStates(document, async () => 'sample', session)).toEqual(['sample'])
    expect(await exploreHoverStates(document, async () => 'sample', session)).toEqual([])
  })
})
