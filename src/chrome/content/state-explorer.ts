import {
  clearCandidateMarkers,
  discoverCandidates,
  type DiscoveredCandidate
} from './discover'
import {
  disclosureDiagnosticObservation,
  type DisclosureDiagnosticRecorder
} from './disclosure-diagnostics'

const transientSelector = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tree"]',
  '[popover]',
  'nav',
  '[role="navigation"]',
  'aside'
].join(',')
const closeControlSelector = 'button,[role="button"]'
const closeLabel = /\b(close|dismiss|cancel|collapse|hide)\b|关闭|取消|收起|隐藏/i
const openLabel = /\b(open|show|expand)\b|打开|显示|展开/i
const pointerPopupValues = new Set(['true', 'dialog', 'menu', 'listbox', 'tree', 'grid'])

export const TRANSIENT_STRUCTURE_ATTRIBUTE = 'data-smart-scan-transient-structure'
export const TRANSIENT_OWNER_ATTRIBUTE = 'data-smart-scan-transient-owner'

type TransientState = {
  hidden: boolean
  open: boolean
  ariaHidden: string | null
  style: string | null
  visible: boolean
}
type ActivationMode = 'click' | 'pointer-press'

export type ReversibleStateSession = {
  sampledFamilies: Set<string>
}

type StateExplorerOptions = {
  diagnostics?: DisclosureDiagnosticRecorder
}

export function createReversibleStateSession(
  sampledFamilies: Iterable<string> = []
): ReversibleStateSession {
  return { sampledFamilies: new Set(sampledFamilies) }
}

async function settle(document: Document): Promise<void> {
  await new Promise<void>(resolve => {
    const view = document.defaultView
    if (!view?.requestAnimationFrame) {
      view?.setTimeout(resolve, 0)
      return
    }
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()))
  })
  const getAnimations = (document as Document & { getAnimations?: () => Animation[] }).getAnimations
  if (!getAnimations) return
  const animations = getAnimations.call(document)
    .filter(animation => animation.playState !== 'finished')
  if (!animations.length) return
  const timeout = new Promise<void>(resolve => document.defaultView?.setTimeout(resolve, 350))
  await Promise.race([
    Promise.allSettled(animations.map(animation => animation.finished)),
    timeout
  ])
}

async function nextFrame(document: Document): Promise<void> {
  await new Promise<void>(resolve => {
    const view = document.defaultView
    if (!view?.requestAnimationFrame) {
      view?.setTimeout(resolve, 0)
      return
    }
    view.requestAnimationFrame(() => resolve())
  })
}

function pointerEvent(
  document: Document,
  type: 'pointerdown' | 'pointerup',
  buttons: number
): Event | null {
  const view = document.defaultView
  if (!view) return null
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons
  }
  const PointerEventConstructor = (
    view as typeof view & { PointerEvent?: typeof PointerEvent }
  ).PointerEvent
  return PointerEventConstructor
    ? new PointerEventConstructor(type, {
        ...init,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      })
    : new view.MouseEvent(type, init)
}

function nativeFileEventTarget(event: Event): boolean {
  const target = event.composedPath()[0]
  if (!target || typeof target !== 'object' || !('nodeType' in target)) return false
  const element = target as Element
  if (element.nodeType !== 1) return false
  if (element.matches('input[type="file"]')) return true
  const label = element.closest<HTMLLabelElement>('label')
  return label?.control?.matches('input[type="file"]') ?? false
}

