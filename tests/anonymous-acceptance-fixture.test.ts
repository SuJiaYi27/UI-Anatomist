import { describe, expect, it } from 'vitest'

import { parseScanExport } from '../src/figma/import-plan'
import { ScanExportSchema } from '../src/shared/schema'
import {
  makeComposite,
  makeControl,
  makeIcon,
  makeScan,
  placedControl,
  PUBLIC_TEST_ORIGIN
} from './fixtures/anonymous-regression'

describe('anonymous public acceptance fixture', () => {
  it('is schema-valid, origin-only, reference-complete, and importable', () => {
    const control = makeControl(1, { leadingIcon: true, label: 'Open menu' })
    const fixture = makeScan({
      controls: [control],
      icons: [makeIcon(2)],
      composites: [makeComposite(3, [placedControl(control, 8)], { height: 56 })]
    })
    const raw = JSON.stringify(fixture)
    const parsed = ScanExportSchema.parse(JSON.parse(raw))

    expect(parseScanExport(raw)).toEqual(parsed)
    expect(parsed.source.origin).toBe(PUBLIC_TEST_ORIGIN)
    expect(parsed.composites[0]?.children[0]).toMatchObject({
      kind: 'control',
      controlId: control.id,
      instanceId: control.instanceId
    })
    expect(raw).not.toMatch(/openai|chatgpt|github/i)
    expect(raw).not.toContain(['', 'Users', ''].join('/'))
    expect(raw).not.toContain(['.codex', ''].join('/'))
  })
})
