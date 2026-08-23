import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  new URL('../../src/chrome/popup/popup.css', import.meta.url),
  'utf8'
)

describe('Chrome popup UI redesign', () => {
  it('uses the white Chrome canvas background from Figma', () => {
    expect(css).toMatch(/:root\s*{[^}]*background:\s*#fff(?:fff)?;/s)
  })

  it('uses the updated Ready action spacing from Figma', () => {
    expect(css).toMatch(/\.actions\s*{[^}]*margin-top:\s*12px;/s)
    expect(css).toMatch(/\.actions\s*{[^}]*gap:\s*8px;/s)
  })

  it('uses a sixteen-pixel Ready spacer below the header', () => {
    expect(css).toMatch(
      /main:has\(#ready-actions:not\(\[hidden\]\)\)\s+header\s*{[^}]*margin-bottom:\s*16px;/s
    )
  })

  it('matches the exact Figma typography and control heights', () => {
    expect(css).toMatch(/\.eyebrow\s*{[^}]*line-height:\s*12px;/s)
    expect(css).toMatch(/h1\s*{[^}]*line-height:\s*29px;/s)
    expect(css).toMatch(/button\s*{[^}]*height:\s*40px;/s)
    expect(css).toMatch(/button\s*{[^}]*line-height:\s*17px;/s)
  })

  it('keeps the Ready popup at its designed height', () => {
    expect(css).toMatch(
      /main:has\(#ready-actions:not\(\[hidden\]\)\)\s*{[^}]*height:\s*386px;/s
    )
  })

  it('does not apply hover feedback to the disabled Unavailable action', () => {
    expect(css).toMatch(/button:disabled\s*{[^}]*cursor:\s*default;/s)
    expect(css).toMatch(/\.primary:not\(:disabled\):hover\s*{[^}]*background:\s*#30302e;/s)
    expect(css).toMatch(/\.secondary:not\(:disabled\):hover\s*{[^}]*background:\s*#f0f0ed;/s)
  })
})
