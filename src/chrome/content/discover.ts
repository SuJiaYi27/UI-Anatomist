import {
  classifyCandidateWithReason,
  isSafeSettingsDisclosureLabel,
  type Candidate,
  type Risk
} from '../risk-policy'
import type { DisclosureDiagnosticFileRisk } from '../../shared/schema'
import {
  disclosureDiagnosticObservation,
  type DisclosureDiagnosticRecorder
} from './disclosure-diagnostics'

export type DiscoveredCandidate = Candidate & {
  key: string
  target: 'navigate' | 'reversible-click'
  selector: string
  risk: Risk
}

type DiscoveryOptions = {
  mark?: boolean
  diagnostics?: DisclosureDiagnosticRecorder
}

const popupValues = new Set(['true', 'dialog', 'menu', 'listbox', 'tree', 'grid'])
const safeOpenerLabel = /^(?:(?:open|show|expand|toggle)\s+(?:sidebar|navigation|nav|menu|panel|drawer|search|filters?|sort|details|sources?|history|library|projects?|plugins?|tools?|profile|selector|picker|options?|settings|preferences)|search|menu|more(?: actions)?|sources?|filters?|sort|options?|profile menu|model selector|projects?|settings|preferences)$|^(?:(?:打开|显示|展开|切换)(?:侧边栏|导航|菜单|面板|抽屉|搜索|筛选|排序|详情|来源|历史|项目|插件|工具|个人资料|选择器|选项|设置|偏好设置)|搜索|菜单|更多(?:操作)?|来源|筛选|排序|选项|个人资料菜单|模型选择器|项目|设置|偏好设置)$/i
const safeVerboseOpenerLabel = /^(?:open|show|expand|toggle)\s+(?:(?:quick|global)\s+)?(?:sidebar|navigation|nav|menu|panel|drawer|search|filters?|sort|details|sources?|history|library|projects?|plugins?|tools?|profile|selector|picker|options?|settings|preferences)(?:\s+(?:dialog|panel|drawer|menu))?(?:,\s*(?:type|press)\s+.{1,24}\s+to\s+(?:search|open))?$/i
const filePickerLabel = /\b(?:add|attach|choose|select|upload)\b.{0,24}\b(?:files?|photos?|images?|documents?)\b|\b(?:files?|photos?|images?|documents?)\b.{0,24}\b(?:picker|upload)\b|(?:添加|附加|选择|上传).{0,12}(?:文件|照片|图片|文档)/i
const safeFileMenuOpenerLabel = /^(?:add|attach)\s+(?:files?|photos?|images?|documents?)\s+(?:and|&)\s+more$|^(?:添加|附加)(?:文件|照片|图片|文档)(?:和|及|与)更多$/i

function labelFor(node: HTMLElement): string {
  return (
    node.getAttribute('aria-label') ??
    node.getAttribute('title') ??
    node.textContent ??
    ''
  ).trim().slice(0, 120)
}

function isSafeOpenerLabel(label: string): boolean {
  const normalized = label.trim().replace(/\s+/g, ' ')
  return safeOpenerLabel.test(normalized) || safeVerboseOpenerLabel.test(normalized)
}

function candidateKind(
  node: HTMLElement,
  anchor: HTMLAnchorElement | null,
  label: string
): Candidate['kind'] {
  if (anchor) return 'link'
  if (node.matches('[role="tab"]')) return 'tab'
  if (node.matches('details > summary:first-of-type')) return 'disclosure'
  const popup = node.getAttribute('aria-haspopup')?.toLowerCase()
  if (
    node.hasAttribute('aria-expanded') ||
    (popup !== undefined && popupValues.has(popup)) ||
    isSafeOpenerLabel(label) ||
    safeFileMenuOpenerLabel.test(label) ||
    isSafeSettingsDisclosureLabel(label)
  ) return 'disclosure'
  return 'button'
}

function isVisible(node: HTMLElement, view: Window | null): boolean {
  if (node.closest('[hidden],[aria-hidden="true"],[data-smart-scan-overlay="true"]')) {
    return false
  }
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current)
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      Number.parseFloat(style?.opacity || '1') === 0
    ) return false
  }
  return true
}

function isMutatingFormButton(node: HTMLElement): boolean {
  if (node.matches('button')) {
    const button = node as HTMLButtonElement
    return button.form !== null && (button.type === 'submit' || button.type === 'reset')
  }
  if (node.matches('input')) {
    const input = node as HTMLInputElement
    return input.form !== null && ['submit', 'reset', 'image'].includes(input.type)
  }
  return false
}

