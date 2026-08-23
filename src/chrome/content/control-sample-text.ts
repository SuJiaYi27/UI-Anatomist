import type {
  ControlFamily,
  ControlSampleText,
  ControlToken
} from '../../shared/schema'
import { isSafeControlSampleTextValue } from '../../shared/schema'
import { isRenderedVisualTextContainer } from './rendered-visual'

export type ControlSampleEvidence = ControlSampleText & {
  supportingText?: ControlSampleText
  occurrences: number
}

export type ControlTokenWithSampleEvidence = ControlToken & {
  sampleTextEvidence?: ControlSampleEvidence[]
}

export type ControlCopySample = {
  sampleText: ControlSampleText
  supportingText?: ControlSampleText
}

export type PrivateContextReason =
  | 'selectorAncestor'
  | 'opaquePath'
  | 'entityCluster'
  | 'locationCluster'
  | 'exception'

export type PrivateControlContextEvidence = {
  blocked: boolean
  reasons: Record<PrivateContextReason, boolean>
  /**
   * In-memory evidence only. Callers may classify these nodes relative to an
   * already-bounded transient surface, but must never serialize the nodes.
   */
  matches: Partial<Record<PrivateContextReason, Element[]>>
}

const GRAPHIC_SELECTOR = [
  'svg', 'img', 'picture', 'canvas', '[role="img"]',
  '[data-mat-icon-type="font"]', '[data-mat-icon-name]',
  '[data-icon-type="font"]', '[data-icon-name]', '[fonticon]'
].join(',')
const PEER_CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="tab"]',
  'a[href]'
].join(',')
const PRIVATE_CONTEXT_SELECTOR = [
  '[contenteditable]:not([contenteditable="false"])',
  '[data-message-author-role]',
  '[data-testid*="profile" i]',
  '[data-testid*="account" i]',
  '[data-testid*="conversation-title" i]',
  '[data-testid*="chat-title" i]',
  '[data-testid*="history-item" i]',
  '[data-testid*="project-item" i]',
  '[data-testid*="document-title" i]',
  '[aria-label*="profile" i]',
  '[aria-label*="account" i]',
  '[aria-label*="个人资料"]',
  '[aria-label*="账户"]',
  '[aria-label*="账号"]'
].join(',')

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function privacyProbeText(element: Element): string {
  const values: string[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = node.textContent?.trim()
      if (text) values.push(text)
      return
    }
    if (node.nodeType !== 1) return
    const child = node as Element
    if (
      child !== element &&
      (
        child.matches(GRAPHIC_SELECTOR) ||
        child.matches('input,textarea,select') ||
        child.matches(PEER_CONTROL_SELECTOR) ||
        child.matches(PRIVATE_CONTEXT_SELECTOR) ||
        isHidden(child)
      )
    ) return
    for (const descendant of Array.from(child.childNodes)) visit(descendant)
  }
  visit(element)
  return normalize(values.join(' '))
}

type PeerControlGroup = {
  container: Element
  peers: Element[]
}

function peerControlGroups(element: Element): PeerControlGroup[] {
  const interactive = element.closest(PEER_CONTROL_SELECTOR)
  if (!interactive) return []
  const groups: PeerControlGroup[] = []
  let ancestor = interactive.parentElement
  for (let depth = 0; ancestor && depth < 5; depth += 1) {
    if (
      ancestor === element.ownerDocument.body ||
      ancestor === element.ownerDocument.documentElement
    ) break
    const bounds = ancestor.getBoundingClientRect()
    if (bounds.height > 96) break
    const candidates: Element[] = Array.from(
      ancestor.querySelectorAll(PEER_CONTROL_SELECTOR)
    )
    const peers: Element[] = candidates.filter((candidate): boolean => {
      if (candidate === interactive) return true
      const nestedInsidePeer = candidates.some(other =>
        other !== candidate && other.contains(candidate)
      )
      if (!nestedInsidePeer) return true
      return Boolean(
        candidate.getAttribute('aria-label') ||
        candidate.getAttribute('title')
      )
    })
    if (peers.includes(interactive) && peers.length >= 2) {
      groups.push({ container: ancestor, peers })
    }
    ancestor = ancestor.parentElement
  }
  return groups
}

/**
 * Detects a compact user/entity row from generic control relationships.
 *
 * Product suggestions commonly contain a command plus one dismiss action.
 * Entity rows instead expose the entity label alongside multiple sibling
 * actions, and at least one action's inaccessible metadata repeats the label
 * (for example an options action for that entity). Metadata is used only as a
 * privacy signal and is never returned or serialized.
 */
