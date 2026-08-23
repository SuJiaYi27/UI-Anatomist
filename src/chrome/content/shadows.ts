import type { ShadowLayer, ShadowToken } from '../../shared/schema'
import { stableShadowId, type ShadowSignature } from '../../shared/stable-id'
import { isExcludedStyleAssetSurface } from './visual-assets'

const lengthPattern = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:px)?$/i

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

export function splitShadowList(raw: string): string[] {
  const values: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (character === '(') depth += 1
    if (character === ')') depth = Math.max(0, depth - 1)
    if (character === ',' && depth === 0) {
      const value = raw.slice(start, index).trim()
      if (value) values.push(value)
      start = index + 1
    }
  }
  const tail = raw.slice(start).trim()
  if (tail) values.push(tail)
  return values
}

function splitTopLevelWhitespace(raw: string): string[] {
  const values: string[] = []
  let depth = 0
  let start = -1
  for (let index = 0; index <= raw.length; index += 1) {
    const character = raw[index] ?? ' '
    if (character === '(') depth += 1
    if (character === ')') depth = Math.max(0, depth - 1)
    const separator = /\s/.test(character) && depth === 0
    if (!separator && start < 0) start = index
    if (separator && start >= 0) {
      values.push(raw.slice(start, index))
      start = -1
    }
  }
  return values
}

function channel(raw: string): number | null {
  const value = raw.trim()
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return null
  return normalizedNumber(value.endsWith('%') ? numeric / 100 : numeric / 255)
}

function alpha(raw: string | undefined): number | null {
  if (raw === undefined) return 1
  const value = raw.trim()
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return null
  return normalizedNumber(value.endsWith('%') ? numeric / 100 : numeric)
}

function parseHexColor(raw: string): ShadowLayer['color'] | null {
  const value = raw.slice(1)
  if (![3, 4, 6, 8].includes(value.length) || !/^[0-9a-f]+$/i.test(value)) return null
  const expanded = value.length <= 4
    ? value.split('').map(character => character + character).join('')
    : value
  const r = Number.parseInt(expanded.slice(0, 2), 16) / 255
  const g = Number.parseInt(expanded.slice(2, 4), 16) / 255
  const b = Number.parseInt(expanded.slice(4, 6), 16) / 255
  const a = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
  return {
    r: normalizedNumber(r),
    g: normalizedNumber(g),
    b: normalizedNumber(b),
    a: normalizedNumber(a)
  }
}

function parseFunctionalColor(raw: string): ShadowLayer['color'] | null {
  const match = /^(rgba?|color)\((.*)\)$/i.exec(raw.trim())
  if (!match) return null
  const functionName = match[1]
  const matchedContent = match[2]
  if (!functionName || matchedContent === undefined) return null
  let content = matchedContent.trim()
  if (functionName.toLowerCase() === 'color') {
    content = content.replace(/^srgb\s+/i, '')
  }
  const slashParts = content.split('/').map(value => value.trim())
  const beforeSlash = (slashParts[0] ?? '').replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  const alphaPart = slashParts[1] ?? (beforeSlash.length === 4 ? beforeSlash.pop() : undefined)
  if (beforeSlash.length !== 3) return null
  const isSrgbColor = functionName.toLowerCase() === 'color'
  const channels = beforeSlash.map(value => isSrgbColor
    ? normalizedNumber(Number.parseFloat(value))
    : channel(value))
  const opacity = alpha(alphaPart)
  const [r, g, b] = channels
  if (r === null || r === undefined || g === null || g === undefined ||
      b === null || b === undefined || opacity === null) return null
  if ([r, g, b, opacity].some(value => value < 0 || value > 1)) return null
  return { r, g, b, a: opacity }
}

function parseColor(raw: string): ShadowLayer['color'] | null {
  const value = raw.trim().toLowerCase()
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (value === 'black') return { r: 0, g: 0, b: 0, a: 1 }
  if (value === 'white') return { r: 1, g: 1, b: 1, a: 1 }
  if (value.startsWith('#')) return parseHexColor(value)
  return parseFunctionalColor(value)
}

function parseLength(raw: string): number | null {
  const match = lengthPattern.exec(raw.trim())
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? normalizedNumber(value) : null
}

function visibleLayer(layer: ShadowLayer): boolean {
  return layer.color.a > 0 && (
    layer.offsetX !== 0 || layer.offsetY !== 0 || layer.blur !== 0 || layer.spread !== 0
  )
}

function parseShadowItem(
  raw: string,
  mode: 'box' | 'text' | 'filter'
): ShadowLayer | null {
  const tokens = splitTopLevelWhitespace(raw)
  let kind: ShadowLayer['kind'] = 'outer'
  let color: ShadowLayer['color'] | null = null
  const lengths: number[] = []

  for (const token of tokens) {
    if (token.toLowerCase() === 'inset' && mode === 'box') {
      kind = 'inner'
      continue
    }
    const parsedColor = parseColor(token)
    if (parsedColor) {
      color = parsedColor
      continue
    }
    const parsedLength = parseLength(token)
    if (parsedLength !== null) lengths.push(parsedLength)
  }

  const maximumLengths = mode === 'box' ? 4 : 3
  if (!color || lengths.length < 2 || lengths.length > maximumLengths) return null
  const offsetX = lengths[0]
  const offsetY = lengths[1]
  if (offsetX === undefined || offsetY === undefined) return null
  const layer: ShadowLayer = {
    kind,
    offsetX,
    offsetY,
    blur: lengths[2] ?? 0,
    spread: mode === 'box' ? lengths[3] ?? 0 : 0,
    color
  }
  if (layer.blur < 0 || !visibleLayer(layer)) return null
  return layer
}

