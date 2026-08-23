import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  attachSlotProvenance,
  type SlotProvenanceObservation
} from '../../src/chrome/content/slot-provenance'

function ownership(element: HTMLElement) {
  return {
    interaction: element,
    layout: element,
    paint: element,
    slots: element,
    compositeAnchor: element
  }
}

function observation(
  element: HTMLElement,
  slotSources: SlotProvenanceObservation['slotSources']
): SlotProvenanceObservation {
  return { ownership: ownership(element), slotSources }
}

describe('internal slot source provenance', () => {
  it('distinguishes parent-owned marker from an independent control graphic', () => {
    const dom = new JSDOM('<div id="scope"><div id="row"><span id="parent-marker"></span></div><button id="action"><span id="action-icon"></span></button></div>')
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const action = document.querySelector<HTMLElement>('#action')!
    const parentMarker = document.querySelector<HTMLElement>('#parent-marker')!
    const actionIcon = document.querySelector<HTMLElement>('#action-icon')!
    const target = observation(row, { leading: parentMarker, trailing: actionIcon })
    const actionObservation = observation(action, { leading: actionIcon, trailing: null })
    const peer = observation(document.createElement('div'), { leading: null, trailing: null })

    const [resolvedTarget] = attachSlotProvenance([
      target,
      actionObservation,
      peer
    ])

    expect(resolvedTarget?.slotProvenance).toEqual({
      leading: 'parent-owned',
      trailing: 'independent-control-owned'
    })
  })

  it('marks overlapping ownership as unknown instead of guessing a slot owner', () => {
    const dom = new JSDOM('<div id="scope"><div id="row"><span id="marker"></span></div><button id="action"></button></div>')
    const document = dom.window.document
    const scope = document.querySelector<HTMLElement>('#scope')!
    const row = document.querySelector<HTMLElement>('#row')!
    const marker = document.querySelector<HTMLElement>('#marker')!
    const target = observation(row, { leading: marker, trailing: null })
    const overlapping = observation(scope, { leading: null, trailing: null })
    const broader = observation(document.body, { leading: null, trailing: null })

    const [resolvedTarget] = attachSlotProvenance([target, overlapping, broader])

    expect(resolvedTarget?.slotProvenance?.leading).toBe('unknown')
  })
})
