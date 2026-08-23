export type FigmaBoardCapability =
  | 'colors'
  | 'spacing'
  | 'controls'
  | 'icons'

type SemanticVersion = readonly [major: number, minor: number, patch: number]

const INTRODUCED_IN: Record<FigmaBoardCapability, SemanticVersion> = {
  colors: [1, 3, 0],
  spacing: [1, 4, 0],
  controls: [1, 5, 0],
  icons: [1, 8, 0]
}

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return null

  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isAtLeast(
  candidate: SemanticVersion,
  minimum: SemanticVersion
): boolean {
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== minimum[index]) {
      return candidate[index] > minimum[index]
    }
  }
  return true
}

export function supportsFigmaBoardCapability(
  schemaVersion: string,
  capability: FigmaBoardCapability
): boolean {
  const parsed = parseSemanticVersion(schemaVersion)
  return parsed !== null && isAtLeast(parsed, INTRODUCED_IN[capability])
}
