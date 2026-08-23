import { isPrivateControlContext } from './control-sample-text'
import { FONT_ICON_SELECTOR, isFontIconCandidate } from './font-icon'
import {
  HOVER_PROBE_ATTRIBUTE,
  installHoverStyle,
  type HoverStyleLoaderOptions
} from './hover-style-loader'

export { HOVER_PROBE_ATTRIBUTE } from './hover-style-loader'
export const HOVER_TARGET_ATTRIBUTE = 'data-smart-scan-hover-target'

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"]):not([type="file"]):not([type="image"]):not([type="range"]):not([type="color"])',
  'textarea',
  'select',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]'
].join(',')

export type HoverStateSession = {
  sampledFamilies: Set<string>
}

function dispatchHoverEvent(element: HTMLElement, type: string, bubbles: boolean): void {
  const event = element.ownerDocument.createEvent('Event')
  event.initEvent(type, bubbles, false)
  element.dispatchEvent(event)
}

function dispatchHoverEntry(element: HTMLElement): void {
  for (const [type, bubbles] of [
    ['pointerover', true],
    ['pointerenter', false],
    ['mouseover', true],
    ['mouseenter', false]
  ] as const) dispatchHoverEvent(element, type, bubbles)
}

function dispatchHoverExit(element: HTMLElement): void {
  for (const [type, bubbles] of [
    ['pointerout', true],
    ['pointerleave', false],
    ['mouseout', true],
    ['mouseleave', false]
  ] as const) dispatchHoverEvent(element, type, bubbles)
}

function visible(element: HTMLElement, view: Window): boolean {
  if (
    !element.isConnected ||
    element.matches(':disabled,[aria-disabled="true"]') ||
    element.closest(
      'script,style,noscript,template,[hidden],[aria-hidden="true"],[data-smart-scan-overlay="true"]'
    )
  ) return false
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      style.pointerEvents === 'none'
    ) return false
  }
  const bounds = element.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0
}

function controlsNativeFilePicker(element: HTMLElement): boolean {
  if (element.matches('input[type="file"]') || element.querySelector('input[type="file"]')) {
    return true
  }
  const label = element.closest<HTMLLabelElement>('label')
  if (label?.control?.matches('input[type="file"]')) return true
  const document = element.ownerDocument
  return [element.getAttribute('for'), element.getAttribute('aria-controls')]
    .filter((value): value is string => Boolean(value))
    .flatMap(value => value.trim().split(/\s+/).filter(Boolean))
    .some(id => document.getElementById(id)?.matches('input[type="file"]'))
}

function normalizedClassList(element: HTMLElement): string {
  return [...element.classList]
    .filter(value => !value.startsWith('data-smart-scan-'))
    .sort()
    .join('.')
}

