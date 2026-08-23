export type AvailableFontName = {
  family: string
  style: string
}

type Platform = 'mac' | 'windows' | 'other'

const MAC_SYSTEM_FAMILIES = ['SF Pro', 'SF Pro Text', 'SF Pro Display']
const WINDOWS_SYSTEM_FAMILIES = ['Segoe UI']

function normalize(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

function normalizedPlatform(value?: string): Platform {
  const platform = (value ?? '').toLowerCase()
  if (platform.includes('mac')) return 'mac'
  if (platform.includes('win')) return 'windows'
  return 'other'
}

function isSystemSansFamily(family: string): boolean {
  return [
    '-apple-system',
    '-apple-system-body',
    'blinkmacsystemfont',
    'system-ui',
    'ui-sans-serif'
  ].includes(normalize(family))
}

function mappedFamilies(family: string, platform?: string): string[] {
  if (!isSystemSansFamily(family)) return [family]
  const currentPlatform = normalizedPlatform(platform)
  if (currentPlatform === 'mac') return MAC_SYSTEM_FAMILIES
  if (currentPlatform === 'windows') return WINDOWS_SYSTEM_FAMILIES
  return []
}

function baseStyleCandidates(weight: number): string[] {
  if (weight >= 750) return ['Extra Bold', 'Extrabold', 'Heavy', 'Black', 'Bold']
  if (weight >= 650) return ['Bold', 'Semi Bold', 'Semibold', 'Demi Bold', 'DemiBold']
  if (weight >= 550) return ['Semi Bold', 'Semibold', 'Demi Bold', 'DemiBold', 'Medium']
  if (weight >= 450) return ['Medium', 'Regular', 'Book']
  if (weight >= 350) return ['Regular', 'Book', 'Normal']
  if (weight >= 250) return ['Light', 'Thin', 'Regular']
  return ['Thin', 'Hairline', 'Light']
}

function styleCandidates(weight: number, fontStyle: string): string[] {
  const base = baseStyleCandidates(weight)
  const italic = fontStyle === 'italic' || fontStyle === 'oblique'
  if (!italic) return base
  return base.flatMap(style => [
    style === 'Regular' ? 'Italic' : `${style} Italic`,
    style === 'Regular' ? 'Oblique' : `${style} Oblique`
  ])
}

export function resolveFont(
  fontFamilyStack: string[],
  fontWeight: number,
  fontStyle: string,
  availableFonts: AvailableFontName[],
  platform?: string
): AvailableFontName | null {
  const styles = styleCandidates(fontWeight, fontStyle)

  for (const declaredFamily of fontFamilyStack) {
    for (const candidateFamily of mappedFamilies(declaredFamily, platform)) {
      const familyFonts = availableFonts.filter(
        font => normalize(font.family) === normalize(candidateFamily)
      )
      for (const candidateStyle of styles) {
        const match = familyFonts.find(font => normalize(font.style) === normalize(candidateStyle))
        if (match) return match
      }
    }
  }

  return null
}
