import { describe, expect, it } from 'vitest'

import { createIconImportPlan } from '../../src/figma/icon-import-plan'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import { isSafeControlSampleTextValue } from '../../src/shared/safe-evidence'
import { ScanExportSchema } from '../../src/shared/schema'
import {
  makeComposite,
  makeControl,
  makeIcon,
  makeScan,
  placedControl
} from '../fixtures/anonymous-regression'

describe('anonymous import-boundary regression', () => {
  it('keeps safe control copy and replaces untrusted accessible icon names', () => {
    const control = makeControl(120, { label: 'Open settings', leadingIcon: true })
    const icon = makeIcon(121, '184.2k items for account/name')
    const scan = makeScan({ controls: [control], icons: [icon] })
    const plan = createIconImportPlan(scan, [])

    expect(isSafeControlSampleTextValue(control.sampleText!.value)).toBe(true)
    expect(plan.entries[0]?.source.name).toMatch(/^icon-[0-9a-f]{6}$/)
    expect(plan.entries[0]?.source.nameSource).toBe('geometry')
    expect(JSON.stringify(plan.entries)).not.toContain('account/name')
  })

  it('passes traversal, privacy-copy, and reference gates', () => {
    const control = makeControl(135, { label: 'Open settings' })
    const composite = makeComposite(136, [placedControl(control, 8)], { height: 56 })
    const parsed = ScanExportSchema.parse(makeScan({ controls: [control], composites: [composite] }))

    expect(parsed.traversal.failures).toBe(0)
    expect(parsed.controls.every(item =>
      !/[\r\n]|https?:\/\/|@example\./.test(item.sampleText?.value ?? ''))).toBe(true)
    expect(parsed.composites[0]?.children[0]).toMatchObject({ controlId: control.id })
  })

  it('exports one visual for each instance and observed state', () => {
    const common = { logicalSeed: 137, instanceSeed: 138, templateSeed: 139 }
    const controls = [
      makeControl(141, { ...common, state: 'default' }),
      makeControl(142, { ...common, state: 'focus' })
    ]
    const plan = createControlImportPlan(makeScan({ controls }), [], [])
    const keys = plan.groups.flatMap(group => group.entries.map(entry =>
      `${entry.source.instanceId}|${entry.source.state}`
    ))

    expect(new Set(keys).size).toBe(keys.length)
    expect(plan.groups[0]?.entries.map(entry => entry.source.state))
      .toEqual(['default', 'focus'])
  })

  it('creates one component set for one reusable state family', () => {
    const common = { logicalSeed: 143, instanceSeed: 144, templateSeed: 145 }
    const plan = createControlImportPlan(makeScan({ controls: [
      makeControl(146, { ...common, state: 'default' }),
      makeControl(147, { ...common, state: 'expanded' })
    ] }), [], [])

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.kind).toBe('component_set')
    expect(new Set(plan.groups.map(group => group.groupOwnershipId)).size).toBe(1)
  })

  it('keeps a complete painted popover and rejects an incomplete structural slice', () => {
    const first = makeControl(148, { label: 'First action' })
    const second = makeControl(149, { label: 'Second action' })
    const complete = makeComposite(151, [placedControl(first, 8), placedControl(second, 56)])
    const slice = makeComposite(152, [placedControl(first, 8), placedControl(second, 160)], {
      width: 400, height: 208, backgroundAlpha: 0
    })
    slice.geometry.borderWidth = 0
    slice.appearance.border.a = 0
    const scan = makeScan({ controls: [first, second], composites: [complete, slice] })
    const controls = createControlImportPlan(scan, [], [])
    const ids = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).toContain(complete.id)
    expect(ids).not.toContain(slice.id)
  })
})
