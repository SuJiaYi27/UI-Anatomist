import { describe, expect, it } from 'vitest'

import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import {
  makeComposite,
  makeControl,
  makeScan,
  placedControl
} from '../fixtures/anonymous-regression'

const fonts = [{ family: 'Arial', style: 'Regular' }]

describe('anonymous designer-facing composite regression', () => {
  it('keeps a painted placed popover and rejects a transparent unplaced shell', () => {
    const first = makeControl(30, { label: 'First action' })
    const second = makeControl(40, { label: 'Second action' })
    const complete = makeComposite(50, [
      placedControl(first, 8),
      placedControl(second, 56)
    ])
    const incomplete = makeComposite(60, [{
      kind: 'control',
      controlId: first.id,
      instanceId: first.instanceId!,
      state: first.state
    }], { backgroundAlpha: 0 })
    const scan = makeScan({ controls: [first, second], composites: [complete, incomplete] })
    const controls = createControlImportPlan(scan, [], fonts)
    const plan = createCompositeImportPlan(scan, controls, [], fonts)
    const ids = plan.groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).toContain(complete.id)
    expect(ids).not.toContain(incomplete.id)
    expect(plan.groups.flatMap(group => group.entries).flatMap(entry => entry.children)
      .every(child => child.placement !== null)).toBe(true)
  })

  it('keeps visually distinct observed composite states in one compatible family', () => {
    const first = makeControl(61, { label: 'First action' })
    const second = makeControl(62, { label: 'Second action' })
    const common = { logicalSeed: 63, templateSeed: 64 }
    const closed = makeComposite(65, [
      placedControl(first, 8), placedControl(second, 56)
    ], { ...common, state: 'default' })
    const expanded = makeComposite(66, [
      placedControl(first, 8), placedControl(second, 56)
    ], { ...common, state: 'expanded', backgroundAlpha: 0.95 })
    const scan = makeScan({ controls: [first, second], composites: [expanded, closed] })
    const controls = createControlImportPlan(scan, [], fonts)
    const groups = createCompositeImportPlan(scan, controls, [], fonts).groups
    const family = groups.find(group => group.entries.some(entry =>
      entry.source.logicalCompositeId === closed.logicalCompositeId
    ))

    expect(family?.kind).toBe('component_set')
    expect(family?.entries.map(entry => entry.source.state)).toEqual([
      'default', 'expanded'
    ])
    expect(new Set(family?.entries.map(entry =>
      entry.source.children.map(child => child.kind).join(','))).size).toBe(1)
  })

  it('rejects a tall shell whose measured children leave an unexplained row-sized gap', () => {
    const first = makeControl(67, { label: 'First action' })
    const second = makeControl(68, { label: 'Second action' })
    const sparse = makeComposite(69, [
      placedControl(first, 8), placedControl(second, 200)
    ], { height: 248 })
    const scan = makeScan({ controls: [first, second], composites: [sparse] })
    const controls = createControlImportPlan(scan, [], fonts)
    const ids = createCompositeImportPlan(scan, controls, [], fonts)
      .groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).not.toContain(sparse.id)
  })
})
