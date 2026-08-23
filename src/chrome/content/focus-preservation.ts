export function deepActiveElement(document: Document): Element | null {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement
  }
  return active
}

type FocusableElement = Element & {
  blur(): void
  focus(options?: FocusOptions): void
}

function focusable(element: Element | null): element is FocusableElement {
  const candidate = element as Partial<FocusableElement> | null
  return typeof candidate?.blur === 'function' && typeof candidate.focus === 'function'
}

export function blurElement(element: Element | null): void {
  if (focusable(element)) element.blur()
}

export function restoreActiveElement(document: Document, before: Element | null): void {
  if (deepActiveElement(document) === before) return
  blurElement(deepActiveElement(document))
  if (
    before &&
    before !== document.body &&
    before !== document.documentElement &&
    before.isConnected &&
    focusable(before)
  ) {
    try {
      before.focus({ preventScroll: true })
    } catch {
      before.focus()
    }
  }
}
