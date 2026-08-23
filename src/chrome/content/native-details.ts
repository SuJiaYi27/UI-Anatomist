export function nativeDetailsOwner(
  node: HTMLElement
): HTMLDetailsElement | null {
  if (node.tagName !== 'SUMMARY') return null
  const owner = node.parentElement
  if (!owner || owner.tagName !== 'DETAILS' || !owner.isConnected) return null
  const firstSummary = Array.from(owner.children)
    .find(child => child.tagName === 'SUMMARY')
  return firstSummary === node ? owner as HTMLDetailsElement : null
}
