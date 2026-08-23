import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Figma annotation font wiring', () => {
  it('uses one shared CJK-first resolver in every board with plugin-owned captions', () => {
    const files = [
      '../../src/figma/control-board-builder.ts',
      '../../src/figma/control-master-board-builder.ts',
      '../../src/figma/color-board-builder.ts',
      '../../src/figma/icon-board-builder.ts'
    ]
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).toContain('resolveAnnotationFonts')
      expect(source).not.toContain("resolveFont(['Inter']")
    }
  })

  it('keeps module headings in English while localizing color-board details', () => {
    const source = readFileSync(
      new URL('../../src/figma/color-board-builder.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain("addBoardHeader(board, 'Primitives'")
    expect(source).toContain("addBoardHeader(board, 'Semantic Colors'")
    expect(source).toContain("addBoardHeader(board, 'Interactive Colors'")
    expect(source).toContain('未发现已确认的颜色')
    expect(source).not.toContain('No confirmed colors found')
  })
})
