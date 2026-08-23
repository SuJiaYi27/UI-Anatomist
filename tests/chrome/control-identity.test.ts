import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { anonymousControlLogicalId } from '../../src/chrome/content/control-identity'

describe('anonymousControlLogicalId', () => {
  it('distinguishes structurally similar controls whose branches diverge beyond six ancestors', async () => {
    const dom = new JSDOM(`
      <main>
        <section>
          <div><div><div><div><div><div>
            <button id="first">First</button>
          </div></div></div></div></div></div>
        </section>
        <section>
          <div><div><div><div><div><div>
            <button id="second">Second</button>
          </div></div></div></div></div></div>
        </section>
      </main>
    `, { url: 'https://example.com/product' })
    const document = dom.window.document

    const first = await anonymousControlLogicalId(
      document,
      document.getElementById('first') as HTMLElement
    )
    const second = await anonymousControlLogicalId(
      document,
      document.getElementById('second') as HTMLElement
    )

    expect(first).not.toBe(second)
  })
})
