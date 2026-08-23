import { describe, expect, it } from 'vitest'

import { parseScanExport } from '../../src/figma/import-plan'
import { createControlImportPlan } from '../../src/figma/control-import-plan'
import { createIconImportPlan } from '../../src/figma/icon-import-plan'
import { createCompositeImportPlan } from '../../src/figma/composite-import-plan'
import {
  makeComposite,
  makeControl,
  makeIcon,
  makeScan,
  placedControl,
  stableId
} from '../fixtures/anonymous-regression'

describe('anonymous diagnostics regression', () => {
  it('validates diagnostics but strips them before the Figma import plan', () => {
    const control = makeControl(110, { label: 'Open details' })
    const scan = makeScan({ controls: [control] })
    scan.schemaVersion = '1.11.0'
    scan.diagnostics = {
      disclosures: [],
      controls: [{
        candidateId: stableId(111),
        family: 'button',
        stage: 'rejected-private-context',
        occurrences: 1
      }],
      composites: []
    }

    const parsed = parseScanExport(JSON.stringify(scan))

    expect('diagnostics' in parsed).toBe(false)
    expect(parsed.schemaVersion).toBe('1.10.0')
    expect(parsed.controls).toHaveLength(1)
    expect(JSON.stringify(parsed)).not.toMatch(/private|account|token/i)
  })

  it('creates only one import group for one reusable state family', () => {
    const common = { logicalSeed: 123, instanceSeed: 124, templateSeed: 125 }
    const controls = [
      makeControl(126, { ...common, state: 'default' }),
      makeControl(127, { ...common, state: 'expanded' })
    ]
    const plan = createControlImportPlan(makeScan({ controls }), [], [])

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.entries.map(entry => entry.source.state)).toEqual([
      'default', 'expanded'
    ])
  })

  it('sanitizes an untrusted accessible icon name at the Figma boundary', () => {
    const icon = makeIcon(128, 'Star owner/project 184.2k')
    const entry = createIconImportPlan(makeScan({ icons: [icon] }), []).entries[0]

    expect(entry?.source.name).toMatch(/^icon-[0-9a-f]{6}$/)
    expect(entry?.source.nameSource).toBe('geometry')
    expect(JSON.stringify(entry)).not.toContain('Star owner/project 184.2k')
  })

  it('filters an incomplete list while retaining a complete surfaced popover', () => {
    const first = makeControl(129, { label: 'First action' })
    const second = makeControl(132, { label: 'Second action' })
    const complete = makeComposite(133, [placedControl(first, 8), placedControl(second, 56)])
    const incomplete = makeComposite(134, [placedControl(first, 8), placedControl(second, 56)], {
      kind: 'list', height: 240
    })
    const scan = makeScan({ controls: [first, second], composites: [complete, incomplete] })
    const controls = createControlImportPlan(scan, [], [])
    const ids = createCompositeImportPlan(scan, controls, [])
      .groups.flatMap(group => group.entries.map(entry => entry.source.id))

    expect(ids).toContain(complete.id)
    expect(ids).not.toContain(incomplete.id)
  })
})
