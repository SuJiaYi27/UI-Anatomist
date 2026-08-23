import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  chooseControlSample,
  controlSampleCandidate,
  isLikelyPrivateControlCopy,
  isPrivateControlContext,
  privateControlContextEvidence
} from '../../src/chrome/content/control-sample-text'

function element(markup: string): HTMLElement {
  const dom = new JSDOM(markup, {
    pretendToBeVisual: true,
    url: 'https://example.com/'
  })
  return dom.window.document.body.firstElementChild as HTMLElement
}

describe('controlSampleCandidate', () => {
  it('extracts compact visible button text while excluding graphical children', () => {
    const button = element(
      '<button><svg aria-label="Private asset"></svg><span>  Share  </span></button>'
    )
    expect(controlSampleCandidate(button, 'button')).toEqual({
      value: 'Share',
      source: 'visible-text'
    })
  })

  it('keeps short product-authored interface labels', () => {
    for (const value of ['Create image', 'Search', 'Share', 'New chat']) {
      expect(controlSampleCandidate(
        element(`<button>${value}</button>`),
        'button'
      )).toEqual({
        value,
        source: 'visible-text'
      })
    }
  })

  it('uses authored placeholders without reading input or textarea values', () => {
    const input = element(
      '<input placeholder="Ask anything" value="Private draft">'
    )
    const textarea = element(
      '<textarea placeholder="Message support">Private notes</textarea>'
    )
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => { throw new Error('input value must not be read') }
    })
    Object.defineProperty(textarea, 'value', {
      configurable: true,
      get: () => { throw new Error('textarea value must not be read') }
    })
    expect(controlSampleCandidate(input, 'input')).toEqual({
      value: 'Ask anything',
      source: 'placeholder'
    })
    expect(controlSampleCandidate(textarea, 'textarea')).toEqual({
      value: 'Message support',
      source: 'placeholder'
    })
  })

  it('does not infer text for icon-only or selection controls', () => {
    expect(controlSampleCandidate(
      element('<button aria-label="Open account"><svg></svg></button>'),
      'button'
    )).toBeNull()
    expect(controlSampleCandidate(
      element('<select><option>Private project</option></select>'),
      'select'
    )).toBeNull()
  })

  it('does not serialize clipped screen-reader-only button text', () => {
    const button = element(`
      <button>
        <svg aria-hidden="true"></svg>
        <span style="
          position:absolute;width:1px;height:1px;overflow:hidden;
          clip:rect(0 0 0 0);clip-path:inset(50%)
        ">Settings</span>
      </button>
    `)
    const label = button.querySelector<HTMLElement>('span')!
    button.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 32, bottom: 32,
      width: 32, height: 32, toJSON: () => ({})
    })
    label.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 1, bottom: 1,
      width: 1, height: 1, toJSON: () => ({})
    })

    expect(controlSampleCandidate(button, 'button')).toBeNull()
  })

  it('keeps ordinary rendered text when clip-path does not remove its pixels', () => {
    const button = element(`
      <button>
        <span style="clip-path:inset(0)">Settings</span>
      </button>
    `)
    const label = button.querySelector<HTMLElement>('span')!
    label.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 56, bottom: 20,
      width: 56, height: 20, toJSON: () => ({})
    })

    expect(controlSampleCandidate(button, 'button')).toEqual({
      value: 'Settings',
      source: 'visible-text'
    })
  })

  it.each([
    'inset(100%)',
    'inset(50% 0 50% 0)',
    'circle(0)',
    'ellipse(0 0)'
  ])('does not serialize text fully removed by clip-path %s', clipPath => {
    const button = element(`
      <button>
        <span style="clip-path:${clipPath}">Settings</span>
      </button>
    `)
    const label = button.querySelector<HTMLElement>('span')!
    label.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 56, bottom: 20,
      width: 56, height: 20, toJSON: () => ({})
    })

    expect(controlSampleCandidate(button, 'button')).toBeNull()
  })

  it.each([
    ['a visible keyword-colored shadow', 'black', true],
    ['a transparent currentColor shadow', 'currentColor', false]
  ])('treats transparent glyphs with %s according to their rendered shadow', (
    _case,
    shadowColor,
    visible
  ) => {
    const button = element(`
      <button>
        <span style="color:transparent;text-shadow:0 0 2px ${shadowColor}">
          Settings
        </span>
      </button>
    `)
    const label = button.querySelector<HTMLElement>('span')!
    label.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 56, bottom: 20,
      width: 56, height: 20, toJSON: () => ({})
    })

    expect(controlSampleCandidate(button, 'button')).toEqual(visible
      ? { value: 'Settings', source: 'visible-text' }
      : null)
  })

  it.each([
    ['offscreen', 'position:absolute;left:-10000px', -10000],
    ['zero-sized glyphs', 'font-size:0', 0],
    ['transparent glyphs', 'color:transparent', 0]
  ])('does not serialize %s button text', (_case, style, x) => {
    const button = element(`
      <button style="width:32px;height:32px">
        <svg aria-hidden="true"></svg>
        <span style="${style}">Settings</span>
      </button>
    `)
    const label = button.querySelector<HTMLElement>('span')!
    button.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 32, bottom: 32,
      width: 32, height: 32, toJSON: () => ({})
    })
    label.getBoundingClientRect = () => ({
      x, y: 0, top: 0, left: x, right: x + 56, bottom: 20,
      width: 56, height: 20, toJSON: () => ({})
    })

    expect(controlSampleCandidate(button, 'button')).toBeNull()
  })

  it('does not serialize a contextualized current value from a disclosure button', () => {
    expect(controlSampleCandidate(
      element(
        '<button aria-haspopup="true" aria-label="stable tag">stable</button>'
      ),
      'button'
    )).toBeNull()
    expect(controlSampleCandidate(
      element(
        '<button aria-haspopup="menu" aria-label="Open tools">Tools</button>'
      ),
      'button'
    )).toEqual({
      value: 'Tools',
      source: 'visible-text'
    })
  })

  it('does not serialize the current option from option-like menu roles', () => {
    for (const markup of [
      '<div role="option" aria-selected="true">stable</div>',
      '<div role="menuitemradio" aria-checked="true">stable</div>',
      '<div role="menuitemcheckbox" aria-checked="true">stable</div>'
    ]) {
      expect(controlSampleCandidate(element(markup), 'button')).toBeNull()
    }
  })

  it.each([
    'person@example.com',
    'https://example.com/private',
    '+86 138 0013 8000',
    'Order 12345678',
    'First line\nSecond line',
    'This sentence is deliberately longer than thirty two Unicode characters.'
  ])('rejects unsafe or identifying candidate %j', value => {
    expect(controlSampleCandidate(
      element(`<button>${value}</button>`),
      'button'
    )).toBeNull()
  })

  it('rejects controls inside editable, message, profile and account contexts', () => {
    for (const markup of [
      '<div contenteditable="true"><button>Save</button></div>',
      '<article data-message-author-role="user"><button>Private title</button></article>',
      '<div data-testid="profile-menu"><button>Personal name</button></div>',
      '<section aria-label="Account"><button>Personal name</button></section>'
    ]) {
      const root = element(markup)
      const button = root.matches('button') ? root : root.querySelector('button')!
      expect(controlSampleCandidate(button, 'button')).toBeNull()
    }
  })

  it('rejects conversation, history, project-instance and document titles', () => {
    for (const markup of [
      '<li data-testid="conversation-title"><button>Holiday plans</button></li>',
      '<li data-testid="chat-title"><button>Interview notes</button></li>',
      '<li data-testid="history-item"><button>Previous session</button></li>',
      '<section data-testid="project-item"><button>Private project</button></section>',
      '<section data-testid="document-title"><button>Private document</button></section>'
    ]) {
      const root = element(markup)
      expect(controlSampleCandidate(root.querySelector('button')!, 'button')).toBeNull()
    }
  })

  it('rejects a user entity row whose sibling actions repeat the entity label', () => {
    const root = element(`
      <div id="entity-row">
        <div>
          <button id="entity">AI穿搭</button>
          <button aria-label="Open project home"></button>
        </div>
        <button aria-label="Open project options for AI穿搭"></button>
      </div>
    `)
    root.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 36,
      width: 240, height: 36, toJSON: () => ({})
    })
    expect(controlSampleCandidate(
      root.querySelector<HTMLElement>('#entity')!,
      'button'
    )).toBeNull()
  })

  it('rejects an entity row when only one independent options action is rendered', () => {
    const root = element(`
      <div id="entity-row">
        <div id="entity" role="button" tabindex="0">Private workspace</div>
        <button aria-label="Open options for Private workspace"></button>
      </div>
    `)
    root.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 36,
      width: 240, height: 36, toJSON: () => ({})
    })
    expect(controlSampleCandidate(
      root.querySelector<HTMLElement>('#entity')!,
      'button'
    )).toBeNull()
  })

  it('rejects an entity row when an independent action is nested inside the main role button', () => {
    const root = element(`
      <div id="entity-row">
        <div id="entity" role="button" tabindex="0">
          <span>AI穿搭</span>
          <button aria-label="Open project home"></button>
        </div>
        <button aria-label="Open project options for AI穿搭"></button>
      </div>
    `)
    root.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 245, bottom: 36,
      width: 245, height: 36, toJSON: () => ({})
    })
    expect(controlSampleCandidate(
      root.querySelector<HTMLElement>('#entity')!,
      'button'
    )).toBeNull()
  })

  it('keeps a product suggestion with only one related dismiss action', () => {
    const root = element(`
      <section id="suggestions">
        <div>
          <button id="command">Create image</button>
          <button aria-label="Dismiss Create image"></button>
        </div>
        <div>
          <button>Write or edit</button>
          <button aria-label="Dismiss Write or edit"></button>
        </div>
        <div>
          <button>Look something up</button>
          <button aria-label="Dismiss Look something up"></button>
        </div>
      </section>
    `)
    root.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 180,
      width: 240, height: 180, toJSON: () => ({})
    })
    expect(controlSampleCandidate(
      root.querySelector<HTMLElement>('#command')!,
      'button'
    )).toEqual({
      value: 'Create image',
      source: 'visible-text'
    })
  })

  it('skips private descendant subtrees nested inside an otherwise safe button', () => {
    const button = element(`
      <button>
        Share
        <span contenteditable="true">Private draft</span>
        <span data-testid="profile-name">Personal name</span>
      </button>
    `)
    expect(controlSampleCandidate(button, 'button')).toEqual({
      value: 'Share',
      source: 'visible-text'
    })
  })

  it.each([
    'example.com/private',
    'acct_9f3a2b1c4d5e',
    'feature-stash',
    'person-name/private-branch',
    'personname/privateBranch',
    'v0.3.11',
    'Wait... really?!'
  ])('rejects domain, identifier or punctuation-dense candidate %j', value => {
    expect(controlSampleCandidate(
      element(`<button>${value}</button>`),
      'button'
    )).toBeNull()
  })

  it('keeps a human-readable slash label that is not path-shaped data', () => {
    expect(controlSampleCandidate(
      element('<button>Light/Dark</button>'),
      'button'
    )).toEqual({
      value: 'Light/Dark',
      source: 'visible-text'
    })
  })

  it('uses a deterministic source rank and code-point lexical tie break', () => {
    expect(chooseControlSample([
      { value: 'Zulu', source: 'placeholder', occurrences: 2 },
      { value: 'Beta', source: 'visible-text', occurrences: 2 }
    ])).toEqual({ value: 'Beta', source: 'visible-text' })
    expect(chooseControlSample([
      { value: 'Zulu', source: 'visible-text', occurrences: 2 },
      { value: 'Alpha', source: 'visible-text', occurrences: 2 }
    ])).toEqual({ value: 'Alpha', source: 'visible-text' })
  })

  it('normalizes repeated whitespace and supports short Chinese labels', () => {
    expect(controlSampleCandidate(
      element('<button><span>  分享 </span><span> 对话 </span></button>'),
      'button'
    )).toEqual({
      value: '分享 对话',
      source: 'visible-text'
    })
  })

  it('treats IP and location metadata as private while keeping product settings labels', () => {
    expect(isLikelyPrivateControlCopy(['根据 IP 地址确定'])).toBe(true)
    expect(isLikelyPrivateControlCopy(['Update location'])).toBe(true)
    expect(isLikelyPrivateControlCopy(['Theme'])).toBe(false)
    expect(isLikelyPrivateControlCopy(['Help'])).toBe(false)
  })

  it('rejects a compact location cluster without treating the whole settings panel as private', () => {
    const root = element(`
      <div id="location-row">
        <button id="city">台湾台北市</button>
        <span>根据 IP 地址确定</span>
        <button id="update">更新位置信息</button>
      </div>
    `)
    root.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 240,
      bottom: 96,
      width: 240,
      height: 96,
      toJSON: () => ({})
    })

    expect(controlSampleCandidate(root.querySelector('#city')!, 'button')).toBeNull()
    expect(controlSampleCandidate(root.querySelector('#update')!, 'button')).toBeNull()
    expect(controlSampleCandidate(element('<button>Theme</button>'), 'button')).toEqual({
      value: 'Theme',
      source: 'visible-text'
    })
  })

  it.each([
    {
      name: 'opaque path',
      reason: 'opaquePath' as const,
      create: () => element('<a href="/0123456789abcdef"><button>Safe label</button></a>').querySelector('button')!
    },
    {
      name: 'entity action cluster',
      reason: 'entityCluster' as const,
      create: () => {
        const root = element(`
          <div><div><button id="entity">Shared workspace</button><button aria-label="Open workspace"></button></div>
          <button aria-label="Open workspace options for Shared workspace"></button></div>
        `)
        root.getBoundingClientRect = () => ({
          x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 36,
          width: 240, height: 36, toJSON: () => ({})
        })
        return root.querySelector<HTMLElement>('#entity')!
      }
    },
    {
      name: 'location cluster',
      reason: 'locationCluster' as const,
      create: () => {
        const root = element('<div><button id="city">Example city</button><span>based on your IP address</span></div>')
        root.getBoundingClientRect = () => ({
          x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 96,
          width: 240, height: 96, toJSON: () => ({})
        })
        return root.querySelector<HTMLElement>('#city')!
      }
    },
    {
      name: 'fail-closed exception',
      reason: 'exception' as const,
      create: () => {
        const candidate = element('<button>Safe label</button>')
        candidate.closest = () => { throw new Error('diagnostic fixture failure') }
        return candidate
      }
    }
  ])('keeps the legacy private-context block while reporting anonymous %s provenance', ({ reason, create }) => {
    const candidate = create()
    const evidence = privateControlContextEvidence(candidate)

    expect(evidence.blocked).toBe(true)
    expect(isPrivateControlContext(candidate)).toBe(evidence.blocked)
    expect(evidence.reasons[reason]).toBe(true)
    expect(JSON.stringify({ blocked: evidence.blocked, reasons: evidence.reasons }))
      .not.toContain('Safe label')
  })
})
