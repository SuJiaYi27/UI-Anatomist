import { describe, expect, it } from 'vitest'

import { planCompositeLayout } from '../../src/figma/composite-layout'
import type { CompositeToken } from '../../src/shared/schema'

const id = (character: string) => `sha256:${character.repeat(64)}`

function token(
  placements: Array<{ x: number; y: number; width: number; height: number } | undefined>,
  overrides: Partial<Pick<CompositeToken, 'geometry' | 'layout'>> = {}
): CompositeToken {
  return {
    id: id('1'),
    templateId: id('2'),
    logicalCompositeId: id('3'),
    name: 'menu-vertical',
    kind: 'menu',
    state: 'default',
    geometry: overrides.geometry ?? {
      width: 244,
      height: 100,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 4,
      radius: 12,
      borderWidth: 1
    },
    appearance: {
      background: { r: 1, g: 1, b: 1, a: 1 },
      foreground: { r: 0, g: 0, b: 0, a: 1 },
      border: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    layout: overrides.layout ?? {
      direction: 'vertical', align: 'stretch', justify: 'start',
      wrap: false, widthBehavior: 'hug'
    },
    children: placements.map((placement, index) => ({
      kind: 'control' as const,
      controlId: id(index === 0 ? '4' : '5'),
      instanceId: id(index === 0 ? '6' : '7'),
      state: 'default' as const,
      ...(placement ? { placement } : {})
    })),
    occurrences: 1,
    stateOccurrences: 1
  }
}

describe('planCompositeLayout', () => {
  it('uses measured Auto Layout for a regular vertical stack', () => {
    expect(planCompositeLayout(token([
      { x: 8, y: 8, width: 228, height: 40 },
      { x: 8, y: 52, width: 228, height: 40 }
    ]))).toEqual({
      mode: 'auto',
      direction: 'vertical',
      align: 'stretch',
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 4,
      children: [
        { x: 8, y: 8, width: 228, height: 40 },
        { x: 8, y: 52, width: 228, height: 40 }
      ]
    })
  })

  it('uses measured Auto Layout for regular horizontal tabs', () => {
    const layout = planCompositeLayout(token([
      { x: 0, y: 0, width: 96, height: 40 },
      { x: 104, y: 0, width: 96, height: 40 }
    ], {
      geometry: {
        width: 200, height: 40,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 8, radius: 0, borderWidth: 0
      },
      layout: {
        direction: 'horizontal', align: 'stretch', justify: 'start',
        wrap: false, widthBehavior: 'hug'
      }
    }))

    expect(layout).toMatchObject({
      mode: 'auto', direction: 'horizontal', align: 'stretch', gap: 8
    })
  })

  it('uses fixed placement when one shared gap cannot explain the evidence', () => {
    expect(planCompositeLayout(token([
      { x: 8, y: 8, width: 228, height: 40 },
      { x: 8, y: 80, width: 228, height: 40 }
    ], {
      geometry: {
        width: 244, height: 140,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 4, radius: 12, borderWidth: 1
      }
    }))).toMatchObject({
      mode: 'fixed',
      children: [
        { x: 8, y: 8, width: 228, height: 40 },
        { x: 8, y: 80, width: 228, height: 40 }
      ]
    })
  })

  it('keeps partial or absent placement on the guarded legacy path', () => {
    expect(planCompositeLayout(token([
      { x: 8, y: 8, width: 228, height: 40 },
      undefined
    ]))).toEqual({ mode: 'legacy' })
    expect(planCompositeLayout(token([undefined, undefined])))
      .toEqual({ mode: 'legacy' })
  })
})
