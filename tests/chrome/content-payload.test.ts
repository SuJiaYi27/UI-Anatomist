import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  isAuthorSuppliedGraphicPayload,
  isWebsiteAppliedContentPresentation
} from '../../src/chrome/content/content-payload'

describe('content payload provenance', () => {
  it.each([
    '<article>',
    '<div role="article">',
    '<div data-message-author-role="user">',
    '<div contenteditable="true">'
  ])('recognizes semantic published or editable content without a site rule: %s', opening => {
    const closing = opening.startsWith('<article') ? '</article>' : '</div>'
    const dom = new JSDOM(`
      ${opening}
        <figure id="presentation"><svg id="payload"><path /></svg></figure>
        <button id="reply"><svg id="reply-icon"><path /></svg></button>
      ${closing}
    `)
    const document = dom.window.document

    expect(isWebsiteAppliedContentPresentation(
      document.querySelector('#presentation')!
    )).toBe(true)
    expect(isAuthorSuppliedGraphicPayload(
      document.querySelector('#payload')!
    )).toBe(true)
    expect(isAuthorSuppliedGraphicPayload(
      document.querySelector('#reply-icon')!
    )).toBe(false)
  })

  it('keeps a website operation graphic even when the operation sits inside article content', () => {
    const dom = new JSDOM(`
      <article>
        <button>
          <svg id="operation-icon"><path /></svg>
          <span>Reply</span>
        </button>
      </article>
    `)

    expect(isAuthorSuppliedGraphicPayload(
      dom.window.document.querySelector('#operation-icon')!
    )).toBe(false)
  })

  it('does not infer author content from an ordinary static container', () => {
    const dom = new JSDOM(`
      <div><figure id="surface"><svg id="graphic"><path /></svg></figure></div>
    `)

    expect(isWebsiteAppliedContentPresentation(
      dom.window.document.querySelector('#surface')!
    )).toBe(false)
    expect(isAuthorSuppliedGraphicPayload(
      dom.window.document.querySelector('#graphic')!
    )).toBe(false)
  })
})
