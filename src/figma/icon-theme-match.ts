import type { ColorValue, IconTheme, IconToken } from '../shared/schema'

function luminance(value: ColorValue): number {
  return 0.2126 * value.r + 0.7152 * value.g + 0.0722 * value.b
}

const DRAWABLE_ELEMENT =
  /<(?:path|line|polyline|polygon|circle|rect|ellipse)\b([^>]*)>/gi

function attributesFrom(source: string): Map<string, string> {
  const values = new Map<string, string>()
  const pattern =
    /(?:^|\s)([a-z][a-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    values.set(
      match[1]!.toLowerCase(),
      (match[2] ?? match[3] ?? match[4] ?? '').trim().toLowerCase()
    )
  }
  const style = values.get('style')
  if (style) {
    for (const declaration of style.split(';')) {
      const separator = declaration.indexOf(':')
      if (separator <= 0) continue
      values.set(
        declaration.slice(0, separator).trim().toLowerCase(),
        declaration.slice(separator + 1).trim().toLowerCase()
      )
    }
  }
  return values
}

function paintSignatures(vectorSvg: string): string[] {
  const rootAttributes = attributesFrom(
    vectorSvg.match(/<svg\b([^>]*)>/i)?.[1] ?? ''
  )
  const rootValue = (name: string, fallback: string): string =>
    rootAttributes.get(name) ?? fallback
  const signatures: string[] = []
  let match: RegExpExecArray | null
  DRAWABLE_ELEMENT.lastIndex = 0
  while ((match = DRAWABLE_ELEMENT.exec(vectorSvg))) {
    const attributes = attributesFrom(match[1] ?? '')
    const value = (name: string, fallback: string): string =>
      attributes.get(name) ?? rootValue(name, fallback)
    signatures.push([
      `fill:${value('fill', 'currentcolor')}`,
      `stroke:${value('stroke', 'none')}`,
      `opacity:${value('opacity', '1')}`,
      `fill-opacity:${value('fill-opacity', '1')}`,
      `stroke-opacity:${value('stroke-opacity', '1')}`
    ].join('|'))
  }
  return signatures
}

export function canReuseIconComponentInControl(icon: IconToken): boolean {
  const signatures = paintSignatures(icon.vectorSvg)
  return signatures.length <= 1 || new Set(signatures).size === 1
}

export function iconThemeForForeground(
  icon: IconToken,
  foreground: ColorValue
): IconTheme | null {
  const inferredTheme: IconTheme = luminance(foreground) < 0.5
    ? 'light'
    : 'dark'
  return icon.themes.find(theme => theme.theme === inferredTheme)?.theme ??
    icon.themes[0]?.theme ?? null
}