function structuralFamily(element: HTMLElement, view: Window): string {
  const svg = element.matches('svg') ? element : element.querySelector('svg')
  const fontIcon = [element, ...Array.from(element.querySelectorAll(FONT_ICON_SELECTOR))]
    .find(candidate => isFontIconCandidate(candidate, view))
  const geometry = svg
    ? [
        svg.getAttribute('viewBox') ?? '',
        ...Array.from(svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse'))
          .slice(0, 12)
          .map(node => [
            node.tagName.toLowerCase(),
            node.getAttribute('d') ?? '',
            node.getAttribute('points') ?? '',
            node.getAttribute('cx') ?? '',
            node.getAttribute('cy') ?? '',
            node.getAttribute('r') ?? '',
            node.getAttribute('x') ?? '',
            node.getAttribute('y') ?? '',
            node.getAttribute('width') ?? '',
            node.getAttribute('height') ?? ''
          ].join(':'))
      ].join('|')
    : fontIcon
      ? [
          'font',
          view.getComputedStyle(fontIcon).fontFamily,
          fontIcon.getAttribute('data-mat-icon-name') ??
            fontIcon.getAttribute('data-icon-name') ??
            fontIcon.getAttribute('fonticon') ??
            fontIcon.textContent?.trim().slice(0, 32) ?? ''
        ].join('|')
      : ''
  return [
    element.tagName.toLowerCase(),
    element.getAttribute('role')?.toLowerCase() ?? '',
    element.getAttribute('type')?.toLowerCase() ?? '',
    element.getAttribute('aria-haspopup')?.toLowerCase() ?? '',
    normalizedClassList(element),
    geometry
  ].join('|')
}

function styleFingerprint(element: HTMLElement, view: Window): string {
  const nodes = [element, ...Array.from(element.querySelectorAll<HTMLElement | SVGElement>('*')).slice(0, 20)]
  const fingerprint = (style: CSSStyleDeclaration) => [
    style.content,
    style.display,
    style.visibility,
    style.backgroundColor,
    style.color,
    style.borderTopColor,
    style.borderTopWidth,
    style.borderRadius,
    style.boxShadow,
    style.outlineColor,
    style.outlineWidth,
    style.opacity,
    style.fill,
    style.stroke,
    style.strokeWidth,
    style.transform,
    style.width,
    style.height,
    style.inset,
    style.padding,
    style.gap
  ].join(';')
  return nodes.map(node => {
    const styles = [fingerprint(view.getComputedStyle(node))]
    for (const pseudo of ['::before', '::after'] as const) {
      try {
        styles.push(fingerprint(view.getComputedStyle(node, pseudo)))
      } catch {
        styles.push('')
      }
    }
    return styles.join('::')
  }).join('||')
}

async function settle(document: Document): Promise<void> {
  const view = document.defaultView
  await new Promise<void>(resolve => {
    if (!view?.requestAnimationFrame) {
      view?.setTimeout(resolve, 0)
      return
    }
    view.requestAnimationFrame(() => resolve())
  })
}

async function settleActiveAnimations(document: Document): Promise<void> {
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

function probeChain(element: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = []
  for (
    let current: HTMLElement | null = element;
    current && current !== element.ownerDocument.body && current !== element.ownerDocument.documentElement;
    current = current.parentElement
  ) chain.push(current)
  return chain
}

export function createHoverStateSession(): HoverStateSession {
  return { sampledFamilies: new Set<string>() }
}

export async function exploreHoverStates<T>(
  document: Document,
  sample: () => Promise<T>,
  session: HoverStateSession = createHoverStateSession(),
  loaderOptions: HoverStyleLoaderOptions = {}
): Promise<T[]> {
  const view = document.defaultView
  if (!view) return []
  const style = await installHoverStyle(document, loaderOptions)
  const changedTargets: Array<{ candidate: HTMLElement; chain: HTMLElement[]; family: string }> = []
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR))
  try {
    for (const candidate of candidates) {
      if (
        !visible(candidate, view) ||
        controlsNativeFilePicker(candidate) ||
        isPrivateControlContext(candidate)
      ) continue
      const family = structuralFamily(candidate, view)
      if (session.sampledFamilies.has(family)) continue
      session.sampledFamilies.add(family)
      const before = styleFingerprint(candidate, view)
      const chain = probeChain(candidate)
      chain.forEach(node => node.setAttribute(HOVER_PROBE_ATTRIBUTE, 'true'))
      candidate.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
      dispatchHoverEntry(candidate)
      await settle(document)
      const after = styleFingerprint(candidate, view)
      if (before !== after) changedTargets.push({ candidate, chain, family })
      dispatchHoverExit(candidate)
      candidate.removeAttribute(HOVER_TARGET_ATTRIBUTE)
      chain.forEach(node => node.removeAttribute(HOVER_PROBE_ATTRIBUTE))
      await settle(document)
    }
    if (!changedTargets.length) return []

    const changedNodes = new Set(changedTargets.flatMap(target => target.chain))
    changedNodes.forEach(node => node.setAttribute(HOVER_PROBE_ATTRIBUTE, 'true'))
    changedTargets.forEach(({ candidate }) => {
      candidate.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
      dispatchHoverEntry(candidate)
    })
    await settle(document)
    await settleActiveAnimations(document)
    const snapshot = await sample()
    changedTargets.forEach(({ candidate }) => {
      dispatchHoverExit(candidate)
      candidate.removeAttribute(HOVER_TARGET_ATTRIBUTE)
    })
    changedNodes.forEach(node => node.removeAttribute(HOVER_PROBE_ATTRIBUTE))
    await settle(document)
    return [snapshot]
  } finally {
    document.querySelectorAll(`[${HOVER_PROBE_ATTRIBUTE}]`).forEach(node => {
      node.removeAttribute(HOVER_PROBE_ATTRIBUTE)
    })
    document.querySelectorAll(`[${HOVER_TARGET_ATTRIBUTE}]`).forEach(node => {
      node.removeAttribute(HOVER_TARGET_ATTRIBUTE)
    })
    style?.remove()
  }
}
