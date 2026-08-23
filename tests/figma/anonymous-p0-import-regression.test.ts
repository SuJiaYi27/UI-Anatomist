import { describe, expect, it } from 'vitest'

import { createControlImportPlan } from '../../src/figma/control-import-plan'
import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import {
  makeComposite,
  makeControl,
  makeScan,
  placedControl
} from '../fixtures/anonymous-regression'

describe('anonymous P0 import regression', () => {
  it('keeps an evidenced input while excluding an evidence-free empty control', () => {
    const anonymous = makeControl(10, { label: null })
    anonymous.geometry.borderWidth = 0
    anonymous.appearance.background.a = 0
    anonymous.appearance.border.a = 0
    const input = makeControl(20, { family: 'input', label: 'Search items' })
    const plan = createControlImportPlan(
      makeScan({ controls: [anonymous, input] }),
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const ids = plan.groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).toContain(input.id)
    expect(ids).not.toContain(anonymous.id)
  })

  it('does not publish a transparent anonymous shell beside a complete surface', () => {
    const first = makeControl(21, { label: 'First action' })
    const second = makeControl(22, { label: 'Second action' })
    const complete = makeComposite(23, [
      placedControl(first, 8), placedControl(second, 56)
    ])
    const anonymous = makeComposite(24, [{
      kind: 'control', controlId: first.id, instanceId: first.instanceId!,
      state: first.state
    }], { backgroundAlpha: 0 })
    const scan = makeScan({ controls: [first, second], composites: [complete, anonymous] })
    const controls = createControlImportPlan(scan, [], [])
    const entries = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries)

    expect(entries.map(entry => entry.source.id)).toContain(complete.id)
    expect(entries.map(entry => entry.source.id)).not.toContain(anonymous.id)
    expect(entries.flatMap(entry => entry.children)
      .some(child => child.kind === 'structure')).toBe(false)
  })
})
