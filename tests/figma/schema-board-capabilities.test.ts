import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  supportsFigmaBoardCapability,
  type FigmaBoardCapability
} from '../../src/figma/schema-board-capabilities'

const capabilities: FigmaBoardCapability[] = [
  'colors',
  'spacing',
  'controls',
  'icons'
]

describe('Figma schema board capabilities', () => {
  it('inherits each board capability from the schema version that introduced it', () => {
    const supported = (schemaVersion: string): FigmaBoardCapability[] =>
      capabilities.filter(capability =>
        supportsFigmaBoardCapability(schemaVersion, capability)
      )

    expect(supported('1.2.0')).toEqual([])
    expect(supported('1.3.0')).toEqual(['colors'])
    expect(supported('1.4.0')).toEqual(['colors', 'spacing'])
    expect(supported('1.5.0')).toEqual(['colors', 'spacing', 'controls'])
    expect(supported('1.8.0')).toEqual(capabilities)
    expect(supported('1.10.0')).toEqual(capabilities)
    expect(supported('1.11.0')).toEqual(capabilities)
    expect(supported('1.12.0')).toEqual(capabilities)
  })

  it('uses the shared capability result at every version-gated board entry', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )

    for (const capability of capabilities) {
      expect(source).toMatch(
        new RegExp(
          `supportsFigmaBoardCapability\\(\\s*data\\.schemaVersion,\\s*'${capability}'\\s*\\)`
        )
      )
    }
  })
})
