import type {
  BorderRadiusToken,
  Colors,
  CompositeToken,
  CompositeDiagnostic,
  ControlDiagnostic,
  ControlFamily,
  ControlSize,
  ControlState,
  ControlToken,
  DisclosureDiagnostic,
  InteractiveColorToken,
  IconToken,
  PrimitiveColorToken,
  SemanticColorToken,
  ShadowToken,
  SpacingToken,
  TypographyStyle
} from '../../shared/schema'
import { assignUniqueTypographyNames } from '../content/typography'
import { assignUniqueShadowNames, compareShadowTokens } from '../content/shadows'
import { strongestColorProvenance } from '../content/colors'
import {
  chooseControlCopy,
  mergeControlSampleEvidence,
  type ControlTokenWithSampleEvidence
} from '../content/control-sample-text'
import { mergeIconTokens, quarantineExcludedGraphics } from '../content/icons'
import { isInteractionRestoreError } from '../interaction-restore-error'

export type ScanCandidate = {
  target: 'navigate' | 'reversible-click'
  url?: string
  risk: 'safe' | 'uncertain' | 'blocked'
}

export type InspectResult = {
  typography: TypographyStyle[]
  borderRadii: BorderRadiusToken[]
  shadows: ShadowToken[]
  colors: Colors
  spacing: SpacingToken[]
  controls: ControlTokenWithSampleEvidence[]
  composites?: CompositeToken[]
  icons: IconToken[]
  excludedGraphicIds?: string[]
  interactionFamilies?: string[]
  diagnostics?: {
    disclosures: DisclosureDiagnostic[]
    composites?: CompositeDiagnostic[]
    controls?: ControlDiagnostic[]
  }
  revealedStates: number
  candidates: ScanCandidate[]
  filtered: { brandAssets: number; personalTextNodes: number }
}

export type InspectContext = {
  exploredInteractionFamilies: string[]
}

export type ScanAdapter = {
  open(url: string): Promise<number>
  inspect(tabId: number, context?: InspectContext): Promise<InspectResult>
  navigate(tabId: number, url: string): Promise<void>
  reportProgress?(tabId: number, progress: { completed: number; maximum: number }): Promise<void>
  close(tabId: number, mode?: 'restore' | 'dirty-abort'): Promise<void>
}

export type ScanOptions = {
  currentUrl?: string
  startUrl: string
  maxDepth: number
  maxPages: number
}

const conversationRoute = /^\/(?:(?:c|chats?|conversations?)\/[a-z0-9][a-z0-9_-]{5,}|g\/[a-z0-9][a-z0-9_-]{5,}\/c\/[a-z0-9][a-z0-9_-]{5,})\/?$/i
const projectDetailRoute = /^\/(?:projects?|workspace)\/[^/]+\/?$/i
const nestedProjectRoute = /^\/g\/[^/]+\/project\/?$/i

function contentRouteFamily(url: string): string | null {
  const pathname = new URL(url).pathname
  if (conversationRoute.test(pathname)) return 'content:conversation'
  if (projectDetailRoute.test(pathname) || nestedProjectRoute.test(pathname)) return 'content:project'
  return null
}

function routePriority(url: string): number {
  const family = contentRouteFamily(url)
  if (family === 'content:project') return 1
  if (family === 'content:conversation') return 2
  return 0
}

function currentPathScope(url: string): string | null {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null
  return `/${segments.slice(0, Math.min(2, segments.length)).join('/')}`
}

function belongsToCurrentPathScope(currentPageUrl: string, candidateUrl: URL): boolean {
  const scope = currentPathScope(currentPageUrl)
  if (!scope) return true
  if (/^\/(?:settings|preferences)(?:\/|$)/i.test(candidateUrl.pathname)) return true
  const pathname = candidateUrl.pathname.replace(/\/+$/, '') || '/'
  return pathname === scope || pathname.startsWith(`${scope}/`)
}

function mergeToken<T extends { id: string; occurrences: number }>(target: Map<string, T>, incoming: T): void {
  const existing = target.get(incoming.id)
  if (!existing) {
    target.set(incoming.id, incoming)
    return
  }
  const combined = { ...existing, occurrences: existing.occurrences + incoming.occurrences } as T
  if ('provenance' in existing && 'provenance' in incoming) {
    target.set(incoming.id, {
      ...combined,
      provenance: strongestColorProvenance(
        existing.provenance as Parameters<typeof strongestColorProvenance>[0],
        incoming.provenance as Parameters<typeof strongestColorProvenance>[1]
      )
    } as T)
  } else {
    target.set(incoming.id, combined)
  }
}

