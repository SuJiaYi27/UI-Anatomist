import { describe, expect, it } from 'vitest'

import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import {
  makeComposite,
  makeControl,
  makeScan,
  placedControl
} from '../fixtures/anonymous-regression'

describe('anonymous composite-owner regression', () => {
  it('resolves a placed nested composite without breaking child references', () => {
    const action = makeControl(130, { label: 'Confirm action' })
    const secondary = makeControl(131, { label: 'Cancel action' })
    const inner = makeComposite(140, [
      placedControl(action, 8),
      placedControl(secondary, 56)
    ], {
      kind: 'menu',
      height: 104
    })
    const outer = makeComposite(150, [{
      kind: 'composite',
      compositeId: inner.id,
      placement: { x: 8, y: 8, width: 224, height: 104 }
    }], { height: 120 })
    const scan = makeScan({ controls: [action, secondary], composites: [outer, inner] })
    const controls = createControlImportPlan(
      scan,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(scan, controls, [])
    const entries = plan.groups.flatMap(group => group.entries)
    const outerEntry = entries.find(entry => entry.source.id === outer.id)

    expect(entries.some(entry => entry.source.id === outer.id)).toBe(true)
    expect(outerEntry?.children).toEqual([
      expect.objectContaining({ kind: 'composite', compositeId: inner.id })
    ])
    expect(outerEntry?.source.children[0]?.placement).toEqual({
      x: 8, y: 8, width: 224, height: 104
    })
  })

  it('keeps more than eight independently evidenced composite families', () => {
    const controls = Array.from({ length: 18 }, (_, index) =>
      makeControl(160 + index, { label: `Action ${index + 1}` })
    )
    const composites = Array.from({ length: 9 }, (_, index) =>
      makeComposite(200 + index, [
        placedControl(controls[index * 2]!, 8),
        placedControl(controls[index * 2 + 1]!, 56)
      ])
    )
    const scan = makeScan({ controls, composites })
    const controlPlan = createControlImportPlan(scan, [], [])
    const plan = createCompositeImportPlan(scan, controlPlan, [])
    const entries = plan.groups.flatMap(group => group.entries)

    expect(entries).toHaveLength(9)
    expect(new Set(entries.map(entry => entry.source.id)).size).toBe(9)
  })

  it('retains measured shell size and child placement in the import source', () => {
    const first = makeControl(220, { label: 'First action' })
    const second = makeControl(221, { label: 'Second action' })
    const popover = makeComposite(222, [
      placedControl(first, 8), placedControl(second, 56)
    ], { width: 240, height: 112 })
    const scan = makeScan({ controls: [first, second], composites: [popover] })
    const controls = createControlImportPlan(scan, [], [])
    const entry = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries)[0]

    expect(entry?.source.geometry).toMatchObject({ width: 240, height: 112 })
    expect(entry?.source.children.map(child => child.placement)).toEqual([
      { x: 8, y: 8, width: 224, height: 40 },
      { x: 8, y: 56, width: 224, height: 40 }
    ])
  })
})
