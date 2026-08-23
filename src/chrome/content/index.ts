import type { InspectResult } from '../background/scan-site'
import { clearCandidateMarkers, discoverCandidates } from './discover'
import {
  createReversibleStateSession,
  exploreReversibleStates,
  type ReversibleStateSession
} from './state-explorer'
import { collectTypography } from './typography'
import { collectBorderRadii } from './border-radii'
import { collectShadows } from './shadows'
import { collectColors, strongestColorProvenance } from './colors'
import { collectSpacing } from './spacing'
import {
  collectControlsWithObservations,
  type CollectedControls,
  type CollectedControlToken
} from './controls'
import {
  collectControlCompositePedigree,
  collectControlComposites,
  type ControlCompositePedigree
} from './control-composites'
import {
  collectExcludedGraphicIds,
  collectIcons,
  mergeIconTokens,
  quarantineExcludedGraphics
} from './icons'
import {
  chooseControlCopy,
  mergeControlSampleEvidence
} from './control-sample-text'
import {
  waitForStableDocument,
  type DocumentStabilityOptions
} from './document-stability'
import { sampleVerticalScrollStates } from './scroll-sampler'
import {
  createHoverStateSession,
  exploreHoverStates,
  HOVER_PROBE_ATTRIBUTE,
  HOVER_TARGET_ATTRIBUTE
} from './hover-state-explorer'
import {
  blurElement,
  deepActiveElement,
  restoreActiveElement
} from './focus-preservation'
import { stableControlId } from '../../shared/stable-id'
import { controlIdentities } from './control-identity'
import {
  hasStateVisualDifference,
  shouldInferVisualSelected,
  shouldRetainVisualSelected,
  visualSelectedEvidence,
  type VisualSelectedRetention,
  type VisualSelectedPeerContext
} from './control-visual-state'
import { createDisclosureDiagnosticRecorder } from './disclosure-diagnostics'
import { createCompositeDiagnosticRecorder } from './composite-diagnostics'
import { createStaticStructureDiagnosticRecorder } from './static-structure-diagnostics'
import { createControlDiagnosticRecorder } from './control-diagnostics'
import {
  INTERACTION_RESTORE_ABORT_CODE,
  isInteractionRestoreReason,
  isInteractionRestoreError
} from '../interaction-restore-error'

function mergeTokens<T extends { id: string; occurrences: number }>(groups: T[][]): T[] {
  const merged = new Map<string, T>()
  for (const group of groups) {
    for (const style of group) {
      const existing = merged.get(style.id)
      if (!existing) {
        merged.set(style.id, style)
        continue
      }
      const combined = { ...existing, occurrences: existing.occurrences + style.occurrences } as T
      if ('provenance' in existing && 'provenance' in style) {
        merged.set(style.id, {
          ...combined,
          provenance: strongestColorProvenance(
            existing.provenance as Parameters<typeof strongestColorProvenance>[0],
            style.provenance as Parameters<typeof strongestColorProvenance>[1]
          )
        } as T)
      } else {
        merged.set(style.id, combined)
      }
    }
  }
  return Array.from(merged.values())
}

function mergeSpacing(
  groups: InspectResult['spacing'][]
): InspectResult['spacing'] {
  const merged = new Map<string, InspectResult['spacing'][number]>()
  for (const token of groups.flat()) {
    const existing = merged.get(token.id)
    if (!existing) {
      merged.set(token.id, token)
      continue
    }
    merged.set(token.id, {
      ...existing,
      occurrences: existing.occurrences + token.occurrences,
      stateOccurrences: existing.stateOccurrences + token.stateOccurrences,
      evidence: {
        padding: existing.evidence.padding + token.evidence.padding,
        gap: existing.evidence.gap + token.evidence.gap,
        margin: existing.evidence.margin + token.evidence.margin
      }
    })
  }
  return [...merged.values()].sort((left, right) => left.value - right.value)
}