function entityActionClusterMatches(element: Element): Element[] {
  return peerControlGroups(element).flatMap(({ container, peers }) => {
    if (peers.length < 2 || peers.length > 6) return []
    const visibleLabels = peers
      .map(privacyProbeText)
      .filter(value =>
        value.length >= 2 &&
        isSafeControlSampleTextValue(value)
      )
    if (visibleLabels.length === 0) return []
    const actionMetadata = peers.flatMap(peer =>
      [peer.getAttribute('aria-label'), peer.getAttribute('title')]
        .filter((value): value is string => Boolean(value))
        .map(value => normalize(value).toLowerCase())
    )
    const matched = visibleLabels.some(value => {
      const normalized = value.toLowerCase()
      const repeatedMetadata = actionMetadata.filter(metadata =>
        metadata !== normalized && metadata.includes(normalized)
      )
      if (repeatedMetadata.length === 0) return false
      if (peers.length >= 3) return true
      return repeatedMetadata.some(metadata =>
        !/^(?:dismiss|close|remove|delete|hide|cancel|clear|关闭|取消|移除|删除|忽略|隐藏)(?:\s|$)/i
          .test(metadata)
      )
    })
    return matched ? [container] : []
  })
}

function opaqueContentPathMatches(element: Element): Element[] {
  const link = element.closest<HTMLAnchorElement>('a[href]')
  if (!link) return []
  try {
    const url = new URL(link.href, element.ownerDocument.location.href)
    const opaque = url.pathname
      .split('/')
      .filter(Boolean)
      .some(segment =>
        /^[a-f0-9]{8,}(?:-[a-f0-9]{4,}){2,}$/i.test(segment) ||
        (segment.length >= 16 && /[a-z]/i.test(segment) && /\d/.test(segment))
      )
    return opaque ? [link] : []
  } catch {
    return [link]
  }
}

export function isLikelyPrivateControlCopy(
  values: Array<string | null | undefined>
): boolean {
  const value = normalize(values.filter(Boolean).join(' '))
  if (!value) return false
  return /(?:19|20)\d{2}[-/.]\d{1,2}/.test(value) ||
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i.test(value) ||
    /\b\d{1,2}[_.:]\d{2}[_.:]\d{2}\b/.test(value) ||
    /\b\d+(?:\.\d+)?\s*(?:b|kb|mb|gb|tb)\b/i.test(value) ||
    /(?:截屏|截图|screenshot|screen[- ]?capture).*\d/i.test(value) ||
    /\.(?:docx?|gif|jpe?g|json|mov|mp3|mp4|pdf|png|pptx?|svg|txt|webp|xlsx?|zip)$/i.test(value) ||
    /\b(?:based on|determined by|update|precise|current)\s+(?:your\s+)?(?:ip(?:\s+address)?|location)\b/i.test(value) ||
    /\b(?:ip\s+address|geolocation|coordinates)\b/i.test(value) ||
    /(?:根据|基于).{0,8}IP(?:\s*地址)?(?:确定)?/i.test(value) ||
    /(?:更新|精确|当前).{0,6}(?:位置|定位)/.test(value) ||
    /\b[a-z0-9_-]{24,}\b/i.test(value)
}

function locationPrivacyClusterMatches(element: Element): Element[] {
  let ancestor: Element | null = element
  for (let depth = 0; ancestor && depth < 4; depth += 1) {
    if (
      ancestor === element.ownerDocument.body ||
      ancestor === element.ownerDocument.documentElement
    ) break
    const bounds = ancestor.getBoundingClientRect()
    if (
      (bounds.width === 0 || bounds.width <= 600) &&
      (bounds.height === 0 || bounds.height <= 160) &&
      isLikelyPrivateControlCopy([ancestor.textContent])
    ) return [ancestor]
    ancestor = ancestor.parentElement
  }
  return []
}

function isHidden(element: Element): boolean {
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(element)
  return style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number.parseFloat(style.opacity || '1') === 0
}

function visibleButtonText(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView
  if (!view) return ''
  const values: string[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? '').trim()
      const parent = node.parentElement
      if (
        text &&
        parent &&
        isRenderedVisualTextContainer(parent, view, element)
      ) values.push(text)
      return
    }
    if (node.nodeType !== 1) return
    const child = node as Element
    if (
      child !== element &&
      (
        child.matches(GRAPHIC_SELECTOR) ||
        child.matches('input,textarea,select') ||
        isPrivateControlContext(child as HTMLElement) ||
        isHidden(child)
      )
    ) return
    for (const descendant of Array.from(child.childNodes)) visit(descendant)
  }
  visit(element)
  return values.join(' ')
}

export function hasLikelyPrivateControlCopy(element: HTMLElement): boolean {
  const values: string[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const value = node.textContent?.trim()
      if (value) values.push(value)
      return
    }
    if (node.nodeType !== 1) return
    const child = node as Element
    if (
      child !== element &&
      (
        child.matches(GRAPHIC_SELECTOR) ||
        child.matches('input,textarea,select') ||
        isPrivateControlContext(child as HTMLElement) ||
        isHidden(child)
      )
    ) return
    for (const descendant of Array.from(child.childNodes)) visit(descendant)
  }
  for (const child of Array.from(element.childNodes)) visit(child)
  return isLikelyPrivateControlCopy(values)
}

