import type { BorderRadiusToken } from '../../shared/schema'
import { stableBorderRadiusId, type BorderRadiusSignature } from '../../shared/stable-id'

const radiusPartPattern = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|%)$/i

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

export function normalizeRadiusPart(
  raw: string,
  fullThresholdPx?: number
): BorderRadiusSignature | null {
  const match = radiusPartPattern.exec(raw.trim())
  if (!match) return null
  const numeric = Number(match[1])
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const value = normalizedNumber(numeric)
  if (match[2] === '%') {
    return value >= 50 ? { kind: 'full', value: null } : { kind: 'percent', value }
  }
  const hasRenderedThreshold =
    Number.isFinite(fullThresholdPx) &&
    (fullThresholdPx ?? 0) > 0
  const reachesRenderedFull = hasRenderedThreshold &&
    value >= (fullThresholdPx ?? Number.POSITIVE_INFINITY)
  return reachesRenderedFull || (!hasRenderedThreshold && value >= 999)
    ? { kind: 'full', value: null }
    : { kind: 'px', value }
}

function isVisible(element: Element, view: Window): boolean {
  if (
    !element.isConnected ||
    element.closest(
      'script,style,noscript,template,[hidden],[aria-hidden="true"],[data-smart-scan-overlay="true"]'
    )
  ) {
    return false
  }
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

function signatureKey(value: BorderRadiusSignature): string {
  return `${value.kind}:${value.value ?? 'full'}`
}

function nameFor(value: BorderRadiusSignature): string {
  if (value.kind === 'full') return 'radius-full'
  if (value.kind === 'percent') return `radius-${value.value}-percent`
  return `radius-${value.value}`
}

function partsFor(style: CSSStyleDeclaration): string[] {
  const cornerParts = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius
  ].flatMap(value => value.trim().split(/\s+/).filter(Boolean))
  if (cornerParts.some(part => normalizeRadiusPart(part))) return cornerParts
  return style.borderRadius.trim().split(/[\s/]+/).filter(Boolean)
}

function compareSignatures(left: BorderRadiusSignature, right: BorderRadiusSignature): number {
  const rank = { px: 0, percent: 1, full: 2 }
  const kindDifference = rank[left.kind] - rank[right.kind]
  if (kindDifference !== 0) return kindDifference
  return (left.value ?? 0) - (right.value ?? 0)
}

export async function collectBorderRadii(document: Document): Promise<BorderRadiusToken[]> {
  const view = document.defaultView
  if (!view) return []
  const aggregate = new Map<string, { signature: BorderRadiusSignature; occurrences: number }>()

  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (!isVisible(element, view)) continue
    const rect = element.getBoundingClientRect()
    const fullThresholdPx = Math.min(rect.width, rect.height) / 2
    const seenOnElement = new Map<string, BorderRadiusSignature>()
    for (const part of partsFor(view.getComputedStyle(element))) {
      const signature = normalizeRadiusPart(part, fullThresholdPx)
      if (signature) seenOnElement.set(signatureKey(signature), signature)
    }
    for (const [key, signature] of seenOnElement) {
      const existing = aggregate.get(key)
      aggregate.set(key, {
        signature,
        occurrences: (existing?.occurrences ?? 0) + 1
      })
    }
  }

  const values = [...aggregate.values()].sort((left, right) =>
    compareSignatures(left.signature, right.signature)
  )
  return Promise.all(values.map(async ({ signature, occurrences }) => ({
    ...signature,
    id: await stableBorderRadiusId(signature),
    name: nameFor(signature),
    occurrences
  } as BorderRadiusToken)))
}
