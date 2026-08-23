import { describe, expect, it } from 'vitest'

import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import { primaryAxisAlignment } from '../../src/figma/control-component-applier'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import { ScanExportSchema } from '../../src/shared/schema'
import {
  makeComposite,
  makeControl,
  makeScan,
  placedControl
} from '../fixtures/anonymous-regression'

describe('anonymous component-root regression', () => {
  it('preserves measured alignment and placed children in the designer-facing root', () => {
    const start = makeControl(80, { label: 'Start action', contentAlignment: 'start' })
    const end = makeControl(90, { label: 'End action', contentAlignment: 'start' })
    const root = makeComposite(100, [placedControl(start, 8), placedControl(end, 56)])
    const scan = makeScan({ controls: [start, end], composites: [root] })
    const controls = createControlImportPlan(
      scan,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const plan = createCompositeImportPlan(
      scan,
      controls,
      [],
      [{ family: 'Arial', style: 'Regular' }]
    )
    const entry = plan.groups.flatMap(group => group.entries)
      .find(candidate => candidate.source.id === root.id)

    expect(primaryAxisAlignment('start')).toBe('MIN')
    expect(primaryAxisAlignment('center')).toBe('CENTER')
    expect(primaryAxisAlignment('end')).toBe('MAX')
    expect(primaryAxisAlignment('space-between')).toBe('SPACE_BETWEEN')
    expect(entry?.source.children.every(child => child.placement)).toBe(true)
    expect(entry?.children.map(child => child.kind)).toEqual(['control', 'control'])
  })

  it('keeps the anonymous export schema-valid and reference-complete', () => {
    const control = makeControl(101, { label: 'Open options' })
    const composite = makeComposite(102, [placedControl(control, 8)], { height: 56 })
    const parsed = ScanExportSchema.parse(makeScan({ controls: [control], composites: [composite] }))

    expect(parsed.source.origin).toBe('https://example.test')
    expect(parsed.traversal.failures).toBe(0)
    expect(parsed.composites[0]?.children[0]).toMatchObject({
      controlId: control.id, instanceId: control.instanceId
    })
  })

  it('publishes only complete placed shells from a mixed candidate set', () => {
    const first = makeControl(103, { label: 'First action' })
    const second = makeControl(104, { label: 'Second action' })
    const complete = makeComposite(105, [placedControl(first, 8), placedControl(second, 56)])
    const incomplete = makeComposite(106, [{
      kind: 'control', controlId: first.id, instanceId: first.instanceId!, state: first.state
    }], { width: 400, height: 200, backgroundAlpha: 0 })
    const scan = makeScan({ controls: [first, second], composites: [complete, incomplete] })
    const controls = createControlImportPlan(scan, [], [])
    const ids = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).toContain(complete.id)
    expect(ids).not.toContain(incomplete.id)
  })

  it('rejects a two-row list with unexplained trailing space', () => {
    const first = makeControl(107, { label: 'First row' })
    const second = makeControl(108, { label: 'Second row' })
    const incomplete = makeComposite(109, [
      placedControl(first, 8), placedControl(second, 56)
    ], { kind: 'list', height: 240 })
    const scan = makeScan({ controls: [first, second], composites: [incomplete] })
    const controls = createControlImportPlan(scan, [], [])
    const ids = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).not.toContain(incomplete.id)
    expect(controls.groups.flatMap(group => group.entries)).toHaveLength(2)
  })

  it('rejects a separator-like panel without deleting its atomic controls', () => {
    const first = makeControl(111, { label: 'Local' })
    const second = makeControl(112, { label: 'Remote' })
    const panel = makeComposite(113, [
      placedControl(first, 8), placedControl(second, 56)
    ], { kind: 'panel', width: 400, height: 220, backgroundAlpha: 0 })
    panel.geometry.borderWidth = 0
    panel.appearance.border.a = 0
    const scan = makeScan({ controls: [first, second], composites: [panel] })
    const controls = createControlImportPlan(scan, [], [])
    const ids = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).not.toContain(panel.id)
    expect(controls.groups.flatMap(group => group.entries)
      .map(entry => entry.source.sampleText?.value)).toEqual(
      expect.arrayContaining(['Local', 'Remote'])
    )
  })

  it('keeps composite variants structurally compatible', () => {
    const first = makeControl(114, { label: 'First action' })
    const second = makeControl(115, { label: 'Second action' })
    const common = { logicalSeed: 116, templateSeed: 117 }
    const closed = makeComposite(118, [placedControl(first, 8), placedControl(second, 56)], {
      ...common, state: 'default'
    })
    const expanded = makeComposite(119, [placedControl(first, 8), placedControl(second, 56)], {
      ...common, state: 'expanded', backgroundAlpha: 0.9
    })
    const scan = makeScan({ controls: [first, second], composites: [closed, expanded] })
    const controls = createControlImportPlan(scan, [], [])
    const family = createCompositeImportPlan(scan, controls, []).groups
      .find(group => group.entries.length === 2)

    expect(family?.entries.map(entry => entry.source.children.map(child => child.kind)))
      .toEqual([['control', 'control'], ['control', 'control']])
    expect(family?.kind).toBe('component_set')
  })

  it('creates unique reusable ownership for every published family', () => {
    const controls = [
      makeControl(121, { label: 'First action' }),
      makeControl(122, { label: 'Second action', leadingIcon: true })
    ]
    const plan = createControlImportPlan(makeScan({ controls }), [], [])
    const keys = plan.groups.map(group => group.groupOwnershipId)

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every(Boolean)).toBe(true)
  })
})
