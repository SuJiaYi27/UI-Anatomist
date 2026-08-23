import { describe, expect, it } from 'vitest'
import {
  canReuseIconComponentInControl,
  iconThemeForForeground
} from '../../src/figma/icon-theme-match'
import type { IconToken } from '../../src/shared/schema'

function icon(): IconToken {
  return {
    id: `sha256:${'1'.repeat(64)}`,
    name: 'sample',
    category: 'action',
    vectorSvg: '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
    observedSizes: [{ width: 24, height: 24, occurrences: 1 }],
    themes: [
      {
        theme: 'light',
        color: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        occurrences: 2
      },
      {
        theme: 'dark',
        color: { r: 0.95, g: 0.95, b: 0.95, a: 1 },
        occurrences: 2
      }
    ],
    occurrences: 4
  }
}

describe('iconThemeForForeground', () => {
  it('selects the light token mode for a dark control foreground', () => {
    expect(iconThemeForForeground(
      icon(),
      { r: 0.05, g: 0.05, b: 0.05, a: 1 }
    )).toBe('light')
  })

  it('selects the dark token mode for a light control foreground', () => {
    expect(iconThemeForForeground(
      icon(),
      { r: 0.95, g: 0.95, b: 0.95, a: 1 }
    )).toBe('dark')
  })

  it('uses the light token mode when a dark control foreground differs from the icon token color', () => {
    expect(iconThemeForForeground(
      icon(),
      { r: 0.2, g: 0.45, b: 0.9, a: 1 }
    )).toBe('light')
  })

  it('uses the only observed token mode when the control foreground differs', () => {
    expect(iconThemeForForeground(
      {
        ...icon(),
        themes: [icon().themes[0]!]
      },
      { r: 0.12, g: 0.14, b: 0.16, a: 1 }
    )).toBe('light')
  })

  it('allows a token with surface evidence when the caller selects its glyph master', () => {
    expect(canReuseIconComponentInControl(icon())).toBe(true)
    expect(canReuseIconComponentInControl({
      ...icon(),
      interactionSurfaces: [{
        state: 'default',
        theme: 'dark',
        background: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        width: 50,
        height: 50,
        radii: {
          topLeft: 25,
          topRight: 25,
          bottomRight: 25,
          bottomLeft: 25
        },
        occurrences: 2
      }]
    })).toBe(true)
  })

  it('keeps layered keycap paint intact by using the raw SVG fallback', () => {
    expect(canReuseIconComponentInControl({
      ...icon(),
      vectorSvg: [
        '<svg viewBox="0 0 22 20">',
        '<path fill="none" stroke="currentColor" opacity="0.4" d="M5 1h12a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4Z"/>',
        '<path fill="currentColor" d="m13.5 5-5 10h-2l5-10Z"/>',
        '</svg>'
      ].join('')
    })).toBe(false)
  })

  it('still reuses uniform multi-path glyphs', () => {
    expect(canReuseIconComponentInControl({
      ...icon(),
      vectorSvg: [
        '<svg viewBox="0 0 24 24" fill="currentColor">',
        '<path d="M2 2h8v8H2z"/>',
        '<path d="M14 14h8v8h-8z"/>',
        '</svg>'
      ].join('')
    })).toBe(true)
  })
})
