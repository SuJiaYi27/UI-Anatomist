import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import type { ControlObservation } from '../../src/chrome/content/controls'
import type { ControlOwnership } from '../../src/chrome/content/control-ownership'
import { findProvenanceScopeRoot } from '../../src/chrome/content/control-state-provenance'
import { sampleVerticalScrollStates } from '../../src/chrome/content/scroll-sampler'

type AnonymousGroupTrace = {
  boundary: {
    source: 'visible-generic-control-count' | 'actual-local-scroll-target'
    directMemberCount: number
    nestedMemberCount: number
    outsideGroupCount: number
  }
  membership: {
    directMembers: ControlObservation[]
    nestedUnderDirectMembers: ControlObservation[]
    outsideGroup: ControlObservation[]
  }
}

function observation(element: HTMLElement): ControlObservation {
  const ownership: ControlOwnership = {
    interaction: element,
    layout: element,
    paint: element,
    slots: element,
    compositeAnchor: element
  }
  return { ownership, token: {} as ControlObservation['token'] }
}

function anonymousGroupTrace(
  boundary: HTMLElement,
  observations: ControlObservation[],
  source: AnonymousGroupTrace['boundary']['source'] = 'visible-generic-control-count'
): AnonymousGroupTrace {
  const inside = observations.filter(item =>
    boundary.contains(item.ownership.interaction)
  )
  const directMembers = inside.filter(item => !inside.some(other =>
    other !== item && other.ownership.interaction.contains(item.ownership.interaction)
  ))
  const nestedUnderDirectMembers = inside.filter(item =>
    !directMembers.includes(item)
  )
  return {
    boundary: {
      // This reports the current scope-root algorithm's actual positive
      // input. It is deliberately not presented as composite ownership.
      source,
      directMemberCount: directMembers.length,
      nestedMemberCount: nestedUnderDirectMembers.length,
      outsideGroupCount: observations.length - inside.length
    },
    membership: {
      directMembers,
      nestedUnderDirectMembers,
      outsideGroup: observations.filter(item => !inside.includes(item))
    }
  }
}

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

describe('anonymous structural group evidence', () => {
  it('separates direct rows, a nested action, and popup outsiders without treating the scope heuristic as ownership', () => {
    const dom = new JSDOM(`
      <div id="popup">
        <button id="header">Header</button>
        <div id="list">
          <div role="button" id="row-one">One</div>
          <div role="button" id="row-two">Two <div role="button" id="nested-action">Action</div></div>
          <div role="button" id="row-three">Three</div>
        </div>
        <input id="search" />
        <button id="footer">Footer</button>
      </div>
      <div id="community"><button id="community-action">Community</button></div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const element = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!
    const list = element('list')
    const rows = [element('row-one'), element('row-two'), element('row-three')]
    const nested = element('nested-action')
    const outsiders = [
      element('header'), element('search'), element('footer'), element('community-action')
    ]
    const observations = [...rows, nested, ...outsiders].map(observation)

    // The current boundary finder selects this list because its first positive
    // fact is a count of visible generic controls. The test intentionally
    // records that heuristic separately from membership projection.
    expect(findProvenanceScopeRoot(rows[0]!, dom.window as unknown as Window)).toBe(list)

    const trace = anonymousGroupTrace(list, observations)

    expect(trace.boundary).toEqual({
      source: 'visible-generic-control-count',
      directMemberCount: 3,
      nestedMemberCount: 1,
      outsideGroupCount: 4
    })
    expect(trace.membership.directMembers).toEqual(rows.map(element =>
      observations.find(item => item.ownership.interaction === element)!
    ))
    expect(trace.membership.nestedUnderDirectMembers).toEqual([
      observations.find(item => item.ownership.interaction === nested)!
    ])
    expect(trace.membership.outsideGroup).toEqual(outsiders.map(element =>
      observations.find(item => item.ownership.interaction === element)!
    ))
  })

  it('uses the node actually moved by the existing scroll sampler as a given boundary without treating scrollability as a selected rule', async () => {
    const dom = new JSDOM(`
      <div id="popup">
        <div id="header">Header</div>
        <div id="list" style="overflow-y:auto">
          <div id="row-one">One</div>
          <div id="row-two">Two <div id="nested-action">Action</div></div>
          <div id="row-three">Three</div>
        </div>
        <input id="search" />
        <div id="footer">Footer</div>
      </div>
      <div id="community"><div id="community-action">Community</div></div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const element = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!
    const list = element('list')
    const popup = element('popup')
    const documentScroller = document.documentElement
    const rows = [element('row-one'), element('row-two'), element('row-three')]
    const nested = element('nested-action')
    const outsiders = [
      element('header'), element('search'), element('footer'), element('community-action')
    ]
    const observations = [...rows, nested, ...outsiders].map(observation)

    // Only the local list is made scrollable. The expected boundary below is
    // derived from the node the existing sampler actually moves, not from
    // role, tag, appearance, dimensions, or a control count.
    defineMetric(list, 'clientHeight', 100)
    defineMetric(list, 'scrollHeight', 500)
    list.scrollTop = 25
    const originalTops = new Map<HTMLElement, number>([
      [list, list.scrollTop],
      [popup, popup.scrollTop],
      [documentScroller, documentScroller.scrollTop]
    ])
    const movedTargets = new Set<HTMLElement>()

    await sampleVerticalScrollStates(document, async () => {
      for (const [node, originalTop] of originalTops) {
        if (node.scrollTop !== originalTop) movedTargets.add(node)
      }
      return undefined
    }, {
      includeCurrent: false,
      maximumContainers: 1,
      maximumPositions: 2,
      settle: async () => {}
    })

    expect(movedTargets).toEqual(new Set([list]))
    expect(list.scrollTop).toBe(25)
    const trace = anonymousGroupTrace(list, observations, 'actual-local-scroll-target')

    expect(trace.boundary).toEqual({
      source: 'actual-local-scroll-target',
      directMemberCount: 3,
      nestedMemberCount: 1,
      outsideGroupCount: 4
    })
    expect(trace.membership.directMembers).toEqual(rows.map(element =>
      observations.find(item => item.ownership.interaction === element)!
    ))
    expect(trace.membership.nestedUnderDirectMembers).toEqual([
      observations.find(item => item.ownership.interaction === nested)!
    ])
    expect(trace.membership.outsideGroup).toEqual(outsiders.map(element =>
      observations.find(item => item.ownership.interaction === element)!
    ))
  })
})
