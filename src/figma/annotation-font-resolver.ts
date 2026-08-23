import type { AvailableFontName } from './font-resolver'
import { resolveFont } from './font-resolver'

export type AnnotationFonts = {
  regular: AvailableFontName
  medium: AvailableFontName
  semibold: AvailableFontName
}

const ANNOTATION_FAMILY_ORDER = [
  'PingFang SC',
  '苹方-简',
  'Noto Sans CJK SC',
  'Noto Sans SC',
  'Source Han Sans SC',
  'Microsoft YaHei',
  'Inter'
] as const

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function preferredFamily(
  availableFonts: AvailableFontName[]
): AvailableFontName[] {
  for (const preferred of ANNOTATION_FAMILY_ORDER) {
    const matching = availableFonts.filter(
      font => normalize(font.family) === normalize(preferred)
    )
    if (matching.length > 0) return matching
  }
  return availableFonts
}

function fallbackRegular(fonts: AvailableFontName[]): AvailableFontName {
  return fonts.find(font => /regular|book|normal/i.test(font.style))
    ?? fonts[0]!
}

export function resolveAnnotationFonts(
  availableFonts: AvailableFontName[],
  unavailableMessage: string
): AnnotationFonts {
  if (availableFonts.length === 0) throw new Error(unavailableMessage)
  const familyFonts = preferredFamily(availableFonts)
  const family = familyFonts[0]!.family
  const regular = resolveFont([family], 400, 'normal', familyFonts)
    ?? fallbackRegular(familyFonts)
  const medium = resolveFont([family], 500, 'normal', familyFonts) ?? regular
  const semibold = resolveFont([family], 600, 'normal', familyFonts) ?? medium
  return { regular, medium, semibold }
}
