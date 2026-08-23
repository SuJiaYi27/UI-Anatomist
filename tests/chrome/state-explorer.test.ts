import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  createReversibleStateSession,
  exploreReversibleStates,
  TRANSIENT_STRUCTURE_ATTRIBUTE
} from '../../src/chrome/content/state-explorer'

function page(html: string): JSDOM {
  return new JSDOM(html, {
    pretendToBeVisual: true,
    url: 'https://example.com/projects'
  })
}

describe('exploreReversibleStates', () => {
  it('actively samples and restores an ARIA menu', async () => {
    const dom = page(`
      <button id="open" aria-haspopup="menu" aria-expanded="false">Menu</button>
      <div id="menu" role="menu" hidden><button>View details</button></div>
    `)
    const { document } = dom.window
    const trigger = document.querySelector<HTMLButtonElement>('#open')!
    const menu = document.querySelector<HTMLElement>('#menu')!
    let clicks = 0
    trigger.addEventListener('click', () => {
      clicks += 1
      const opening = menu.hidden
      menu.hidden = !opening
      trigger.setAttribute('aria-expanded', String(opening))
    })

    const snapshots = await exploreReversibleStates(document, async () => ({
      structure: menu.getAttribute(TRANSIENT_STRUCTURE_ATTRIBUTE)
    }))

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.structure).toBe('true')
    expect(clicks).toBe(2)
    expect(menu.hidden).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector(`[${TRANSIENT_STRUCTURE_ATTRIBUTE}]`)).toBeNull()
  })

  it('claims an asynchronous portal after settlement and restores it', async () => {
    const dom = page('<button id="open">Open search</button>')
    const { document } = dom.window
    const trigger = document.querySelector<HTMLButtonElement>('#open')!
    let open = false
    let clicks = 0
    trigger.addEventListener('click', () => {
      clicks += 1
      dom.window.queueMicrotask(() => {
        open = !open
        document.querySelector('#portal')?.remove()
        if (!open) return
        const portal = document.createElement('div')
        portal.id = 'portal'
        portal.setAttribute('role', 'dialog')
        portal.textContent = 'Search'
        document.body.appendChild(portal)
      })
    })

    expect(await exploreReversibleStates(document, async () =>
      document.querySelector('#portal')?.getAttribute(TRANSIENT_STRUCTURE_ATTRIBUTE)
    )).toEqual(['true'])
    expect(clicks).toBe(2)
    expect(open).toBe(false)
    expect(document.querySelector('#portal')).toBeNull()
  })

  it('does not activate an ordinary button without structural evidence', async () => {
    const dom = page('<button id="plain">Preview</button>')
    const { document } = dom.window
    let clicks = 0
    document.querySelector('#plain')?.addEventListener('click', () => { clicks += 1 })

    expect(await exploreReversibleStates(document, async () => true)).toEqual([])
    expect(clicks).toBe(0)
  })

  it('uses one pointer mode for a pointer-only custom disclosure and reuses it for restore', async () => {
    const dom = page('<div id="open" role="button" aria-haspopup="menu" aria-expanded="false">Menu</div>')
    const { document } = dom.window
    const trigger = document.querySelector<HTMLElement>('#open')!
    let clickAttempts = 0
    let pointerPresses = 0
    trigger.addEventListener('click', () => { clickAttempts += 1 })
    trigger.addEventListener('pointerdown', () => {
      pointerPresses += 1
      const existing = document.querySelector('[role="menu"]')
      existing?.remove()
      if (existing) {
        trigger.setAttribute('aria-expanded', 'false')
        return
      }
      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      document.body.appendChild(menu)
      trigger.setAttribute('aria-expanded', 'true')
    })

    expect(await exploreReversibleStates(document, async () =>
      document.querySelectorAll('[role="menu"]').length
    )).toEqual([1])
    expect(clickAttempts).toBe(1)
    expect(pointerPresses).toBe(2)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('allows a structural Add-file parent but blocks the native file target it invokes', async () => {
    const dom = page(`
      <button id="add" aria-haspopup="menu">Add file</button>
      <input id="file" type="file" hidden>
    `)
    const { document } = dom.window
    let openerClicks = 0
    let fileClicks = 0
    const input = document.querySelector<HTMLInputElement>('#file')!
    input.addEventListener('click', () => { fileClicks += 1 })
    document.querySelector('#add')?.addEventListener('click', () => {
      openerClicks += 1
      input.click()
    })

    expect(await exploreReversibleStates(document, async () => true)).toEqual([true])
    expect(openerClicks).toBe(1)
    expect(fileClicks).toBe(0)
  })

  it.each([
    'Save changes',
    'Delete project',
    'Purchase',
    'Sign out',
    'Authorize',
    'Download',
    'Star'
  ])('does not activate the explicit dangerous action %s', async label => {
    const dom = page(`<button>${label}</button>`)
    let clicks = 0
    dom.window.document.querySelector('button')?.addEventListener('click', () => {
      clicks += 1
    })
    expect(await exploreReversibleStates(dom.window.document, async () => true)).toEqual([])
    expect(clicks).toBe(0)
  })

  it('deduplicates the same interaction family across a shared session', async () => {
    const session = createReversibleStateSession()
    const first = page(`
      <button aria-haspopup="menu" aria-expanded="false">Menu</button>
      <div role="menu" hidden></div>
    `)
    const second = page(`
      <button aria-haspopup="menu" aria-expanded="false">Menu</button>
      <div role="menu" hidden></div>
    `)
    for (const dom of [first, second]) {
      const trigger = dom.window.document.querySelector<HTMLButtonElement>('button')!
      const menu = dom.window.document.querySelector<HTMLElement>('[role="menu"]')!
      trigger.addEventListener('click', () => {
        menu.hidden = !menu.hidden
        trigger.setAttribute('aria-expanded', String(!menu.hidden))
      })
    }

    expect(await exploreReversibleStates(first.window.document, async () => true, session))
      .toEqual([true])
    expect(await exploreReversibleStates(second.window.document, async () => true, session))
      .toEqual([])
  })
})
