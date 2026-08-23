import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  selectControlOwnership,
  type ControlOwnershipEvidence
} from '../../src/chrome/content/control-ownership'

describe('control ownership selection', () => {
  it('keeps every role on one simple painted control', () => {
    const document = new JSDOM('<button id="control">Action</button>').window.document
    const interaction = document.querySelector<HTMLElement>('#control')!

    expect(selectControlOwnership(interaction, [])).toEqual({
      interaction,
      layout: interaction,
      paint: interaction,
      slots: interaction,
      compositeAnchor: interaction
    })
  })

  it('keeps layout, paint, slot scope, and anchor as distinct roles', () => {
    const document = new JSDOM(`
      <div id="paint">
        <div id="layout">
          <span id="slot"><input id="control" /></span>
        </div>
      </div>
    `).window.document
    const interaction = document.querySelector<HTMLElement>('#control')!
    const slot = document.querySelector<HTMLElement>('#slot')!
    const layout = document.querySelector<HTMLElement>('#layout')!
    const paint = document.querySelector<HTMLElement>('#paint')!
    const evidence: ControlOwnershipEvidence[] = [
      { element: slot, ownsLayout: false, ownsPaint: false, ownsSlots: true },
      { element: layout, ownsLayout: true, ownsPaint: false, ownsSlots: false },
      { element: paint, ownsLayout: false, ownsPaint: true, ownsSlots: false }
    ]

    expect(selectControlOwnership(interaction, evidence)).toEqual({
      interaction,
      layout,
      paint,
      slots: slot,
      compositeAnchor: paint
    })
  })

  it('uses a local slot scope without promoting layout or paint', () => {
    const document = new JSDOM(`
      <div id="row"><button id="control">Action</button></div>
    `).window.document
    const interaction = document.querySelector<HTMLElement>('#control')!
    const row = document.querySelector<HTMLElement>('#row')!

    expect(selectControlOwnership(interaction, [{
      element: row,
      ownsLayout: false,
      ownsPaint: false,
      ownsSlots: true
    }])).toEqual({
      interaction,
      layout: interaction,
      paint: interaction,
      slots: row,
      compositeAnchor: row
    })
  })
})
