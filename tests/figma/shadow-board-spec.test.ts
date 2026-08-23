import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { ShadowToken } from '../../src/shared/schema'
import {
  SHADOW_BOARD_SPEC,
  layoutShadowCells,
  shadowSpecimenFill,
  shadowTokenLabel,
  shadowVisualInsets
} from '../../src/figma/shadow-board-spec'

const token: ShadowToken = {
  id: `sha256:${'a'.repeat(64)}`,
  name: 'shadow-multi-2-aaaaaa',
  layers: [
    {
      kind: 'outer', offsetX: 0, offsetY: 4, blur: 12, spread: -1,
      color: { r: 0, g: 0, b: 0, a: 0.15 }
    },
    {
      kind: 'inner', offsetX: 1, offsetY: -1, blur: 0, spread: 0,
      color: { r: 1, g: 1, b: 1, a: 0.8 }
    }
  ],
  occurrences: 3
}

describe('teacher-aligned Shadows board specification', () => {
  it('keeps the measured teacher geometry', () => {
    expect(SHADOW_BOARD_SPEC).toEqual({
      width: 1513,
      baselineHeight: 213,
      padding: 40,
      titleFontSize: 24,
      titleLineHeight: 29,
      rowStartY: 93,
      rowGap: 24,
      cellGap: 24,
      sampleWidth: 80,
      sampleHeight: 60,
      labelGap: 8,
      labelFontSize: 10,
      labelLineHeight: 12,
      cornerRadius: 8
    })
  })

  it('reproduces the teacher eleven-item horizontal row exactly', () => {
    const teacherWidths = [82, 80, 83, 82, 80, 80, 80, 136, 196, 117, 177]
    const layout = layoutShadowCells(teacherWidths.map(labelWidth => ({
      labelWidth,
      labelHeight: 12
    })))

    expect(layout.rows).toBe(1)
    expect(layout.boardHeight).toBe(213)
    expect(layout.cells[0]).toMatchObject({
      x: 40,
      y: 93,
      width: 82,
      height: 80,
      sampleX: 1,
      sampleY: 0,
      labelY: 68
    })
    expect(layout.cells.at(-1)).toMatchObject({
      x: 1296,
      y: 93,
      width: 177,
      height: 80,
      sampleX: 48.5,
      sampleY: 0,
      labelY: 68
    })
  })

  it('keeps the current three shadows compact instead of stretching equal columns', () => {
    const layout = layoutShadowCells([
      { labelWidth: 165, labelHeight: 12 },
      { labelWidth: 228, labelHeight: 12 },
      { labelWidth: 325, labelHeight: 12 }
    ])

    expect(layout.rows).toBe(1)
    expect(layout.boardHeight).toBe(213)
    expect(layout.cells).toEqual([
      {
        x: 40, y: 93, width: 165, height: 80,
        sampleX: 42.5, sampleY: 0, labelY: 68
      },
      {
        x: 229, y: 93, width: 228, height: 80,
        sampleX: 74, sampleY: 0, labelY: 68
      },
      {
        x: 481, y: 93, width: 325, height: 80,
        sampleX: 122.5, sampleY: 0, labelY: 68
      }
    ])
  })

  it('wraps only when the teacher row no longer fits', () => {
    const teacherWidths = [82, 80, 83, 82, 80, 80, 80, 136, 196, 117, 177]
    const layout = layoutShadowCells([
      ...teacherWidths.map(labelWidth => ({ labelWidth, labelHeight: 12 })),
      { labelWidth: 80, labelHeight: 12 }
    ])

    expect(layout.rows).toBe(2)
    expect(layout.cells.at(-1)).toMatchObject({
      x: 40,
      y: 197,
      width: 80,
      height: 80,
      sampleX: 0,
      sampleY: 0,
      labelY: 68
    })
    expect(layout.boardHeight).toBe(317)
  })

  it('identifies the exact token and its combined layer parameters', () => {
    expect(shadowTokenLabel(token)).toBe(
      'shadow-multi-2-aaaaaa\n完整 token · 混合阴影 · 2 层叠加 · 1:0/4/12/-1/a0.15 · 2:1/-1/0/0/a0.8'
    )
    const source = readFileSync(
      new URL('../../src/figma/shadow-board-builder.ts', import.meta.url),
      'utf8'
    )
    expect(source).not.toContain('Layer details')
    expect(source).not.toContain('shadowLayerDetail')
    expect(source).toContain("board.name = 'UI-Anatomist / 阴影'")
    expect(source).toContain("'未发现可见阴影'")
  })

  it('uses a tinted inspection surface for inner shadows only', () => {
    expect(shadowSpecimenFill(token)).toEqual({
      r: 0.94, g: 0.95, b: 0.97, a: 1
    })
    expect(shadowSpecimenFill({
      ...token,
      layers: token.layers.filter(layer => layer.kind === 'outer')
    })).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  it('clamps an exceptional long name to the row width and grows its row safely', () => {
    const layout = layoutShadowCells([
      { labelWidth: 10_000, labelHeight: 36 },
      { labelWidth: 80, labelHeight: 12 }
    ])

    expect(layout.cells[0]).toMatchObject({
      x: 40,
      y: 93,
      width: 1433,
      height: 104,
      sampleX: 676.5,
      sampleY: 0,
      labelY: 68
    })
    expect(layout.cells[1]).toMatchObject({ x: 40, y: 221 })
    expect(layout.boardHeight).toBe(341)
  })

  it('measures conservative four-edge shadow overflow for the global board gate', () => {
    const visualToken: ShadowToken = {
      ...token,
      layers: [
        {
          kind: 'outer',
          offsetX: 12,
          offsetY: -8,
          blur: 20,
          spread: 4,
          color: { r: 0, g: 0, b: 0, a: 0.2 }
        },
        {
          kind: 'outer',
          offsetX: -30,
          offsetY: 20,
          blur: 5,
          spread: 3,
          color: { r: 0, g: 0, b: 0, a: 0.15 }
        },
        {
          kind: 'inner',
          offsetX: 200,
          offsetY: 200,
          blur: 100,
          spread: 100,
          color: { r: 0, g: 0, b: 0, a: 0.8 }
        }
      ]
    }

    expect(shadowVisualInsets(visualToken)).toEqual({
      left: 38,
      top: 32,
      right: 36,
      bottom: 28
    })
  })

  it('keeps an explicit empty-state board without inventing a shadow', () => {
    expect(layoutShadowCells([])).toEqual({
      cells: [],
      rows: 0,
      boardHeight: 213
    })
  })

  it('builds the teacher-style shadows container and centered labels', () => {
    const source = readFileSync(
      new URL('../../src/figma/shadow-board-builder.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain("items.name = 'shadows'")
    expect(source).toContain('nodes.label.textAlignHorizontal')
    expect(source).toContain('nodes.sample.x = position.sampleX')
    expect(source).toContain('nodes.label.y = position.labelY')
  })

  it('keeps the teacher board geometry instead of expanding it for intentional effect overflow', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('.filter(board => board !== shadowBoard)')
  })
})