function withNativeFileGuard(control: HTMLElement, action: () => void): void {
  const document = control.ownerDocument
  const guard = (event: Event) => {
    if (!nativeFileEventTarget(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  document.addEventListener('click', guard, true)
  try {
    action()
  } finally {
    document.removeEventListener('click', guard, true)
  }
}

async function dispatchPointerPress(control: HTMLElement): Promise<void> {
  const document = control.ownerDocument
  const down = pointerEvent(document, 'pointerdown', 1)
  if (down) withNativeFileGuard(control, () => control.dispatchEvent(down))
  await nextFrame(document)
  const up = pointerEvent(document, 'pointerup', 0)
  if (up) withNativeFileGuard(control, () => {
    (control.isConnected ? control : document.documentElement).dispatchEvent(up)
  })
}

function supportsPointerPressFallback(
  control: HTMLElement,
  kind: DiscoveredCandidate['kind']
): boolean {
  if (kind !== 'disclosure') return false
  const nativeButton = control.matches('button')
  const customButton = control.getAttribute('role')?.toLowerCase() === 'button'
  if (!nativeButton && !customButton) return false
  if (control.matches('input,select,textarea,a[href]')) return false
  const popup = control.getAttribute('aria-haspopup')?.toLowerCase()
  return control.hasAttribute('aria-expanded') ||
    (popup !== undefined && pointerPopupValues.has(popup))
}

function transientVisible(node: HTMLElement): boolean {
  const style = node.ownerDocument.defaultView?.getComputedStyle(node)
  return !node.hasAttribute('hidden') &&
    node.getAttribute('aria-hidden') !== 'true' &&
    style?.display !== 'none' &&
    style?.visibility !== 'hidden'
}

function captureTransients(document: Document): Map<HTMLElement, TransientState> {
  return new Map(
    Array.from(document.querySelectorAll<HTMLElement>(transientSelector)).map(node => [
      node,
      {
        hidden: node.hasAttribute('hidden'),
        open: node.hasAttribute('open'),
        ariaHidden: node.getAttribute('aria-hidden'),
        style: node.getAttribute('style'),
        visible: transientVisible(node)
      }
    ])
  )
}

function findOpenedTransient(
  document: Document,
  before: Map<HTMLElement, TransientState>
): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(transientSelector))
    .find(node => transientVisible(node) && (!before.has(node) || !before.get(node)?.visible)) ?? null
}

function restoreTransients(
  document: Document,
  before: Map<HTMLElement, TransientState>
): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(transientSelector))) {
    if (!before.has(node)) node.remove()
  }
  for (const [node, state] of before) {
    if (!node.isConnected) continue
    node.toggleAttribute('hidden', state.hidden)
    node.toggleAttribute('open', state.open)
    if (state.ariaHidden === null) node.removeAttribute('aria-hidden')
    else node.setAttribute('aria-hidden', state.ariaHidden)
    if (state.style === null) node.removeAttribute('style')
    else node.setAttribute('style', state.style)
  }
}

function dispatchEscape(document: Document): void {
  const view = document.defaultView
  if (!view) return
  document.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.dispatchEvent(new view.KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
}

function findCloseControl(dialog: HTMLElement | null): HTMLElement | null {
  return dialog?.querySelector<HTMLElement>([
    'button[aria-label*="close" i]',
    'button[title*="close" i]',
    'button[aria-label*="dismiss" i]',
    'button[title*="dismiss" i]',
    'button[aria-label*="cancel" i]',
    'button[aria-label*="关闭"]',
    'button[aria-label*="取消"]'
  ].join(',')) ?? null
}

function controlLabel(node: HTMLElement): string {
  return (
    node.getAttribute('aria-label') ??
    node.getAttribute('title') ??
    node.textContent ??
    ''
  ).trim()
}

function controlVisible(node: HTMLElement): boolean {
  if (node.matches(':disabled,[aria-disabled="true"]')) return false
  if (node.closest('[hidden],[aria-hidden="true"]')) return false
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.pointerEvents === 'none' ||
      style?.opacity === '0'
    ) return false
  }
  return true
}

function normalizedInteractionLabel(label: string): string {
  return label.trim().toLowerCase()
    .replace(/\bfor\s+.+$/i, 'for:*')
    .replace(/[a-f0-9]{8,}(?:-[a-f0-9]{4,})+/gi, ':id')
    .replace(/\d+/g, ':n')
    .replace(/\s+/g, ' ')
}

