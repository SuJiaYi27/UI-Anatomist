export type DocumentStabilityOptions = {
  minimumWaitMs: number
  quietPeriodMs: number
  maximumWaitMs: number
}

const defaultOptions: DocumentStabilityOptions = {
  minimumWaitMs: 1_800,
  quietPeriodMs: 700,
  maximumWaitMs: 10_000
}

const pendingIndicatorSelector = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  '[role="status"]',
  '[aria-label*="loading" i]',
  '[aria-label*="加载"]'
].join(',')

function hasVisiblePendingIndicator(document: Document): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(pendingIndicatorSelector)).some(node => {
    if (!node.isConnected || node.closest('[hidden],[aria-hidden="true"]')) return false
    const style = document.defaultView?.getComputedStyle(node)
    const visible = style?.display !== 'none' &&
      style?.visibility !== 'hidden' &&
      style?.opacity !== '0'
    if (!visible) return false
    if (node.getAttribute('role') !== 'status') return true
    const status = `${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`
    return /\b(?:loading|busy)\b|加载|处理中/i.test(status)
  })
}

function normalizedOptions(
  options: Partial<DocumentStabilityOptions> | undefined
): DocumentStabilityOptions {
  const merged = { ...defaultOptions, ...options }
  return {
    minimumWaitMs: Math.max(0, merged.minimumWaitMs),
    quietPeriodMs: Math.max(0, merged.quietPeriodMs),
    maximumWaitMs: Math.max(merged.minimumWaitMs, merged.maximumWaitMs)
  }
}

export async function waitForStableDocument(
  document: Document,
  options?: Partial<DocumentStabilityOptions>
): Promise<void> {
  const view = document.defaultView
  const root = document.documentElement
  if (!view || !root) return
  const timing = normalizedOptions(options)
  const startedAt = Date.now()
  let lastStructuralMutationAt = startedAt

  await new Promise<void>(resolve => {
    let settled = false
    let quietTimer: number | undefined
    let maximumTimer: number | undefined

    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      if (quietTimer !== undefined) view.clearTimeout(quietTimer)
      if (maximumTimer !== undefined) view.clearTimeout(maximumTimer)
      resolve()
    }

    const schedule = () => {
      if (settled) return
      if (quietTimer !== undefined) view.clearTimeout(quietTimer)
      const now = Date.now()
      const minimumRemaining = Math.max(0, startedAt + timing.minimumWaitMs - now)
      const quietRemaining = Math.max(0, lastStructuralMutationAt + timing.quietPeriodMs - now)
      const remaining = Math.max(minimumRemaining, quietRemaining)
      quietTimer = view.setTimeout(() => {
        const current = Date.now()
        const minimumMet = current - startedAt >= timing.minimumWaitMs
        const quietMet = current - lastStructuralMutationAt >= timing.quietPeriodMs
        if (minimumMet && quietMet && hasVisiblePendingIndicator(document)) {
          quietTimer = view.setTimeout(schedule, 100)
        } else if (minimumMet && quietMet) finish()
        else schedule()
      }, remaining)
    }

    const observer = new view.MutationObserver(() => {
      lastStructuralMutationAt = Date.now()
      schedule()
    })
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'class', 'style', 'hidden', 'open', 'role', 'href',
        'aria-busy', 'aria-expanded', 'aria-hidden', 'aria-selected'
      ]
    })
    maximumTimer = view.setTimeout(finish, timing.maximumWaitMs)
    schedule()
  })
}