function compareBorderRadii(left: BorderRadiusToken, right: BorderRadiusToken): number {
  const rank: Record<BorderRadiusToken['kind'], number> = { px: 0, percent: 1, full: 2 }
  const kindDifference = rank[left.kind] - rank[right.kind]
  if (kindDifference !== 0) return kindDifference
  return (left.value ?? 0) - (right.value ?? 0)
}

function compareControls(left: ControlToken, right: ControlToken): number {
  const familyOrder: ControlFamily[] = [
    'button', 'input', 'textarea', 'select', 'toggle', 'checkbox', 'radio'
  ]
  const sizeOrder: ControlSize[] = ['xs', 'sm', 'md', 'lg', 'xl', 'custom']
  const stateOrder: ControlState[] = [
    'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
  ]
  return familyOrder.indexOf(left.family) - familyOrder.indexOf(right.family) ||
    sizeOrder.indexOf(left.size) - sizeOrder.indexOf(right.size) ||
    left.groupId.localeCompare(right.groupId) ||
    stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state) ||
    left.id.localeCompare(right.id) ||
    (left.instanceId ?? left.id).localeCompare(right.instanceId ?? right.id)
}

function separateAmbiguousControlGroups(tokens: ControlToken[]): ControlToken[] {
  const byGroup = new Map<string, ControlToken[]>()
  for (const token of tokens) {
    const group = byGroup.get(token.groupId) ?? []
    group.push(token)
    byGroup.set(token.groupId, group)
  }
  return tokens.map(token => {
    if (token.templateId && token.logicalControlId && token.instanceId) return token
    const group = byGroup.get(token.groupId) ?? []
    const duplicateState = group.some(other =>
      other.id !== token.id && other.state === token.state
    )
    if (!duplicateState) return token
    return {
      ...token,
      groupId: token.id,
      name: `${token.name}-${token.id.slice('sha256:'.length, 'sha256:'.length + 6)}`
    }
  })
}

