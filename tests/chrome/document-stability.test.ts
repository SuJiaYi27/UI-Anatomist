import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { waitForStableDocument } from '../../src/chrome/content/document-stability'

describe('waitForStableDocument', () => {
  it('keeps waiting while a visible loading indicator is present', async () => {
    const dom = new JSDOM(`
      <main>
        <div role="status">Loading files</div>
      </main>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    dom.window.setTimeout(() => {
      document.querySelector('[role="status"]')?.remove()
      const button = document.createElement('button')
      button.textContent = 'Load more'
      document.querySelector('main')?.appendChild(button)
    }, 50)

    await waitForStableDocument(document, {
      minimumWaitMs: 0,
      quietPeriodMs: 5,
      maximumWaitMs: 200
    })

    expect(document.querySelector('button')).not.toBeNull()
  })
})
