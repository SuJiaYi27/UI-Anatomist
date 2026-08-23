export type VerticalScrollSamplingOptions = {
  includeCurrent?: boolean
  maximumContainers?: number
  maximumPositions?: number
  settle?: () => Promise<void>
}

type ScrollTarget = {
  node: HTMLElement
  originalTop: number
  maximumTop: number
}

function isVisible(node: HTMLElement, view: Window | null): boolean {
  if (node.closest('[hidden],[aria-hidden="true"]')) return false
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current)
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.opacity === '0'
    ) return false
  }
  return true
}

function isDocumentScroller(document: Document, node: HTMLElement): boolean {
  return (
    node === document.scrollingElement ||
    node === document.documentElement ||
    node === document.body
  )
}

function discoverScrollTargets(
  document: Document,
  maximumContainers: number
): ScrollTarget[] {
  const view = document.defaultView
  const nodes = new Set<HTMLElement>()
  const scrollingElement = document.scrollingElement
  if (scrollingElement instanceof (view?.HTMLElement ?? HTMLElement)) {
    nodes.add(scrollingElement as HTMLElement)
  }
  if (document.documentElement) nodes.add(document.documentElement)
  if (document.body) nodes.add(document.body)
  document.querySelectorAll<HTMLElement>('*').forEach(node => nodes.add(node))

  return [...nodes]
    .flatMap(node => {
      if (!isVisible(node, view ?? null)) return []
      const maximumTop = Math.max(0, node.scrollHeight - node.clientHeight)
      if (maximumTop <= 1) return []
      const overflowY = view?.getComputedStyle(node).overflowY?.toLowerCase() ?? ''
      if (
        !isDocumentScroller(document, node) &&
        !['auto', 'scroll', 'overlay'].includes(overflowY)
      ) return []
      return [{
        node,
        originalTop: node.scrollTop,
        maximumTop
      }]
    })
    .sort((left, right) => right.maximumTop - left.maximumTop)
    .slice(0, maximumContainers)
}

function positionsFor(maximumTop: number, maximumPositions: number): number[] {
  const count = Math.max(1, Math.floor(maximumPositions))
  if (count === 1) return [maximumTop]
  return Array.from({ length: count }, (_, index) =>
    Math.round(maximumTop * index / (count - 1))
  ).filter((value, index, values) => index === 0 || value !== values[index - 1])
}

async function settle(document: Document): Promise<void> {
  const view = document.defaultView
  await new Promise<void>(resolve => {
    if (!view?.requestAnimationFrame) {
      resolve()
      return
    }
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()))
  })
}

function setScrollTop(target: ScrollTarget, top: number): void {
  target.node.scrollTop = top
}

export async function sampleVerticalScrollStates<T>(
  document: Document,
  sample: () => Promise<T>,
  options: VerticalScrollSamplingOptions = {}
): Promise<T[]> {
  const maximumContainers = Math.max(0, options.maximumContainers ?? 4)
  const maximumPositions = Math.max(1, options.maximumPositions ?? 3)
  const targets = discoverScrollTargets(document, maximumContainers)
  const results: T[] = []
  const waitForStableState = options.settle ?? (() => settle(document))

  if (options.includeCurrent !== false) results.push(await sample())

  try {
    for (const target of targets) {
      for (const top of positionsFor(target.maximumTop, maximumPositions)) {
        if (Math.abs(top - target.originalTop) < 1) continue
        setScrollTop(target, top)
        await waitForStableState()
        results.push(await sample())
      }
      if (Math.abs(target.node.scrollTop - target.originalTop) >= 1) {
        setScrollTop(target, target.originalTop)
        await waitForStableState()
      }
    }
  } finally {
    for (const target of targets) {
      if (Math.abs(target.node.scrollTop - target.originalTop) < 1) continue
      setScrollTop(target, target.originalTop)
      await waitForStableState()
    }
  }

  return results
}
