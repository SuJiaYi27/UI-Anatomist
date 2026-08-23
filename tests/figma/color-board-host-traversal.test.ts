import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('color board host traversal', () => {
  it('only inspects top-level page children when finding board obstacles', () => {
    const source = readFileSync(
      new URL('../../src/figma/color-board-builder.ts', import.meta.url),
      'utf8'
    )

    expect(source).not.toContain('figma.currentPage.findAll(')
    expect(source).toContain('figma.currentPage.children.filter(')
  })
})
