const WEBSITE_OPERATION_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[aria-haspopup]'
].join(',')

const CONTENT_ITEMPROPS = new Set(['articlebody', 'commenttext'])
const CONTENT_MARKER =
  /(?:^|[\s_-])(?:user-content|user-generated|ugc|markdown-body|rendered-markdown|rich-text|prose|(?:comment|post|message|article|thread)-(?:body|content|item|renderer|text|thread)|editor-output)(?=$|[\s_-])/i
const GRAPHIC_PAYLOAD_SELECTOR = 'img,svg,picture,video,canvas,[role="img"]'

function normalizedMarker(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

function hasStrongContentMarker(element: Element): boolean {
  if (
    element.hasAttribute('data-user-content') ||
    element.hasAttribute('data-ugc') ||
    element.hasAttribute('data-message-author-role') ||
    element.matches(
      'article,[role="article"],[contenteditable]:not([contenteditable="false"])'
    )
  ) return true
  const itemprop = element.getAttribute('itemprop')?.trim().toLowerCase()
  if (itemprop && CONTENT_ITEMPROPS.has(itemprop)) return true
  return CONTENT_MARKER.test(normalizedMarker([
    element.tagName,
    element.getAttribute('id') ?? '',
    element.getAttribute('class') ?? '',
    element.getAttribute('data-content-type') ?? ''
  ].join(' ')))
}

export function authorContentRootFor(element: Element): Element | null {
  for (
    let current: Element | null = element;
    current && !current.matches('html,body');
    current = current.parentElement
  ) {
    if (hasStrongContentMarker(current)) return current
  }
  return null
}

/**
 * A non-graphic element inside a strong author-content root is still a
 * website-owned presentation surface. Its computed typography, colors,
 * spacing, radii and shadows describe how the product renders arbitrary
 * content; only the graphic/text payload itself must be withheld.
 */
export function isWebsiteAppliedContentPresentation(element: Element): boolean {
  return !element.closest(GRAPHIC_PAYLOAD_SELECTOR) &&
    authorContentRootFor(element) !== null
}

export function isWebsiteOperation(element: Element): boolean {
  return Boolean(element.closest(WEBSITE_OPERATION_SELECTOR))
}

/**
 * Returns true only for high-confidence author-supplied graphic payloads.
 *
 * The content region itself is not excluded. A website-owned operation inside
 * the same region remains eligible, and other collectors can still observe
 * typography and wrapper geometry around this graphic.
 */
export function isAuthorSuppliedGraphicPayload(element: Element): boolean {
  const contentRoot = authorContentRootFor(element)
  if (!contentRoot) return false
  const operation = element.closest(WEBSITE_OPERATION_SELECTOR)
  return !operation || !contentRoot.contains(operation)
}
