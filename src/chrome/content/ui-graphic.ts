import {
  FONT_ICON_SELECTOR,
  isFontIconCandidate,
  sanitizeFontIcon,
  type FontIconDependencies
} from './font-icon'
import {
  sanitizeUiVector,
  type SanitizedUiVector,
  type UiVectorOptions
} from './ui-vector'

export const UI_GRAPHIC_SELECTOR = `svg,${FONT_ICON_SELECTOR}`

export type UiGraphicCandidate =
  | { kind: 'svg'; host: SVGElement }
  | { kind: 'font'; host: HTMLElement }

export type UiGraphicOptions = {
  vector?: UiVectorOptions
  font?: FontIconDependencies
}

export function uiGraphicCandidate(
  element: Element,
  view: Window
): UiGraphicCandidate | null {
  if (element.tagName.toLowerCase() === 'svg') {
    return { kind: 'svg', host: element as SVGElement }
  }
  return isFontIconCandidate(element, view)
    ? { kind: 'font', host: element }
    : null
}

export function discoverUiGraphicCandidates(
  root: ParentNode,
  view: Window
): UiGraphicCandidate[] {
  return Array.from(root.querySelectorAll(UI_GRAPHIC_SELECTOR))
    .map(element => uiGraphicCandidate(element, view))
    .filter((candidate): candidate is UiGraphicCandidate => candidate !== null)
}

export async function sanitizeUiGraphic(
  candidate: UiGraphicCandidate,
  view: Window,
  options: UiGraphicOptions = {}
): Promise<SanitizedUiVector | null> {
  return candidate.kind === 'svg'
    ? sanitizeUiVector(candidate.host, view, options.vector)
    : sanitizeFontIcon(candidate.host, view, options.font)
}

export async function sanitizeUiGraphicElement(
  element: Element,
  view: Window,
  options: UiGraphicOptions = {}
): Promise<SanitizedUiVector | null> {
  const candidate = uiGraphicCandidate(element, view)
  return candidate ? sanitizeUiGraphic(candidate, view, options) : null
}