function controlVisualKey(token: InspectResult['controls'][number]): string {
  return JSON.stringify({
    family: token.family,
    intent: token.intent,
    size: token.size,
    geometry: token.geometry,
    appearance: token.appearance,
    typography: token.typography,
    slots: token.slots,
    slotGroups: token.slotGroups ?? null,
    content: token.content ?? null,
    layout: token.layout ?? null,
    supportingStyle: token.supportingStyle ?? null
  })
}

function evidenceFromCanonicalVisual(
  canonical: CollectedControlToken,
  observed: CollectedControlToken
): CollectedControlToken {
  return {
    ...canonical,
    ...(observed.sampleText ? { sampleText: observed.sampleText } : {}),
    ...(observed.supportingText
      ? { supportingText: observed.supportingText }
      : {}),
    ...(observed.sampleTextEvidence
      ? { sampleTextEvidence: observed.sampleTextEvidence }
      : {}),
    occurrences: observed.occurrences,
    stateOccurrences: observed.stateOccurrences
  }
}

async function retagControlState(
  token: CollectedControlToken,
  ownership: CollectedControls['observations'][number]['ownership'],
  state: CollectedControlToken['state']
): Promise<CollectedControlToken> {
  const signature = { ...token, state }
  const identities = await controlIdentities({
    document: ownership.interaction.ownerDocument,
    element: ownership.interaction,
    signature,
    sampleText: token.sampleText ?? null,
    supportingText: token.supportingText ?? null
  })
  return {
    ...token,
    ...signature,
    id: await stableControlId(signature),
    groupId: identities.templateId,
    templateId: identities.templateId,
    logicalControlId: identities.logicalControlId,
    instanceId: identities.instanceId
  }
}

export function createControlStateNormalizer(): (
  collected: CollectedControls,
  visualPeerContext?: VisualSelectedPeerContext
) => Promise<CollectedControls> {
  const defaultByInstance = new Map<string, CollectedControlToken>()
  const canonicalByInstanceState = new Map<string, CollectedControlToken>()
  const visualSelectedByInstance = new Map<string, VisualSelectedRetention>()

  return async (collected, visualPeerContext) => {
    const normalizedControls = new Map<string, CollectedControlToken>()
    const observations: CollectedControls['observations'] = []
    const handledRawKeys = new Set<string>()
    for (const observation of collected.observations) {
      const observed = observation.token
      const instanceId = observed.instanceId ?? observed.id
      handledRawKeys.add(`${instanceId}|${observed.id}`)
      const instanceStateKey = `${instanceId}|${observed.state}`
      const observedVisualKey = controlVisualKey(observed)
      const defaultToken = defaultByInstance.get(instanceId)
      const defaultVisualKey = defaultToken
        ? controlVisualKey(defaultToken)
        : null
      const stateToken = canonicalByInstanceState.get(instanceStateKey)
      const stateVisualKey = stateToken
        ? controlVisualKey(stateToken)
        : null
      const interaction = observation.ownership.interaction
      const contextualHover =
        !interaction.hasAttribute(HOVER_TARGET_ATTRIBUTE) &&
        interaction.closest(`[${HOVER_PROBE_ATTRIBUTE}]`) !== null
      const contextualVisualChange =
        contextualHover &&
        observed.state === 'default' &&
        defaultVisualKey !== null &&
        defaultToken !== undefined &&
        hasStateVisualDifference(observation, {
          token: defaultToken,
          ownership: observation.ownership
        })
      const activeElement = interaction.ownerDocument.activeElement
      const activeWithinVisual = Boolean(
        activeElement &&
        (
          activeElement === interaction ||
          interaction.contains(activeElement)
        )
      )
      const focusVisualEvidence = stateVisualKey === null
        ? observed.appearance.outlineWidth > 0 &&
          observed.appearance.outline.a > 0
        : observedVisualKey !== stateVisualKey
      const contextualFocus =
        !contextualHover &&
        observed.state !== 'focus' &&
        observed.state !== 'hover' &&
        observed.state !== 'disabled' &&
        focusVisualEvidence &&
        activeWithinVisual
      const contextualState = contextualVisualChange
        ? 'hover' as const
        : contextualFocus
          ? 'focus' as const
          : null
      const visualSelected = shouldInferVisualSelected(
        observation,
        collected.observations,
        interaction.ownerDocument.defaultView ?? window,
        visualPeerContext
      )
      const retainedVisualSelected = shouldRetainVisualSelected(
        observation,
        visualSelectedByInstance.get(instanceId),
        visualPeerContext
      )
      const candidate = contextualState
        ? {
            ...observed,
            state: contextualState,
            id: await stableControlId({ ...observed, state: contextualState })
          }
        : visualSelected || retainedVisualSelected
          ? await retagControlState(observed, observation.ownership, 'selected')
          : observed
      const collapsibleVisualState =
        candidate.state === 'hover' || candidate.state === 'focus'
      const canonical =
        collapsibleVisualState &&
        defaultToken &&
        observedVisualKey === defaultVisualKey
        ? defaultToken
        : candidate

      if (
        observed.state === 'default' &&
        !contextualHover &&
        !activeWithinVisual &&
        !defaultToken
      ) {
        defaultByInstance.set(instanceId, observed)
      }
      if (
        !contextualHover &&
        !activeWithinVisual &&
        !stateToken
      ) {
        canonicalByInstanceState.set(instanceStateKey, observed)
      }
      if (
        candidate.state === 'selected' &&
        observed.state === 'default' &&
        !contextualState
      ) {
        const visualEvidence = visualSelectedEvidence(
          observation,
          collected.observations,
          interaction.ownerDocument.defaultView ?? window,
          visualPeerContext
        )
        const group = visualPeerContext?.directOptionGroupByObservation?.get(observation)
        if (visualEvidence && group) {
          visualSelectedByInstance.set(instanceId, { evidence: visualEvidence, group })
        }
      }

      const token = evidenceFromCanonicalVisual(canonical, observed)
      normalizedControls.set(
        `${token.instanceId ?? token.id}|${token.id}`,
        token
      )
      observations.push({ ...observation, token })
    }

    for (const token of collected.controls) {
      const instanceId = token.instanceId ?? token.id
      const observedKey = `${instanceId}|${token.id}`
      if (!handledRawKeys.has(observedKey)) normalizedControls.set(observedKey, token)
    }

    return { controls: [...normalizedControls.values()], observations }
  }
}

