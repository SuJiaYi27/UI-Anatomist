import type { TypographyStyle } from '../../shared/schema'
import { stableTypographyId } from '../../shared/stable-id'
import {
  FONT_ICON_SELECTOR,
  isFontIconCandidate
} from './font-icon'

function parsePx(value: string): number {
  return Number.parseFloat(value) || 0
}

function parseWeight(value: string): number {
  if (value === 'normal') return 400
  if (value === 'bold') return 700
  return Number.parseInt(value, 10) || 400
}

function parseFamilies(value: string): string[] {
  const parsed = value
    .split(',')
    .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  return parsed.length ? parsed : ['sans-serif']
}

function parseStyle(value: string): TypographyStyle['fontStyle'] {
  if (value.startsWith('italic')) return 'italic'
  if (value.startsWith('oblique')) return 'oblique'
  return 'normal'
}

function roleFor(element: Element, size: number): TypographyStyle['role'] {
  if (/^H[1-6]$/.test(element.tagName)) return 'heading'
  if (element.matches('button,input,textarea,[role="button"],[role="tab"]')) return 'control'
  if (element.matches('small,figcaption') || size <= 12) return 'caption'
  if (element.matches('p,li,a,label,span,div,td,th,article,section,main')) return 'body'
  return 'unknown'
}

function nameFor(role: TypographyStyle['role'], size: number, weight: number): string {
  if (role === 'body' && size === 16 && weight === 400) return 'body-regular'
  if (role === 'caption' && weight === 400) return 'caption-regular'
  return `${role}-${Number(size.toFixed(2))}-${weight}`
}

function compactNumber(value: number): string {
  return String(Number(value.toFixed(2)))
}

function nameSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'font'
}

export function assignUniqueTypographyNames(styles: TypographyStyle[]): TypographyStyle[] {
  const normalized = styles.map(style => ({
    ...style,
    name: nameFor(style.role, style.fontSizePx, style.fontWeight)
  }))
  const names = normalized.map(style => style.name)
  const baseGroups = new Map<string, number[]>()
  normalized.forEach((style, index) => {
    const group = baseGroups.get(style.name) ?? []
    group.push(index)
    baseGroups.set(style.name, group)
  })

  const suffixes: Array<(style: TypographyStyle) => string> = [
    style => `lh${style.lineHeightPx === null ? 'auto' : compactNumber(style.lineHeightPx)}`,
    style => `ls${compactNumber(style.letterSpacingPx)}`,
    style => style.fontStyle,
    style => nameSlug(style.fontFamilyStack[0] ?? 'font'),
    style => style.id.replace(/^sha256:/, '').slice(0, 6)
  ]

  for (const indices of baseGroups.values()) {
    if (indices.length < 2) continue
    for (const suffixFor of suffixes) {
      const collisions = new Map<string, number[]>()
      for (const index of indices) {
        const currentName = names[index]!
        const group = collisions.get(currentName) ?? []
        group.push(index)
        collisions.set(currentName, group)
      }
      for (const group of collisions.values()) {
        if (group.length < 2) continue
        for (const index of group) {
          names[index] = `${names[index]!}-${suffixFor(normalized[index]!)}`
        }
      }
    }
  }

  return normalized.map((style, index) => ({ ...style, name: names[index]! }))
}

function isVisible(element: Element, view: Window): boolean {
  if (element.closest('[hidden],[aria-hidden="true"]')) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  }
  return true
}

function typographyElements(document: Document, view: Window): Element[] {
  const elements = new Set<Element>()
  const showText = document.defaultView?.NodeFilter.SHOW_TEXT ?? 4
  const root = document.body ?? document.documentElement
  const walker = document.createTreeWalker(root, showText)
  while (walker.nextNode()) {
    const textNode = walker.currentNode
    if (!textNode.textContent?.trim()) continue
    const parent = textNode.parentElement
    if (!parent || parent.closest(
      'script,style,noscript,template,svg,[data-smart-scan-overlay="true"]'
    )) continue
    const fontIcon = parent.closest(FONT_ICON_SELECTOR)
    if (fontIcon && isFontIconCandidate(fontIcon, view)) continue
    elements.add(parent)
  }
  document.querySelectorAll('input,textarea,select').forEach(element => elements.add(element))
  return [...elements]
}

export async function collectTypography(document: Document): Promise<TypographyStyle[]> {
  const view = document.defaultView
  if (!view) return []

  const aggregate = new Map<string, Omit<TypographyStyle, 'id'>>()
  for (const element of typographyElements(document, view)) {
    const style = view.getComputedStyle(element)
    if (!isVisible(element, view)) continue

    const fontSizePx = parsePx(style.fontSize)
    if (fontSizePx <= 0) continue

    const fontWeight = parseWeight(style.fontWeight)
    const fontStyle = parseStyle(style.fontStyle)
    const lineHeightPx = !style.lineHeight || style.lineHeight === 'normal' ? null : parsePx(style.lineHeight)
    const signature = {
      fontFamilyStack: parseFamilies(style.fontFamily),
      fontStyle,
      fontSizePx,
      fontWeight,
      lineHeightPx: lineHeightPx && lineHeightPx > 0 ? lineHeightPx : null,
      letterSpacingPx: !style.letterSpacing || style.letterSpacing === 'normal' ? 0 : parsePx(style.letterSpacing)
    }
    const key = JSON.stringify(signature)
    const current = aggregate.get(key)
    if (current) {
      current.occurrences += 1
      continue
    }
    const role = roleFor(element, fontSizePx)
    aggregate.set(key, {
      ...signature,
      name: nameFor(role, fontSizePx, fontWeight),
      role,
      occurrences: 1
    })
  }

  const styles = await Promise.all(Array.from(aggregate.values(), async item => ({
    ...item,
    id: await stableTypographyId(item)
  })))
  return assignUniqueTypographyNames(styles)
}