export async function scanSite(adapter: ScanAdapter, options: ScanOptions) {
  const initialUrl = new URL(options.startUrl)
  if (initialUrl.pathname !== '/' || initialUrl.search) {
    throw new Error('UI-Anatomist starts from the site home page to avoid revisiting an action URL')
  }
  initialUrl.hash = ''
  const rootUrl = initialUrl.href
  const currentUrl = new URL(options.currentUrl ?? rootUrl)
  currentUrl.hash = ''
  if (currentUrl.origin !== initialUrl.origin) {
    throw new Error('UI-Anatomist current page must belong to the scanned site')
  }
  const currentPageUrl = currentUrl.href
  const queue: Array<{ url: string; depth: number }> = []
  const seen = new Set<string>([currentPageUrl])
  const queuedContentFamilies = new Set<string>()
  const currentContentFamily = contentRouteFamily(currentPageUrl)
  if (currentContentFamily) queuedContentFamilies.add(currentContentFamily)
  const typography = new Map<string, TypographyStyle>()
  const borderRadii = new Map<string, BorderRadiusToken>()
  const shadows = new Map<string, ShadowToken>()
  const primitiveColors = new Map<string, PrimitiveColorToken>()
  const semanticColors = new Map<string, SemanticColorToken>()
  const interactiveColors = new Map<string, InteractiveColorToken>()
  const spacing = new Map<string, SpacingToken>()
  const controls = new Map<string, ControlTokenWithSampleEvidence>()
  const composites = new Map<string, CompositeToken>()
  const icons = new Map<string, IconToken>()
  const excludedGraphicIds = new Set<string>()
  const exploredInteractionFamilies = new Set<string>()
  const disclosureDiagnostics = new Map<string, DisclosureDiagnostic>()
  const compositeDiagnostics = new Map<string, CompositeDiagnostic>()
  const controlDiagnostics = new Map<string, ControlDiagnostic>()
  let tabId: number | null = null
  let revealedStates = 0
  let skippedUnsafe = 0
  let skippedUncertain = 0
  let failures = 0
  let navigationFailures = 0
  let inspectionFailures = 0
  let brandAssets = 0
  let personalTextNodes = 0
  let visitedPages = 0
  let navigatedPages = 0
  let fatalInspectionError: unknown = null

  const maximumPages = options.maxPages
  const navigationBudget = Math.max(0, options.maxPages - 1)

  const mergeInspection = (inspected: InspectResult, depth: number) => {
    visitedPages += 1
    revealedStates += inspected.revealedStates
    brandAssets += inspected.filtered.brandAssets
    personalTextNodes += inspected.filtered.personalTextNodes
    inspected.typography.forEach(style => mergeToken(typography, style))
    inspected.borderRadii.forEach(radius => mergeToken(borderRadii, radius))
    inspected.shadows.forEach(shadow => mergeToken(shadows, shadow))
    inspected.colors.primitives.forEach(color => mergeToken(primitiveColors, color))
    inspected.colors.semantic.forEach(color => mergeToken(semanticColors, color))
    inspected.colors.interactive.forEach(color => mergeToken(interactiveColors, color))
    inspected.spacing.forEach(incoming => {
      const existing = spacing.get(incoming.id)
      spacing.set(incoming.id, existing
        ? {
            ...existing,
            occurrences: existing.occurrences + incoming.occurrences,
            stateOccurrences: existing.stateOccurrences + incoming.stateOccurrences,
            evidence: {
              padding: existing.evidence.padding + incoming.evidence.padding,
              gap: existing.evidence.gap + incoming.evidence.gap,
              margin: existing.evidence.margin + incoming.evidence.margin
            }
          }
        : incoming)
    })
    inspected.controls.forEach(incoming => {
      const key = `${incoming.instanceId ?? incoming.id}|${incoming.id}`
      const existing = controls.get(key)
      if (!existing) {
        controls.set(key, incoming)
        return
      }
      const sampleTextEvidence = mergeControlSampleEvidence(
        existing.sampleTextEvidence,
        incoming.sampleTextEvidence
      )
      const copy = chooseControlCopy(sampleTextEvidence)
      controls.set(key, {
        ...existing,
        ...(copy?.sampleText ? { sampleText: copy.sampleText } : {}),
        ...(copy?.supportingText ? { supportingText: copy.supportingText } : {}),
        ...(sampleTextEvidence.length > 0 ? { sampleTextEvidence } : {}),
        occurrences: existing.occurrences + incoming.occurrences,
        stateOccurrences: existing.stateOccurrences + incoming.stateOccurrences
      })
    })
    for (const incoming of inspected.composites ?? []) {
      const key = `${incoming.logicalCompositeId}|${incoming.id}`
      const existing = composites.get(key)
      composites.set(key, existing
        ? {
            ...existing,
            occurrences: existing.occurrences + incoming.occurrences,
            stateOccurrences: existing.stateOccurrences + incoming.stateOccurrences
          }
        : incoming)
    }
    for (const id of inspected.excludedGraphicIds ?? []) excludedGraphicIds.add(id)
    for (const family of inspected.interactionFamilies ?? []) {
      exploredInteractionFamilies.add(family)
    }
    for (const incoming of inspected.diagnostics?.disclosures ?? []) {
      const { occurrences: _occurrences, ...identity } = incoming
      const key = JSON.stringify(identity)
      const existing = disclosureDiagnostics.get(key)
      disclosureDiagnostics.set(key, existing
        ? { ...existing, occurrences: existing.occurrences + incoming.occurrences }
        : incoming)
    }
    for (const incoming of inspected.diagnostics?.composites ?? []) {
      const { occurrences: _occurrences, ...identity } = incoming
      const key = JSON.stringify(identity)
      const existing = compositeDiagnostics.get(key)
      compositeDiagnostics.set(key, existing
        ? { ...existing, occurrences: existing.occurrences + incoming.occurrences }
        : incoming)
    }
    for (const incoming of inspected.diagnostics?.controls ?? []) {
      const { occurrences: _occurrences, ...identity } = incoming
      const key = JSON.stringify(identity)
      const existing = controlDiagnostics.get(key)
      controlDiagnostics.set(key, existing
        ? { ...existing, occurrences: existing.occurrences + incoming.occurrences }
        : incoming)
    }
    for (const incoming of inspected.icons ?? []) {
      const existing = icons.get(incoming.id)
      const [merged] = mergeIconTokens(existing ? [[existing], [incoming]] : [[incoming]])
      if (merged) icons.set(incoming.id, merged)
    }
    const candidates = [...inspected.candidates].sort((left, right) => {
      if (!left.url || !right.url) return left.url ? -1 : right.url ? 1 : 0
      return routePriority(left.url) - routePriority(right.url) || left.url.localeCompare(right.url)
    })
    for (const candidate of candidates) {
      if (candidate.risk === 'blocked') {
        skippedUnsafe += 1
      } else if (candidate.risk === 'uncertain') {
        skippedUncertain += 1
      } else if (candidate.target !== 'navigate') {
        continue
      } else if (!candidate.url || new URL(candidate.url).origin !== initialUrl.origin) {
        skippedUncertain += 1
      } else {
        const candidateUrl = new URL(candidate.url)
        candidateUrl.hash = ''
        if (!belongsToCurrentPathScope(currentPageUrl, candidateUrl)) {
          skippedUncertain += 1
          continue
        }
        const family = contentRouteFamily(candidateUrl.href)
        if (family && family !== currentContentFamily) {
          skippedUncertain += 1
          continue
        }
        if (family && queuedContentFamilies.has(family)) continue
        if (family) queuedContentFamilies.add(family)
        queue.push({ url: candidateUrl.href, depth: depth + 1 })
      }
    }
  }

  try {
    tabId = await adapter.open(currentPageUrl)
    await adapter.reportProgress?.(tabId, { completed: 1, maximum: maximumPages })
    try {
      mergeInspection(await adapter.inspect(tabId, {
        exploredInteractionFamilies: [...exploredInteractionFamilies]
      }), 0)
    } catch (error) {
      if (isInteractionRestoreError(error)) {
        fatalInspectionError = error
        throw error
      }
      failures += 1
      inspectionFailures += 1
    }

    while (queue.length > 0 && navigatedPages < navigationBudget) {
      const state = queue.shift()
      if (!state || seen.has(state.url) || state.depth > options.maxDepth) continue
      seen.add(state.url)
      navigatedPages += 1

      try {
        await adapter.navigate(tabId, state.url)
        await adapter.reportProgress?.(tabId, {
          completed: 1 + navigatedPages,
          maximum: maximumPages
        })
      } catch {
        failures += 1
        navigationFailures += 1
        continue
      }
      try {
        mergeInspection(await adapter.inspect(tabId, {
          exploredInteractionFamilies: [...exploredInteractionFamilies]
        }), state.depth)
      } catch (error) {
        if (isInteractionRestoreError(error)) {
          fatalInspectionError = error
          throw error
        }
        failures += 1
        inspectionFailures += 1
      }
    }
  } finally {
    if (tabId !== null) {
      if (fatalInspectionError !== null) {
        try {
          await adapter.close(tabId, 'dirty-abort')
        } catch {
          // Cleanup must never replace the fatal interaction-restoration error.
        }
      } else {
        await adapter.close(tabId)
      }
    }
  }

  const primitives = Array.from(primitiveColors.values())
  const quarantined = await quarantineExcludedGraphics(
    Array.from(controls.values())
      .map(({ sampleTextEvidence: _evidence, ...token }) => token),
    mergeIconTokens([Array.from(icons.values())]),
    excludedGraphicIds
  )
  const validControlReferences = new Set(quarantined.controls.map(token =>
    `${token.id}|${token.instanceId ?? token.id}|${token.state}`
  ))
  let validComposites = [...composites.values()]
  let changed = true
  while (changed) {
    changed = false
    const compositeIds = new Set(validComposites.map(composite => composite.id))
    const next = validComposites.filter(composite => composite.children.every(child =>
      child.kind === 'control'
        ? validControlReferences.has(`${child.controlId}|${child.instanceId}|${child.state}`)
        : child.kind === 'composite'
          ? compositeIds.has(child.compositeId) && child.compositeId !== composite.id
          : true
    ))
    if (next.length !== validComposites.length) changed = true
    validComposites = next
  }
  return {
    typography: assignUniqueTypographyNames(Array.from(typography.values())),
    borderRadii: Array.from(borderRadii.values()).sort(compareBorderRadii),
    shadows: assignUniqueShadowNames(Array.from(shadows.values()).sort(compareShadowTokens)),
    colors: {
      primitives,
      semantic: Array.from(semanticColors.values()),
      interactive: Array.from(interactiveColors.values())
    },
    spacing: Array.from(spacing.values())
      .filter(token => {
        if (token.evidence.padding > 0 || token.evidence.gap > 0) return true
        return token.value <= 64 && token.stateOccurrences >= 2
      })
      .sort((left, right) => left.value - right.value),
    controls: separateAmbiguousControlGroups(
      quarantined.controls
    )
      .sort(compareControls),
    composites: validComposites,
    icons: quarantined.icons,
    diagnostics: {
      disclosures: [...disclosureDiagnostics.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        left.stage.localeCompare(right.stage) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      ),
      composites: [...compositeDiagnostics.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        left.reason.localeCompare(right.reason) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      ),
      controls: [...controlDiagnostics.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId) ||
        left.stage.localeCompare(right.stage) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )
    },
    traversal: {
      visitedStates: visitedPages + revealedStates,
      skippedUnsafe,
      skippedUncertain,
      failures,
      ...(failures > 0 ? {
        failureStages: {
          navigation: navigationFailures,
          inspection: inspectionFailures
        }
      } : {})
    },
    filtered: { brandAssets, personalTextNodes }
  }
}
