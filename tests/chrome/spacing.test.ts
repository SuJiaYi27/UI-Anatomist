import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { collectSpacing, normalizeSpacingPart } from '../../src/chrome/content/spacing'

function visibleRect(width = 240, height = 80): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({})
  }
}

describe('collectSpacing', () => {
  it('collects unique rendered padding, gap and margin evidence', async () => {
    const dom = new JSDOM(`
      <div data-visible style="padding:8px;row-gap:8px;column-gap:8px;margin:8px"></div>
      <div data-visible style="padding:12.34567px 0;gap:16px;margin:0"></div>
    `, { pretendToBeVisual: true })
    dom.window.document.querySelectorAll<HTMLElement>('[data-visible]').forEach(element => {
      element.getBoundingClientRect = visibleRect
    })

    const result = await collectSpacing(dom.window.document)

    expect(result.map(token => ({
      value: token.value,
      occurrences: token.occurrences,
      evidence: token.evidence,
      stateOccurrences: token.stateOccurrences
    }))).toEqual([
      {
        value: 8,
        occurrences: 3,
        evidence: { padding: 1, gap: 1, margin: 1 },
        stateOccurrences: 1
      },
      {
        value: 12.3457,
        occurrences: 1,
        evidence: { padding: 1, gap: 0, margin: 0 },
        stateOccurrences: 1
      },
      {
        value: 16,
        occurrences: 1,
        evidence: { padding: 0, gap: 1, margin: 0 },
        stateOccurrences: 1
      }
    ])
  })

  it('ignores hidden, overlay, visual asset, zero and non-px spacing', async () => {
    const dom = new JSDOM(`
      <div data-visible style="padding:4px"></div>
      <div data-visible hidden style="padding:6px"></div>
      <div data-visible data-smart-scan-overlay="true" style="padding:7px"></div>
      <div data-visible class="brand-logo" style="padding:9px"></div>
      <div data-visible style="padding:0;margin:auto;gap:5%"></div>
    `, { pretendToBeVisual: true })
    dom.window.document.querySelectorAll<HTMLElement>('[data-visible]').forEach(element => {
      element.getBoundingClientRect = visibleRect
    })

    expect((await collectSpacing(dom.window.document)).map(token => token.value)).toEqual([4])
  })

  it('does not read page text or expose element identity', async () => {
    const dom = new JSDOM('<div id="private-project" data-visible style="padding:8px">secret</div>', {
      pretendToBeVisual: true
    })
    const surface = dom.window.document.querySelector<HTMLElement>('[data-visible]')!
    surface.getBoundingClientRect = visibleRect
    Object.defineProperty(surface, 'textContent', {
      configurable: true,
      get: () => { throw new Error('text content must not be read') }
    })

    const serialized = JSON.stringify(await collectSpacing(dom.window.document))
    expect(serialized).not.toContain('private-project')
    expect(serialized).not.toContain('secret')
  })

  it('keeps website-applied spacing on an author-content presentation shell', async () => {
    const dom = new JSDOM(`
      <article class="markdown-body">
        <figure id="media-shell" style="padding:13px;gap:17px">
          <img id="payload" alt="author supplied image" style="padding:29px" />
        </figure>
      </article>
    `, { pretendToBeVisual: true })
    const article = dom.window.document.querySelector<HTMLElement>('article')!
    const shell = dom.window.document.querySelector<HTMLElement>('#media-shell')!
    const payload = dom.window.document.querySelector<HTMLElement>('#payload')!
    article.getBoundingClientRect = () => visibleRect(520, 240)
    shell.getBoundingClientRect = () => visibleRect(120, 80)
    payload.getBoundingClientRect = () => visibleRect(120, 80)

    const result = await collectSpacing(dom.window.document)

    expect(result.map(token => token.value)).toEqual(expect.arrayContaining([13, 17]))
    expect(result.map(token => token.value)).not.toContain(29)
    expect(JSON.stringify(result)).not.toContain('author supplied image')
  })

  it('uses Typed OM to reject auto and percentage values resolved to legacy px', async () => {
    const dom = new JSDOM(
      '<div data-visible style="padding-left:50px;margin-left:238.875px;gap:8px"></div>',
      { pretendToBeVisual: true }
    )
    const surface = dom.window.document.querySelector<HTMLElement>('[data-visible]')!
    surface.getBoundingClientRect = visibleRect
    Object.defineProperty(surface, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get(property: string) {
          if (property === 'padding-left') return { value: 25, unit: 'percent' }
          if (property === 'margin-left') return { value: 'auto' }
          if (property === 'row-gap' || property === 'column-gap') {
            return { value: 8, unit: 'px' }
          }
          return { value: 0, unit: 'px' }
        }
      })
    })

    expect((await collectSpacing(dom.window.document)).map(token => token.value)).toEqual([8])
  })
})

describe('normalizeSpacingPart', () => {
  it('accepts positive computed px values only', () => {
    expect(normalizeSpacingPart('8px')).toBe(8)
    expect(normalizeSpacingPart('12.34567px')).toBe(12.3457)
    expect(normalizeSpacingPart('0px')).toBeNull()
    expect(normalizeSpacingPart('-4px')).toBeNull()
    expect(normalizeSpacingPart('auto')).toBeNull()
    expect(normalizeSpacingPart('5%')).toBeNull()
    expect(normalizeSpacingPart('2vw')).toBeNull()
  })
})
