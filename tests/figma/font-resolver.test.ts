import { describe, expect, it } from 'vitest'

import { resolveFont } from '../../src/figma/font-resolver'

const fonts = [
  { family: 'SF Pro', style: 'Regular' },
  { family: 'SF Pro', style: 'Semibold' },
  { family: 'SF Pro Text', style: 'Regular' },
  { family: 'SF Pro Text', style: 'Medium' },
  { family: 'SF Pro Text', style: 'Semibold' },
  { family: 'Inter', style: 'Regular' },
  { family: 'Inter', style: 'Italic' },
  { family: 'JetBrains Mono', style: 'Regular' }
]

describe('resolveFont', () => {
  it('uses the first available family declared by the page', () => {
    expect(resolveFont(['Missing Sans', 'Inter', 'sans-serif'], 400, 'normal', fonts)).toEqual({
      family: 'Inter',
      style: 'Regular'
    })
  })

  it('maps a declared system family to the native macOS UI font', () => {
    expect(resolveFont(['system-ui', 'sans-serif'], 600, 'normal', fonts, 'mac')).toEqual({
      family: 'SF Pro',
      style: 'Semibold'
    })
  })

  it('matches italic without changing to an unrelated family', () => {
    expect(resolveFont(['Inter', 'sans-serif'], 400, 'italic', fonts)).toEqual({
      family: 'Inter',
      style: 'Italic'
    })
  })

  it('returns null when none of the declared families are installed', () => {
    expect(resolveFont(['Unavailable Family'], 400, 'normal', fonts)).toBeNull()
  })

  it('does not silently substitute a generic family that is not installed', () => {
    expect(resolveFont(['ui-monospace'], 400, 'normal', fonts, 'mac')).toBeNull()
  })
})
