function normalizeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized && /[\p{L}\p{N}]/u.test(normalized) ? normalized : null
}

/**
 * Returns every semantic label source that can influence whether automation is
 * safe. These strings are used only in memory for risk checks and are never
 * serialized as scan evidence.
 */
export function semanticControlLabels(node: HTMLElement): string[] {
  const referencedLabels = (node.getAttribute('aria-labelledby') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(id => normalizeLabel(node.ownerDocument.getElementById(id)?.textContent))

  const labels = [
    ...referencedLabels,
    normalizeLabel(node.getAttribute('aria-label')),
    normalizeLabel(node.getAttribute('title')),
    normalizeLabel(node.textContent)
  ].filter((label): label is string => label !== null)

  return [...new Set(labels)]
}