export function parseBoxShadow(raw: string): ShadowLayer[] {
  if (!raw || raw.trim().toLowerCase() === 'none') return []
  return splitShadowList(raw).flatMap(value => {
    const layer = parseShadowItem(value, 'box')
    return layer ? [layer] : []
  })
}

export function parseTextShadow(raw: string): ShadowLayer[] {
  if (!raw || raw.trim().toLowerCase() === 'none') return []
  return splitShadowList(raw).flatMap(value => {
    const layer = parseShadowItem(value, 'text')
    return layer ? [layer] : []
  })
}

export function parseFilterDropShadows(raw: string): ShadowLayer[] {
  const layers: ShadowLayer[] = []
  const lower = raw.toLowerCase()
  let cursor = 0
  while (cursor < raw.length) {
    const start = lower.indexOf('drop-shadow(', cursor)
    if (start < 0) break
    const contentStart = start + 'drop-shadow('.length
    let depth = 1
    let end = contentStart
    while (end < raw.length && depth > 0) {
      if (raw[end] === '(') depth += 1
      if (raw[end] === ')') depth -= 1
      end += 1
    }
    if (depth !== 0) break
    const layer = parseShadowItem(raw.slice(contentStart, end - 1), 'filter')
    if (layer) layers.push(layer)
    cursor = end
  }
  return layers
}

function isVisible(element: Element, view: Window): boolean {
  if (
    !element.isConnected ||
    element.closest(
      'script,style,noscript,template,[hidden],[aria-hidden="true"],[data-smart-scan-overlay="true"]'
    )
  ) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') === 0
    ) return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function signatureRank(token: ShadowToken): [number, number, number, number, string] {
  const first = token.layers[0]
  const group = token.layers.length > 1 ? 2 : first?.kind === 'inner' ? 1 : 0
  const blur = token.layers.reduce((sum, layer) => sum + layer.blur, 0)
  const offset = token.layers.reduce(
    (sum, layer) => sum + Math.abs(layer.offsetX) + Math.abs(layer.offsetY),
    0
  )
  const spread = token.layers.reduce((sum, layer) => sum + Math.abs(layer.spread), 0)
  return [group, blur, offset, spread, token.id]
}

export function compareShadowTokens(left: ShadowToken, right: ShadowToken): number {
  const a = signatureRank(left)
  const b = signatureRank(right)
  for (let index = 0; index < a.length - 1; index += 1) {
    const difference = (a[index] as number) - (b[index] as number)
    if (difference !== 0) return difference
  }
  return String(a[4]).localeCompare(String(b[4]))
}

function numberLabel(value: number): string {
  return String(normalizedNumber(value))
}

function baseName(token: ShadowToken): string {
  if (token.layers.length > 1) {
    return `shadow-multi-${token.layers.length}-${token.id.slice('sha256:'.length, 'sha256:'.length + 6)}`
  }
  const layer = token.layers[0]
  if (!layer) throw new Error('Shadow token requires at least one layer')
  const alphaPercent = normalizedNumber(layer.color.a * 100)
  return [
    'shadow', layer.kind,
    `x${numberLabel(layer.offsetX)}`,
    `y${numberLabel(layer.offsetY)}`,
    `b${numberLabel(layer.blur)}`,
    `s${numberLabel(layer.spread)}`,
    `a${numberLabel(alphaPercent)}`
  ].join('-')
}

export function assignUniqueShadowNames(tokens: ShadowToken[]): ShadowToken[] {
  const names = new Map<string, number>()
  return tokens.map(token => {
    let name = baseName(token)
    const count = names.get(name) ?? 0
    names.set(name, count + 1)
    if (count > 0) name = `${name}-${token.id.slice('sha256:'.length, 'sha256:'.length + 6)}`
    return { ...token, name }
  })
}

function shadowGroups(style: CSSStyleDeclaration): ShadowLayer[][] {
  return [
    parseBoxShadow(style.boxShadow),
    parseTextShadow(style.textShadow),
    parseFilterDropShadows(style.filter)
  ].filter(layers => layers.length > 0)
}

export async function collectShadows(document: Document): Promise<ShadowToken[]> {
  const view = document.defaultView
  if (!view) return []
  const aggregate = new Map<string, { signature: ShadowSignature; occurrences: number }>()

  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (!isVisible(element, view) || isExcludedStyleAssetSurface(element)) continue
    const style = view.getComputedStyle(element)
    for (const layers of shadowGroups(style)) {
      const signature = { layers }
      const id = await stableShadowId(signature)
      const previous = aggregate.get(id)
      aggregate.set(id, {
        signature,
        occurrences: (previous?.occurrences ?? 0) + 1
      })
    }
  }

  const tokens = await Promise.all([...aggregate.entries()].map(async ([id, value]) => ({
    id,
    name: '',
    layers: value.signature.layers,
    occurrences: value.occurrences
  } as ShadowToken)))
  return assignUniqueShadowNames(tokens.sort(compareShadowTokens))
}