function interactionFamily(
  control: HTMLElement,
  label: string,
  kind: DiscoveredCandidate['kind']
): string {
  const popup = control.getAttribute('aria-haspopup')?.toLowerCase() ?? ''
  const role = control.getAttribute('role')?.toLowerCase() ?? control.tagName.toLowerCase()
  const contextNode = control.parentElement?.closest<HTMLElement>('[aria-label],[role]') ?? null
  return [
    kind,
    role,
    popup,
    normalizedInteractionLabel(label),
    normalizedInteractionLabel(contextNode?.getAttribute('aria-label') ?? ''),
    contextNode?.getAttribute('role')?.toLowerCase() ?? ''
  ].join('|')
}

function captureCloseControls(document: Document): Set<HTMLElement> {
  return new Set(
    Array.from(document.querySelectorAll<HTMLElement>(closeControlSelector))
      .filter(node => closeLabel.test(controlLabel(node)) && controlVisible(node))
  )
}

function normalizedControlSubject(label: string): string {
  return label.toLowerCase()
    .replace(openLabel, '')
    .replace(closeLabel, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function findReplacementCloseControl(
  document: Document,
  before: Set<HTMLElement>,
  triggerLabel: string,
  controlledId: string | null
): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(closeControlSelector))
    .filter(node => !before.has(node) && closeLabel.test(controlLabel(node)) && controlVisible(node))
  if (!candidates.length) return null
  const controlledRegion = controlledId ? document.getElementById(controlledId) : null
  const scoped = controlledRegion
    ? candidates.filter(node => controlledRegion.contains(node))
    : []
  if (scoped.length === 1) return scoped[0] ?? null
  const subject = normalizedControlSubject(triggerLabel)
  const matching = subject
    ? candidates.filter(node => normalizedControlSubject(controlLabel(node)) === subject)
    : []
  if (matching.length === 1) return matching[0] ?? null
  return candidates.length === 1 ? candidates[0] ?? null : null
}

function activationChangedStructure(
  document: Document,
  control: HTMLElement,
  kind: DiscoveredCandidate['kind'],
  before: {
    expanded: string | null
    transients: Map<HTMLElement, TransientState>
    closeControls: Set<HTMLElement>
    selectedTab: HTMLElement | null
    triggerLabel: string
    controlledId: string | null
  }
): boolean {
  if (!control.isConnected) return true
  if (findOpenedTransient(document, before.transients)) return true
  if (control.getAttribute('aria-expanded') !== before.expanded) return true
  if (
    kind === 'tab' &&
    before.selectedTab !== control &&
    control.getAttribute('aria-selected') === 'true'
  ) return true
  return Boolean(findReplacementCloseControl(
    document,
    before.closeControls,
    before.triggerLabel,
    before.controlledId
  ))
}

async function activate(control: HTMLElement, mode: ActivationMode): Promise<void> {
  if (mode === 'pointer-press') await dispatchPointerPress(control)
  else withNativeFileGuard(control, () => control.click())
}

function recordStage(
  diagnostics: DisclosureDiagnosticRecorder | undefined,
  control: HTMLElement,
  candidate: DiscoveredCandidate,
  stage: Parameters<typeof disclosureDiagnosticObservation>[1]['stage']
): void {
  diagnostics?.record(control, disclosureDiagnosticObservation(control, {
    risk: candidate.risk,
    riskReason: candidate.risk === 'safe' ? 'reversible-semantic' : 'default-uncertain',
    stage
  }))
}