export function nativeFilePickerRisk(
  node: HTMLElement,
  document: Document,
  _nativeDetails = false
): DisclosureDiagnosticFileRisk {
  if (node.matches('input[type="file"]') || node.querySelector('input[type="file"]')) {
    return 'direct-input'
  }
  const label = node.closest<HTMLLabelElement>('label')
  if (label?.control?.matches('input[type="file"]')) return 'associated-input'
  const ids = [node.getAttribute('for'), node.getAttribute('aria-controls')]
    .flatMap(value => value?.trim().split(/\s+/).filter(Boolean) ?? [])
  if (ids.some(id => document.getElementById(id)?.matches('input[type="file"]'))) {
    return 'associated-input'
  }
  const text = labelFor(node)
  if (safeFileMenuOpenerLabel.test(text)) return 'none'
  const popup = node.getAttribute('aria-haspopup')?.toLowerCase()
  if (popup === 'menu' || popup === 'listbox' || popup === 'tree' || popup === 'grid') {
    return 'none'
  }
  return filePickerLabel.test(text) ? 'label-heuristic' : 'none'
}

function belongsToStructuralNavigation(node: HTMLElement): boolean {
  return node.closest([
    'nav',
    '[role="navigation"]',
    'aside',
    'header',
    '[class*="sidebar" i]',
    '[class*="side-nav" i]',
    '[class*="navigation" i]',
    '[data-testid*="sidebar" i]',
    '[data-testid*="navigation" i]'
  ].join(',')) !== null
}

export function discoverCandidates(
  document: Document,
  options: DiscoveryOptions = {}
): DiscoveredCandidate[] {
  const view = document.defaultView
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(
    'a[href],button,[role="tab"],[role="menuitem"],[role="menuitemradio"],' +
    '[role="menuitemcheckbox"],[aria-expanded],[aria-haspopup],details > summary:first-of-type'
  ))

  return nodes.flatMap((node, index) => {
    const fileRisk = nativeFilePickerRisk(node, document)
    const record = (
      stage: Parameters<typeof disclosureDiagnosticObservation>[1]['stage'],
      classified?: ReturnType<typeof classifyCandidateWithReason>
    ) => options.diagnostics?.record(node, disclosureDiagnosticObservation(node, {
      fileRisk,
      risk: classified?.risk,
      riskReason: classified?.reason,
      stage
    }))

    if (node.matches(':disabled,[aria-disabled="true"]')) {
      record('rejected-disabled')
      return []
    }
    if (!isVisible(node, view ?? null)) {
      record('rejected-hidden')
      return []
    }
    if (isMutatingFormButton(node)) {
      record('rejected-mutating-form')
      return []
    }
    if (fileRisk !== 'none') {
      record('rejected-file-picker')
      return []
    }

    const anchor = node.closest('a[href]') as HTMLAnchorElement | null
    const label = labelFor(node)
    const kind = candidateKind(node, anchor, label)
    const popup = node.getAttribute('aria-haspopup')?.toLowerCase()
    const nativeDetails = node.matches('details > summary:first-of-type')
    const structuralDisclosure = !anchor && (
      nativeDetails ||
      node.hasAttribute('aria-expanded') ||
      (popup !== undefined && popupValues.has(popup))
    )
    const url = anchor ? new URL(anchor.href, document.location.href).href : undefined
    const sameOrigin = !url || new URL(url).origin === document.location.origin
    const reversible = anchor ? sameOrigin : kind === 'tab' || kind === 'disclosure'
    const structuralNavigation = Boolean(anchor && belongsToStructuralNavigation(node))
    const base: Candidate = {
      kind,
      label,
      sameOrigin,
      reversible,
      structuralDisclosure,
      structuralNavigation,
      url
    }
    const classified = classifyCandidateWithReason(base)
    record('classified', classified)
    const key = `${kind}:${index}`
    if (options.mark !== false) node.setAttribute('data-smart-scan-key', key)
    return [{
      ...base,
      key,
      target: anchor ? 'navigate' : 'reversible-click',
      selector: `[data-smart-scan-key="${key}"]`,
      risk: classified.risk
    }]
  })
}

export function clearCandidateMarkers(document: Document): void {
  document.querySelectorAll('[data-smart-scan-key]').forEach(node => {
    node.removeAttribute('data-smart-scan-key')
  })
}
