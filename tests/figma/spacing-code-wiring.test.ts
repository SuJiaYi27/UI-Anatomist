import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Figma spacing transaction wiring', () => {
  it('plans, applies, builds, reports and cleans spacing in the unified import', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('createSpacingImportPlan')
    expect(source).toContain('applySpacingImportPlan')
    expect(source).toContain('buildSpacingBoard')
    expect(source).toContain('spacingCreated:')
    expect(source).toContain('spacingRemoved:')
    expect(source).toContain('spacing: spacingBoard')
    expect(source).toMatch(
      /supportsFigmaBoardCapability\(\s*data\.schemaVersion,\s*'spacing'\s*\)/
    )
  })
})