export async function exploreReversibleStates<T>(
  document: Document,
  sample: () => Promise<T>,
  session: ReversibleStateSession = createReversibleStateSession(),
  options: StateExplorerOptions = {}
): Promise<T[]> {
  const snapshots: T[] = []
  const maximumNestedDepth = 2
  const explore = async (scope: HTMLElement | null, depth: number): Promise<void> => {
    while (!scope || scope.isConnected) {
      let next: {
        candidate: DiscoveredCandidate
        control: HTMLElement
        family: string
      } | undefined
      for (const candidate of discoverCandidates(document)) {
        if (candidate.target !== 'reversible-click' || candidate.risk !== 'safe') continue
        const control = document.querySelector<HTMLElement>(candidate.selector)
        if (!control || (scope && !scope.contains(control))) continue
        const family = interactionFamily(control, candidate.label, candidate.kind)
        if (session.sampledFamilies.has(family)) {
          recordStage(options.diagnostics, control, candidate, 'family-skipped')
          continue
        }
        next = { candidate, control, family }
        break
      }
      if (!next) break

      const { candidate, control, family } = next
      session.sampledFamilies.add(family)
      recordStage(options.diagnostics, control, candidate, 'activation-attempted')
      const tabScope = candidate.kind === 'tab'
        ? control.closest<HTMLElement>('[role="tablist"]') ?? control.parentElement
        : null
      const selectedTab = tabScope?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null
      const expandedBefore = control.getAttribute('aria-expanded')
      const transientsBefore = captureTransients(document)
      const closeControlsBefore = captureCloseControls(document)
      const triggerLabel = controlLabel(control)
      const controlledId = control.getAttribute('aria-controls')
      const activationBefore = {
        expanded: expandedBefore,
        transients: transientsBefore,
        closeControls: closeControlsBefore,
        selectedTab,
        triggerLabel,
        controlledId
      }
      let activationMode: ActivationMode = 'click'
      await activate(control, activationMode)
      await settle(document)
      if (
        supportsPointerPressFallback(control, candidate.kind) &&
        !activationChangedStructure(document, control, candidate.kind, activationBefore)
      ) {
        activationMode = 'pointer-press'
        await activate(control, activationMode)
        await settle(document)
      }

      let markedTransient: HTMLElement | null = null
      let previousTransientMarker: string | null = null
      try {
        const openedTransient = findOpenedTransient(document, transientsBefore)
        markedTransient = openedTransient
        previousTransientMarker = openedTransient?.getAttribute(TRANSIENT_STRUCTURE_ATTRIBUTE) ?? null
        openedTransient?.setAttribute(TRANSIENT_STRUCTURE_ATTRIBUTE, 'true')
        recordStage(
          options.diagnostics,
          control,
          candidate,
          openedTransient ? 'opened-transient' : 'activation-no-structure'
        )
        snapshots.push(await sample())
        recordStage(options.diagnostics, control, candidate, 'sampled')
        if (openedTransient && depth < maximumNestedDepth) {
          await explore(openedTransient, depth + 1)
        }
      } finally {
        if (markedTransient?.isConnected) {
          if (previousTransientMarker === null) {
            markedTransient.removeAttribute(TRANSIENT_STRUCTURE_ATTRIBUTE)
          } else {
            markedTransient.setAttribute(
              TRANSIENT_STRUCTURE_ATTRIBUTE,
              previousTransientMarker
            )
          }
        }
        const openedTransient = findOpenedTransient(document, transientsBefore)
        const close = findCloseControl(openedTransient) ?? (
          candidate.kind === 'disclosure'
            ? findReplacementCloseControl(
                document,
                closeControlsBefore,
                triggerLabel,
                controlledId
              )
            : null
        )
        let restoredByTrigger = false
        if (close) {
          close.click()
        } else if (candidate.kind === 'disclosure' && control.isConnected) {
          const expandedChanged = expandedBefore !== null &&
            control.getAttribute('aria-expanded') !== expandedBefore
          if (expandedChanged || Boolean(openedTransient)) {
            await activate(control, activationMode)
            restoredByTrigger = true
          }
        }
        await settle(document)
        if (findOpenedTransient(document, transientsBefore)) {
          dispatchEscape(document)
          await settle(document)
        }
        restoreTransients(document, transientsBefore)
        if (selectedTab && selectedTab !== control) selectedTab.click()
        else if (
          !close &&
          !restoredByTrigger &&
          expandedBefore !== null &&
          control.isConnected &&
          control.getAttribute('aria-expanded') !== expandedBefore
        ) await activate(control, activationMode)
        await settle(document)
        recordStage(options.diagnostics, control, candidate, 'restored')
      }
    }
  }

  try {
    await explore(null, 0)
  } finally {
    clearCandidateMarkers(document)
  }
  return snapshots
}
