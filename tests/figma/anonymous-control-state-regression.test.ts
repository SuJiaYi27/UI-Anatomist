import { describe, expect, it } from 'vitest'

import { createControlImportPlan } from '../../src/figma/control-import-plan'
import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import { createIconImportPlan } from '../../src/figma/icon-import-plan'
import { ScanExportSchema } from '../../src/shared/schema'
import {
  makeComposite,
  makeControl,
  makeIcon,
  makeScan,
  placedControl
} from '../fixtures/anonymous-regression'

describe('anonymous control-state regression', () => {
  it('creates one reusable family with deterministic observed states', () => {
    const common = { logicalSeed: 70, instanceSeed: 71, templateSeed: 72 }
    const defaultControl = makeControl(73, { ...common, state: 'default' })
    const focusControl = makeControl(74, { ...common, state: 'focus' })
    const plan = createControlImportPlan(
      makeScan({ controls: [focusControl, defaultControl] }),
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.kind).toBe('component_set')
    expect(plan.groups[0]?.entries.map(entry => entry.source.state)).toEqual([
      'default', 'focus'
    ])
    expect(new Set(plan.groups[0]?.instances.map(token => token.instanceId)))
      .toEqual(new Set([defaultControl.instanceId]))
  })

  it('passes schema, privacy-copy, reference, and bounded-geometry gates', () => {
    const control = makeControl(75, { label: 'Open details' })
    const composite = makeComposite(76, [placedControl(control, 8)], { height: 56 })
    const parsed = ScanExportSchema.parse(makeScan({ controls: [control], composites: [composite] }))

    expect(parsed.traversal.failures).toBe(0)
    expect(parsed.controls.every(item => !/[\r\n]|https?:\/\//.test(
      item.sampleText?.value ?? ''
    ))).toBe(true)
    expect(parsed.composites[0]?.children[0]).toMatchObject({
      controlId: control.id, instanceId: control.instanceId
    })
    expect(parsed.composites.every(item =>
      item.geometry.width <= 4096 && item.geometry.height <= 4096)).toBe(true)
  })

  it('imports only retained composite children with measured placement', () => {
    const first = makeControl(77, { label: 'First action' })
    const second = makeControl(78, { label: 'Second action' })
    const composite = makeComposite(79, [placedControl(first, 8), placedControl(second, 56)])
    const scan = makeScan({ controls: [first, second], composites: [composite] })
    const controls = createControlImportPlan(scan, [], [])
    const entries = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries)

    expect(entries).not.toHaveLength(0)
    expect(entries.flatMap(entry => entry.source.children)
      .every(child => Boolean(child.placement))).toBe(true)
  })

  it('does not create a contradictory all-hover family', () => {
    const common = { logicalSeed: 81, instanceSeed: 82, templateSeed: 83 }
    const defaultControl = makeControl(84, { ...common, state: 'default' })
    const hoverControl = makeControl(85, { ...common, state: 'hover' })
    const groups = createControlImportPlan(
      makeScan({ controls: [hoverControl, defaultControl] }), [], []
    ).groups

    expect(groups).toHaveLength(1)
    expect(groups[0]?.entries.map(entry => entry.source.state)).toEqual([
      'default', 'hover'
    ])
  })

  it('assigns one ownership key to each reusable visual family', () => {
    const first = makeControl(86, { label: 'First action' })
    const second = makeControl(87, { label: 'Second action', leadingIcon: true })
    const groups = createControlImportPlan(makeScan({ controls: [first, second] }), [], [])
      .groups
    const keys = groups.map(group => group.groupOwnershipId)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('creates a sanitized reusable icon master for an observed UI icon', () => {
    const icon = makeIcon(88, 'Open menu')
    const entries = createIconImportPlan(makeScan({ icons: [icon] }), []).entries

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: 'create', assetKind: 'component', states: ['Default']
    })
    expect(entries[0]?.ownershipId).toContain(icon.id)
  })
})
