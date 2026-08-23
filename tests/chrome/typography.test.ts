import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { collectTypography } from '../../src/chrome/content/typography'

describe('collectTypography', () => {
  it('deduplicates styles without exporting page content', async () => {
    const dom = new JSDOM(readFileSync('tests/fixtures/typography.html', 'utf8'), {
      url: 'https://example.com/',
      pretendToBeVisual: true
    })
    const result = await collectTypography(dom.window.document)
    expect(result.find(item => item.name === 'body-regular')?.occurrences).toBe(2)
    expect(JSON.stringify(result)).not.toContain('Private')
    expect(JSON.stringify(result)).not.toContain('brand.png')
  })

  it('keeps normal line-height as Auto instead of guessing pixels', async () => {
    const dom = new JSDOM('<small style="font-family:Arial;font-size:12px;font-weight:400;line-height:normal">Caption</small>', { pretendToBeVisual: true })
    const result = await collectTypography(dom.window.document)
    expect(result[0]?.lineHeightPx).toBeNull()
  })

  it('adds the line height only when readable typography names collide', async () => {
    const dom = new JSDOM(`
      <small style="font-family:Arial;font-size:12px;font-weight:400;line-height:16px">First</small>
      <small style="font-family:Arial;font-size:12px;font-weight:400;line-height:17.1429px">Second</small>
    `, { pretendToBeVisual: true })

    const result = await collectTypography(dom.window.document)

    expect(result.map(item => item.name).sort()).toEqual([
      'caption-regular-lh16',
      'caption-regular-lh17.14'
    ])
  })

  it('uses the family when line height and other typography fields still collide', async () => {
    const dom = new JSDOM(`
      <small style="font-family:Arial,sans-serif;font-size:12px;font-weight:400;line-height:16px">First</small>
      <small style="font-family:Georgia,serif;font-size:12px;font-weight:400;line-height:16px">Second</small>
    `, { pretendToBeVisual: true })

    const result = await collectTypography(dom.window.document)
    const names = result.map(item => item.name)

    expect(new Set(names).size).toBe(2)
    expect(names).toContain('caption-regular-lh16-ls0-normal-arial')
    expect(names).toContain('caption-regular-lh16-ls0-normal-georgia')
  })

  it('ignores text hidden by an ancestor until that state is revealed', async () => {
    const dom = new JSDOM(`
      <p style="font-size:16px">Visible</p>
      <section hidden><p style="font-size:31px">Hidden</p></section>
    `, { pretendToBeVisual: true })
    const result = await collectTypography(dom.window.document)
    expect(result.some(item => item.fontSizePx === 31)).toBe(false)
  })

  it('collects direct text from generic, list, table, and caption containers', async () => {
    const dom = new JSDOM(`
      <style>.sample { font-family: Arial; font-size: 17px; font-weight: 400; line-height: 23px; }</style>
      <div class="sample">Div text</div>
      <ul><li class="sample">List text</li></ul>
      <table><tbody><tr><td class="sample">Cell text</td></tr></tbody></table>
      <figure><figcaption class="sample">Caption text</figcaption></figure>
    `, { pretendToBeVisual: true })

    const result = await collectTypography(dom.window.document)
    const style = result.find(item => item.fontSizePx === 17)
    expect(style?.occurrences).toBe(4)
    expect(style?.role).toBe('body')
  })

  it('does not collect the extension progress overlay', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-overlay="true"><p style="font-size:40px">Scanning 1 / 8</p></div>
      <p style="font-size:16px">Visible page text</p>
    `, { pretendToBeVisual: true })

    const result = await collectTypography(dom.window.document)

    expect(result.some(item => item.fontSizePx === 40)).toBe(false)
    expect(result.some(item => item.fontSizePx === 16)).toBe(true)
  })

  it('does not turn a strict font-icon ligature into a typography token', async () => {
    const dom = new JSDOM(`
      <mat-icon class="interface-symbols ligature-font"
        style="font-family:'Interface Symbols';font-size:24px">settings</mat-icon>
      <span style="font-family:Arial;font-size:16px">Visible label</span>
    `, { pretendToBeVisual: true })
    const icon = dom.window.document.querySelector<HTMLElement>('mat-icon')!
    icon.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 24, height: 24,
      top: 0, right: 24, bottom: 24, left: 0,
      toJSON: () => ({})
    })

    const result = await collectTypography(dom.window.document)

    expect(result.some(item => item.fontFamilyStack.includes('Interface Symbols')))
      .toBe(false)
    expect(result.some(item => item.fontFamilyStack.includes('Arial'))).toBe(true)
  })
})