export function privateControlContextEvidence(
  element: Element
): PrivateControlContextEvidence {
  const reasons: Record<PrivateContextReason, boolean> = {
    selectorAncestor: false,
    opaquePath: false,
    entityCluster: false,
    locationCluster: false,
    exception: false
  }
  const matches: PrivateControlContextEvidence['matches'] = {}
  const collect = (
    reason: Exclude<PrivateContextReason, 'exception'>,
    getMatches: () => Element[]
  ): void => {
    try {
      const found = getMatches()
      if (found.length === 0) return
      reasons[reason] = true
      matches[reason] = found
    } catch {
      reasons.exception = true
    }
  }
  collect('selectorAncestor', () => {
    const match = element.closest(PRIVATE_CONTEXT_SELECTOR)
    return match ? [match] : []
  })
  collect('opaquePath', () => opaqueContentPathMatches(element))
  collect('entityCluster', () => entityActionClusterMatches(element))
  collect('locationCluster', () => locationPrivacyClusterMatches(element))
  return {
    blocked: Object.values(reasons).some(Boolean),
    reasons,
    matches
  }
}

export function isPrivateControlContext(element: Element): boolean {
  return privateControlContextEvidence(element).blocked
}

export function allowsControlSampleContext(
  element: HTMLElement,
  family: ControlFamily,
  value: string
): boolean {
  if (isPrivateControlContext(element)) return false
  if (
    family === 'button' &&
    element.matches(
      '[role="option"],[role="menuitemradio"],[role="menuitemcheckbox"]'
    )
  ) return false
  const normalized = normalize(value)
  const popup = element.getAttribute('aria-haspopup')
  const contextualLabel = normalize(element.getAttribute('aria-label') ?? '')
  if (
    family === 'button' &&
    popup !== null &&
    popup !== 'false' &&
    /^[a-z0-9._/-]+$/.test(normalized) &&
    contextualLabel.toLowerCase().startsWith(`${normalized.toLowerCase()} `)
  ) return false
  return true
}

export function controlSampleCandidate(
  element: HTMLElement,
  family: ControlFamily
): ControlSampleText | null {
  let raw = ''
  let source: ControlSampleText['source']
  if (family === 'button') {
    raw = visibleButtonText(element)
    source = 'visible-text'
  } else if (family === 'input' || family === 'textarea') {
    raw = element.getAttribute('placeholder') ?? ''
    source = 'placeholder'
  } else {
    return null
  }

  const value = normalize(raw)
  if (!allowsControlSampleContext(element, family, value)) return null
  if (!isSafeControlSampleTextValue(raw) || !isSafeControlSampleTextValue(value)) {
    return null
  }
  return { value, source }
}

function compareControlSampleEvidence(
  left: ControlSampleEvidence,
  right: ControlSampleEvidence
): number {
  const rank: Record<ControlSampleText['source'], number> = {
    'visible-text': 0,
    placeholder: 1
  }
  const supportingSourceDifference = left.supportingText && right.supportingText
    ? rank[left.supportingText.source] - rank[right.supportingText.source]
    : left.supportingText
      ? -1
      : right.supportingText
        ? 1
        : 0
  const leftSupportingValue = left.supportingText?.value ?? ''
  const rightSupportingValue = right.supportingText?.value ?? ''
  return right.occurrences - left.occurrences ||
    rank[left.source] - rank[right.source] ||
    (left.value < right.value ? -1 : left.value > right.value ? 1 : 0) ||
    supportingSourceDifference ||
    (
      leftSupportingValue < rightSupportingValue
        ? -1
        : leftSupportingValue > rightSupportingValue
          ? 1
          : 0
    )
}

export function chooseControlCopy(
  evidence: Iterable<ControlSampleEvidence>
): ControlCopySample | undefined {
  const winner = [...evidence].sort(compareControlSampleEvidence)[0]
  if (!winner) return undefined
  return {
    sampleText: { value: winner.value, source: winner.source },
    ...(winner.supportingText
      ? { supportingText: { ...winner.supportingText } }
      : {})
  }
}

export function chooseControlSample(
  evidence: Iterable<ControlSampleEvidence>
): ControlSampleText | undefined {
  return chooseControlCopy(evidence)?.sampleText
}

export function mergeControlSampleEvidence(
  ...groups: Array<Iterable<ControlSampleEvidence> | undefined>
): ControlSampleEvidence[] {
  const merged = new Map<string, ControlSampleEvidence>()
  for (const group of groups) {
    if (!group) continue
    for (const evidence of group) {
      const key = [
        evidence.source,
        evidence.value,
        evidence.supportingText?.source ?? '',
        evidence.supportingText?.value ?? ''
      ].join('\u0000')
      const existing = merged.get(key)
      merged.set(key, existing
        ? {
            ...existing,
            occurrences: existing.occurrences + evidence.occurrences
          }
        : { ...evidence })
    }
  }
  return [...merged.values()]
}
