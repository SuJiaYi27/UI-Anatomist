import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { sampleVerticalScrollStates } from '../../src/chrome/content/scroll-sampler'

function defineMetric(
  node: HTMLElement,
  name: 'clientHeight' | 'scrollHeight',
  value: number
): void {
  Object.defineProperty(node, name, {
    configurable: true,
    value
  })
}

describe('sampleVerticalScrollStates', () => {
  it('samples bounded vertical positions and restores the original position', async () => {
    const dom = new JSDOM(
      '<main id="feed" style="height:200px;overflow-y:auto"><div style="height:1200px"></div></main>',
      { pretendToBeVisual: true, url: 'https://example.com/' }
    )
    const document = dom.window.document
    const feed = document.querySelector<HTMLElement>('#feed')!
    defineMetric(feed, 'clientHeight', 200)
    defineMetric(feed, 'scrollHeight', 1_200)
    feed.scrollTop = 250

    const samples = await sampleVerticalScrollStates(document, async () => feed.scrollTop, {
      includeCurrent: true,
      maximumContainers: 1,
      maximumPositions: 3
    })

    expect(samples).toEqual([250, 0, 500, 1_000])
    expect(feed.scrollTop).toBe(250)
  })

  it('ignores clipped or non-scrollable containers', async () => {
    const dom = new JSDOM(`
      <main id="clipped" style="height:200px;overflow-y:hidden"></main>
      <aside id="short" style="height:200px;overflow-y:auto"></aside>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const clipped = document.querySelector<HTMLElement>('#clipped')!
    const short = document.querySelector<HTMLElement>('#short')!
    defineMetric(clipped, 'clientHeight', 200)
    defineMetric(clipped, 'scrollHeight', 1_200)
    defineMetric(short, 'clientHeight', 200)
    defineMetric(short, 'scrollHeight', 200)

    let calls = 0
    const samples = await sampleVerticalScrollStates(document, async () => ++calls)

    expect(samples).toEqual([1])
    expect(clipped.scrollTop).toBe(0)
    expect(short.scrollTop).toBe(0)
  })

  it('waits for the injected stability gate after movement and restoration', async () => {
    const dom = new JSDOM(
      '<main id="feed" style="height:200px;overflow-y:auto"></main>',
      { pretendToBeVisual: true, url: 'https://example.com/' }
    )
    const document = dom.window.document
    const feed = document.querySelector<HTMLElement>('#feed')!
    defineMetric(feed, 'clientHeight', 200)
    defineMetric(feed, 'scrollHeight', 1_200)
    feed.scrollTop = 250
    const settledAt: number[] = []

    const samples = await sampleVerticalScrollStates(document, async () => feed.scrollTop, {
      includeCurrent: false,
      maximumContainers: 1,
      maximumPositions: 2,
      settle: async () => {
        settledAt.push(feed.scrollTop)
      }
    })

    expect(samples).toEqual([0, 1_000])
    expect(settledAt).toEqual([0, 1_000, 250])
    expect(feed.scrollTop).toBe(250)
  })

  it('does not synthesize duplicate scroll events after assigning scrollTop', async () => {
    const dom = new JSDOM(
      '<main id="feed" style="height:200px;overflow-y:auto"></main>',
      { pretendToBeVisual: true, url: 'https://example.com/' }
    )
    const document = dom.window.document
    const feed = document.querySelector<HTMLElement>('#feed')!
    defineMetric(feed, 'clientHeight', 200)
    defineMetric(feed, 'scrollHeight', 1_200)
    let syntheticScrolls = 0
    feed.addEventListener('scroll', event => {
      if (!event.isTrusted) syntheticScrolls += 1
    })

    await sampleVerticalScrollStates(document, async () => feed.scrollTop, {
      includeCurrent: false,
      maximumContainers: 1,
      maximumPositions: 2,
      settle: async () => {}
    })

    expect(syntheticScrolls).toBe(0)
  })
})
