export const HOVER_PROBE_ATTRIBUTE = 'data-smart-scan-hover-probe'

const HOVER_STYLE_ATTRIBUTE = 'data-smart-scan-hover-style'
const DEFAULT_TIMEOUT_MS = 4_000
const MAX_CONCURRENCY = 4

type CssRuleLike = {
  cssText?: string
  selectorText?: string
  cssRules?: ArrayLike<CssRuleLike>
}

type StyleSheetLike = CssRuleLike & {
  href?: string | null
}

export type HoverCssResponse = {
  ok: boolean
  text(): Promise<string>
}

export type HoverCssFetch = (
  url: string,
  init: RequestInit
) => Promise<HoverCssResponse>

export type HoverStyleLoaderOptions = {
  fetchCss?: HoverCssFetch
  timeoutMs?: number
  parseCssRules?: (document: Document, css: string) => CssRuleLike[]
}

function readableRules(source: CssRuleLike): CssRuleLike[] | null {
  try {
    return Array.from(source.cssRules ?? [])
  } catch {
    return null
  }
}

function rewrittenLeafRule(rule: CssRuleLike): string | null {
  const selector = rule.selectorText ?? ''
  const cssText = rule.cssText ?? ''
  if (!selector.includes(':hover')) return null
  if (/\burl\s*\(/i.test(cssText)) return null
  const bodyStart = cssText.indexOf('{')
  if (bodyStart < 0) return null
  return `${selector.replace(
    /:hover\b/g,
    `[${HOVER_PROBE_ATTRIBUTE}="true"]`
  )} ${cssText.slice(bodyStart)}`
}

function hoverRulesFrom(rules: CssRuleLike[]): string[] {
  const output: string[] = []
  for (const rule of rules) {
    const nested = readableRules(rule)
    if (nested && nested.length > 0) {
      const children = hoverRulesFrom(nested)
      const cssText = rule.cssText ?? ''
      const bodyStart = cssText.indexOf('{')
      const header = bodyStart >= 0 ? cssText.slice(0, bodyStart).trim() : ''
      if (children.length > 0 && header.startsWith('@')) {
        output.push(`${header} {\n${children.join('\n')}\n}`)
      }
      continue
    }
    const rewritten = rewrittenLeafRule(rule)
    if (rewritten) output.push(rewritten)
  }
  return output
}

function externalUrl(href: string | null | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null
  } catch {
    return null
  }
}

function parseConstructedSheet(document: Document, css: string): CssRuleLike[] {
  const Sheet = document.defaultView?.CSSStyleSheet
  if (!Sheet) return []
  const sheet = new Sheet()
  sheet.replaceSync(css)
  return readableRules(sheet) ?? []
}

export async function installHoverStyle(
  document: Document,
  options: HoverStyleLoaderOptions = {}
): Promise<HTMLStyleElement | null> {
  const rules: string[] = []
  const external = new Set<string>()
  for (const sheet of Array.from(document.styleSheets) as StyleSheetLike[]) {
    const readable = readableRules(sheet)
    if (readable) {
      rules.push(...hoverRulesFrom(readable))
      continue
    }
    const url = externalUrl(sheet.href)
    if (url) external.add(url)
  }

  const fetchCss = options.fetchCss ?? (
    typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis) as HoverCssFetch
      : null
  )
  const parseCssRules = options.parseCssRules ?? parseConstructedSheet
  if (fetchCss) {
    const urls = [...external]
    const fetchedRules = Array.from({ length: urls.length }, () => [] as string[])
    const controller = new AbortController()
    let nextIndex = 0
    let expired = false
    let resolveDeadline = () => {}
    const deadline = new Promise<void>(resolve => { resolveDeadline = resolve })
    const timeoutId = globalThis.setTimeout(() => {
      expired = true
      controller.abort()
      resolveDeadline()
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const worker = async (): Promise<void> => {
      while (!expired && nextIndex < urls.length) {
        const index = nextIndex
        nextIndex += 1
        try {
          const response = await fetchCss(urls[index]!, {
            credentials: 'omit',
            signal: controller.signal
          })
          if (!response.ok) continue
          fetchedRules[index] = hoverRulesFrom(
            parseCssRules(document, await response.text())
          )
        } catch {
          // A blocked, failed, or unparsable stylesheet is non-fatal.
        }
      }
    }
    const workers = Promise.all(Array.from(
      { length: Math.min(MAX_CONCURRENCY, urls.length) },
      () => worker()
    ))
    try {
      await Promise.race([workers, deadline])
    } finally {
      globalThis.clearTimeout(timeoutId)
      if (!expired) controller.abort()
    }
    rules.push(...fetchedRules.flat())
  }
  if (rules.length === 0) return null

  const style = document.createElement('style')
  style.setAttribute(HOVER_STYLE_ATTRIBUTE, 'true')
  style.setAttribute('data-smart-scan-overlay', 'true')
  style.textContent = rules.join('\n')
  ;(document.head ?? document.documentElement).append(style)
  return style
}
