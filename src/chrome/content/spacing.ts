import type { SpacingToken } from '../../shared/schema'
import { stableSpacingId } from '../../shared/stable-id'
import { isExcludedStyleAssetSurface } from './visual-assets'

const pxPattern = /^\+?((?:\d+\.?\d*|\.\d+))px$/i

type SpacingEvidence = SpacingToken['evidence']
type TypedStyleMap = {
  get(property: string): unknown
}

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

export function normalizeSpacingPart(raw: string): number | null {
  const match = pxPattern.exec(raw.trim())
  if (!match) return null
  const value = normalizedNumber(Number(match[1]))
  return Number.isFinite(value) && value > 0 ? value : null
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

function valuesFor(parts: string[]): Set<number> {
  const values = new Set<number>()
  for (const part of parts) {
    const value = normalizeSpacingPart(part)
    if (value !== null) values.add(value)
  }
  return values
}

function typedStyleMapFor(element: Element): TypedStyleMap | null {
  const candidate = element as Element & {
    computedStyleMap?: () => TypedStyleMap
  }
  if (typeof candidate.computedStyleMap !== 'function') return null
  try {
    return candidate.computedStyleMap()
  } catch {
    return null
  }
}

function typedPxValue(
  map: TypedStyleMap | null,
  property: string
): number | null | undefined {
  if (!map) return undefined
  let raw: unknown
  try {
    raw = map.get(property)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object') return null
  const value = raw as { value?: unknown; unit?: unknown }
  if (value.unit !== 'px' || typeof value.value !== 'number') return null
  const normalized = normalizedNumber(value.value)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null
}

function valuesForProperties(
  map: TypedStyleMap | null,
  properties: Array<[property: string, legacyValue: string]>
): Set<number> {
  const values = new Set<number>()
  for (const [property, legacyValue] of properties) {
    const typed = typedPxValue(map, property)
    const value = typed === undefined ? normalizeSpacingPart(legacyValue) : typed
    if (value !== null) values.add(value)
  }
  return values
}

function valueLabel(value: number): string {
  return String(value)
}

export async function collectSpacing(document: Document): Promise<SpacingToken[]> {
  const view = document.defaultView
  if (!view) return []
  const aggregate = new Map<number, { occurrences: number; evidence: SpacingEvidence }>()

  const add = (value: number, kind: keyof SpacingEvidence): void => {
    const existing = aggregate.get(value) ?? {
      occurrences: 0,
      evidence: { padding: 0, gap: 0, margin: 0 }
    }
    existing.occurrences += 1
    existing.evidence[kind] += 1
    aggregate.set(value, existing)
  }

  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (!isVisible(element, view) || isExcludedStyleAssetSurface(element)) continue
    const style = view.getComputedStyle(element)
    const typedMap = typedStyleMapFor(element)
    const gapValues = valuesForProperties(typedMap, [
      ['row-gap', style.rowGap],
      ['column-gap', style.columnGap]
    ])
    if (!typedMap) {
      for (const value of valuesFor(style.gap.trim().split(/\s+/))) {
        gapValues.add(value)
      }
    }
    const groups: Array<[keyof SpacingEvidence, Set<number>]> = [
      ['padding', valuesForProperties(typedMap, [
        ['padding-top', style.paddingTop],
        ['padding-right', style.paddingRight],
        ['padding-bottom', style.paddingBottom],
        ['padding-left', style.paddingLeft]
      ])],
      ['gap', gapValues],
      ['margin', valuesForProperties(typedMap, [
        ['margin-top', style.marginTop],
        ['margin-right', style.marginRight],
        ['margin-bottom', style.marginBottom],
        ['margin-left', style.marginLeft]
      ])]
    ]
    for (const [kind, values] of groups) {
      for (const value of values) add(value, kind)
    }
  }

  return Promise.all(
    [...aggregate.entries()]
      .sort(([left], [right]) => left - right)
      .map(async ([value, aggregateValue]) => ({
        id: await stableSpacingId({ value }),
        name: `spacing-${valueLabel(value)}`,
        value,
        occurrences: aggregateValue.occurrences,
        evidence: aggregateValue.evidence,
        stateOccurrences: 1
      }))
  )
}
