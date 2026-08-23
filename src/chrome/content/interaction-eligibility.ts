/**
 * Returns whether UI-Anatomist may safely synthesize an interaction for a node.
 *
 * This is deliberately separate from visual collection: disabled, inert, or
 * pointer-blocked controls can still be useful design evidence even though the
 * scanner must never click, hover, or navigate through them.
 */
export function isInteractionEligible(
  element: HTMLElement,
  view: Window | null = element.ownerDocument.defaultView
): boolean {
  if (
    !element.isConnected ||
    element.matches(':disabled') ||
    element.closest([
      'script',
      'style',
      'noscript',
      'template',
      '[hidden]',
      '[aria-hidden="true"]',
      '[aria-disabled="true"]',
      '[inert]',
      '[data-smart-scan-overlay="true"]'
    ].join(','))
  ) return false

  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current)
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      Number.parseFloat(style?.opacity || '1') === 0 ||
      style?.pointerEvents === 'none'
    ) return false
  }

  return true
}