function mergeControls(
  groups: InspectResult['controls'][]
): InspectResult['controls'] {
  const merged = new Map<string, InspectResult['controls'][number]>()
  for (const token of groups.flat()) {
    const instanceId = token.instanceId ?? token.id
    const key = `${instanceId}|${token.id}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, token)
      continue
    }
    const sampleTextEvidence = mergeControlSampleEvidence(
      existing.sampleTextEvidence,
      token.sampleTextEvidence
    )
    const copy = chooseControlCopy(sampleTextEvidence)
    merged.set(key, {
      ...existing,
      ...(copy?.sampleText ? { sampleText: copy.sampleText } : {}),
      ...(copy?.supportingText ? { supportingText: copy.supportingText } : {}),
      ...(sampleTextEvidence.length > 0 ? { sampleTextEvidence } : {}),
      occurrences: existing.occurrences + token.occurrences,
      stateOccurrences: existing.stateOccurrences + token.stateOccurrences
    })
  }
  return [...merged.values()]
}

function mergeComposites(
  groups: CompositeGroup[]
): CompositeGroup {
  const merged = new Map<string, CompositeGroup[number]>()
  for (const token of groups.flat()) {
    const key = `${token.logicalCompositeId}|${token.id}`
    const existing = merged.get(key)
    merged.set(key, existing
      ? {
          ...existing,
          occurrences: existing.occurrences + token.occurrences,
          stateOccurrences: existing.stateOccurrences + token.stateOccurrences
        }
      : token)
  }
  return [...merged.values()]
}

type CompositeGroup = NonNullable<InspectResult['composites']>

type SampleCandidate = InspectResult['candidates'][number] & { key: string }

function uniqueCandidates(
  groups: SampleCandidate[][]
): InspectResult['candidates'] {
  const unique = new Map<string, InspectResult['candidates'][number]>()
  for (const candidate of groups.flat()) {
    const identity = candidate.target === 'navigate' && candidate.url
      ? `${candidate.target}:${candidate.risk}:${candidate.url}`
      : `${candidate.target}:${candidate.risk}:${candidate.key}`
    if (unique.has(identity)) continue
    unique.set(identity, {
      target: candidate.target,
      ...(candidate.url ? { url: candidate.url } : {}),
      risk: candidate.risk
    })
  }
  return [...unique.values()]
}

function countTextNodes(document: Document): number {
  const showText = document.defaultView?.NodeFilter.SHOW_TEXT ?? 4
  const walker = document.createTreeWalker(document.body ?? document.documentElement, showText)
  let count = 0
  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.trim()) count += 1
  }
  return count
}

function captureFocusedControl(document: Document): Element | null {
  const active = deepActiveElement(document)
  if (
    !active ||
    active === document.body ||
    active === document.documentElement
  ) return null
  return active
}

function assertSuccessfulNavigation(document: Document): void {
  const performance = document.defaultView?.performance
  if (!performance || typeof performance.getEntriesByType !== 'function') return
  const navigation = performance.getEntriesByType('navigation')[0] as
    | (PerformanceEntry & { responseStatus?: number })
    | undefined
  const responseStatus = Number(navigation?.responseStatus)
  if (
    Number.isInteger(responseStatus) &&
    responseStatus >= 400 &&
    responseStatus <= 599
  ) {
    throw new Error(`UI-Anatomist cannot inspect an HTTP ${responseStatus} page`)
  }
}

export async function inspectDocument(
  document: Document,
  options: {
    stability?: Partial<DocumentStabilityOptions>
    reversibleStateSession?: ReversibleStateSession
  } = {}
): Promise<InspectResult> {
  let originallyFocused: Element | null = null
  try {
    assertSuccessfulNavigation(document)
    await waitForStableDocument(document, options.stability)
    originallyFocused = captureFocusedControl(document)
    blurElement(originallyFocused)
    const diagnostics = createDisclosureDiagnosticRecorder(document)
    const compositeDiagnostics = createCompositeDiagnosticRecorder(document)
    const controlDiagnostics = createControlDiagnosticRecorder(document)
    const staticStructureDiagnostics = createStaticStructureDiagnosticRecorder()
    const sample = async () => {
      const typography = await collectTypography(document)
      const rawCollectedControls = await collectControlsWithObservations(document, {
        diagnostics: controlDiagnostics
      })
      const compositePedigree: ControlCompositePedigree =
        await collectControlCompositePedigree(
          document,
          rawCollectedControls.observations,
          { diagnostics: compositeDiagnostics }
        )
      const collectedControls = await normalizeControls(
        rawCollectedControls,
        compositePedigree
      )
      for (const observation of collectedControls.observations) {
        controlDiagnostics.recordNormalizedState?.(
          observation.token.instanceId ?? observation.token.id,
          observation.token.state
        )
      }
      return {
        typography,
        borderRadii: await collectBorderRadii(document),
        shadows: await collectShadows(document),
        colors: await collectColors(document),
        spacing: await collectSpacing(document),
        controls: collectedControls.controls,
        composites: await collectControlComposites(
          document,
          collectedControls.observations,
          {
            diagnostics: compositeDiagnostics,
            staticDiagnostics: staticStructureDiagnostics,
            typography,
            pedigree: compositePedigree
          }
        ),
        icons: await collectIcons(document),
        excludedGraphicIds: await collectExcludedGraphicIds(document),
        candidates: discoverCandidates(document, {
          mark: false,
          diagnostics
        }).map(candidate => ({
          key: candidate.key,
          target: candidate.target,
          url: candidate.url,
          risk: candidate.risk
        }))
      }
    }
    const hoverSession = createHoverStateSession()
    const normalizeControls = createControlStateNormalizer()
    const reversibleStateSession = options.reversibleStateSession ??
      createReversibleStateSession()
    const sampleWithHover = async () => [
      await sample(),
      ...await exploreHoverStates(document, sample, hoverSession)
    ]
    const sampleRenderedState = async () => [
      ...await sampleWithHover(),
      ...(await sampleVerticalScrollStates(document, sampleWithHover, {
        includeCurrent: false,
        settle: () => waitForStableDocument(document, {
          minimumWaitMs: 0,
          quietPeriodMs: 50,
          maximumWaitMs: 350
        })
      })).flat()
    ]
    const baseGroup = await sampleRenderedState()
    const revealedGroups = await exploreReversibleStates(
      document,
      sampleRenderedState,
      reversibleStateSession,
      { diagnostics }
    )
    const allSamples = [
      ...baseGroup,
      ...revealedGroups.flat()
    ]
    const base = allSamples[0]!
    const revealed = allSamples.slice(1)
    const excludedGraphicIds = [...new Set(
      [base, ...revealed].flatMap(item => item.excludedGraphicIds)
    )].sort()
    const quarantined = await quarantineExcludedGraphics(
      mergeControls([
        base.controls,
        ...revealed.map(item => item.controls)
      ]),
      mergeIconTokens([
        base.icons,
        ...revealed.map(item => item.icons)
      ]),
      excludedGraphicIds
    )
    await staticStructureDiagnostics.finalize()
    return {
      typography: mergeTokens([base.typography, ...revealed.map(item => item.typography)]),
      borderRadii: mergeTokens([base.borderRadii, ...revealed.map(item => item.borderRadii)]),
      shadows: mergeTokens([base.shadows, ...revealed.map(item => item.shadows)]),
      colors: {
        primitives: mergeTokens([
          base.colors.primitives,
          ...revealed.map(item => item.colors.primitives)
        ]),
        semantic: mergeTokens([
          base.colors.semantic,
          ...revealed.map(item => item.colors.semantic)
        ]),
        interactive: mergeTokens([
          base.colors.interactive,
          ...revealed.map(item => item.colors.interactive)
        ])
      },
      spacing: mergeSpacing([
        base.spacing,
        ...revealed.map(item => item.spacing)
      ]),
      controls: quarantined.controls,
      composites: mergeComposites([
        base.composites ?? [],
        ...revealed.map(item => item.composites ?? [])
      ]),
      icons: quarantined.icons,
      excludedGraphicIds,
      revealedStates: revealedGroups.length,
      interactionFamilies: [...reversibleStateSession.sampledFamilies].sort(),
      diagnostics: {
        disclosures: await diagnostics.finalize(),
        composites: await compositeDiagnostics.finalize(),
        controls: await controlDiagnostics.finalize()
      },
      candidates: uniqueCandidates(
        [base, ...revealed].map(item => item.candidates)
      ),
      filtered: {
        brandAssets: document.querySelectorAll('img,svg,[role="img"]').length,
        personalTextNodes: countTextNodes(document)
      }
    }
  } finally {
    restoreActiveElement(document, originallyFocused)
    clearCandidateMarkers(document)
  }
}

const listenerMarker = '__smartScanTypographyInspectionListenerV1__'

type InspectionRuntime = {
  onMessage: {
    addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean): void
  }
}

export function registerInspectionListener(
  runtime: InspectionRuntime,
  document: Document,
  marker: Record<string, unknown>
): boolean {
  if (marker[listenerMarker]) return false
  marker[listenerMarker] = true
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false
    if (message?.type !== 'INSPECT_PAGE') return false
    const exploredInteractionFamilies = 'exploredInteractionFamilies' in message &&
      Array.isArray(message.exploredInteractionFamilies)
      ? message.exploredInteractionFamilies.filter(
          (value): value is string => typeof value === 'string'
        )
      : []
    void inspectDocument(document, {
      reversibleStateSession: createReversibleStateSession(exploredInteractionFamilies)
    })
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse(isInteractionRestoreError(error)
        ? {
            ok: false,
            code: INTERACTION_RESTORE_ABORT_CODE,
            reason: isInteractionRestoreReason(error.reason)
              ? error.reason
              : 'unknown'
          }
        : { ok: false, error: String(error) }))
    return true
  })
  return true
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  registerInspectionListener(
    chrome.runtime as unknown as InspectionRuntime,
    document,
    globalThis as unknown as Record<string, unknown>
  )
}
