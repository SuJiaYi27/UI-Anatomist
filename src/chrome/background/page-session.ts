export type ScrollPosition = { x: number; y: number }
export type ScanProgress = { completed: number; maximum: number }
export type UiStateSnapshot = {
  toggles: Array<{
    subject: string
    action: 'open' | 'close'
  }>
}

export type ChromePageSession = {
  hasDraft(tabId: number): Promise<boolean>
  readScroll(tabId: number): Promise<ScrollPosition>
  readUiState(tabId: number): Promise<UiStateSnapshot>
  restoreUiState(tabId: number, state: UiStateSnapshot): Promise<void>
  restoreScroll(tabId: number, position: ScrollPosition): Promise<void>
  showProgress(tabId: number, progress: ScanProgress): Promise<void>
  hideProgress(tabId: number): Promise<void>
}

export const SMART_SCAN_OVERLAY_SELECTOR = '[data-smart-scan-overlay="true"]'

export function pageHasDraft(): boolean {
  const controls = document.querySelectorAll<HTMLElement>(
    'textarea,input,[contenteditable]:not([contenteditable="false"])'
  )
  for (const control of controls) {
    if (control.closest('[hidden],[aria-hidden="true"]')) continue
    let visible = true
    for (let current: Element | null = control; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity || '1') === 0
      ) {
        visible = false
        break
      }
    }
    if (!visible) continue

    if (control.tagName === 'INPUT') {
      const input = control as HTMLInputElement
      if (input.disabled || input.readOnly) continue
      const ignoredTypes = new Set([
        'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'
      ])
      if (ignoredTypes.has(input.type.toLowerCase())) continue
      if (input.value.trim()) return true
      continue
    }
    if (control.tagName === 'TEXTAREA') {
      const textarea = control as HTMLTextAreaElement
      if (!textarea.disabled && !textarea.readOnly && textarea.value.trim()) return true
      continue
    }
    if (control.textContent?.trim()) return true
  }
  return false
}

export function pageScrollPosition(): ScrollPosition {
  return { x: window.scrollX, y: window.scrollY }
}

export function pageRestoreScroll(position: ScrollPosition): void {
  window.scrollTo(position.x, position.y)
}

export function pageReadUiState(): UiStateSnapshot {
  const actionPattern = /^(open|close|show|hide|expand|collapse|打开|关闭|显示|隐藏|展开|收起)\s*(.+)$/i
  const structuralSubject = /\b(sidebar|menu|panel|dialog|drawer|popover|modal|navigation|nav|search|history|library|projects?|section|tray|sheet)\b|侧边栏|菜单|面板|对话框|抽屉|弹窗|导航|搜索|历史|项目|区域|托盘/i
  const toggles: UiStateSnapshot['toggles'] = []
  const seen = new Set<string>()
  const unsafeControl = (node: HTMLElement): boolean => {
    if (node.closest('[inert]')) return true
    if (node.matches('button')) {
      const button = node as HTMLButtonElement
      if (button.form && (button.type === 'submit' || button.type === 'reset')) return true
    }
    if (node.matches('input')) {
      const input = node as HTMLInputElement
      if (input.form && ['submit', 'reset', 'image'].includes(input.type)) return true
      if (input.type === 'file') return true
    }
    if (node.querySelector('input[type="file"]')) return true
    const label = node.closest<HTMLLabelElement>('label')
    if (label?.control?.matches('input[type="file"]')) return true
    return [node.getAttribute('for'), node.getAttribute('aria-controls')]
      .flatMap(value => value?.trim().split(/\s+/).filter(Boolean) ?? [])
      .some(id => document.getElementById(id)?.matches('input[type="file"]'))
  }
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]'))) {
    if (node.matches(':disabled,[aria-disabled="true"]')) continue
    if (node.closest('[hidden],[aria-hidden="true"]')) continue
    if (unsafeControl(node)) continue
    const label = (
      node.getAttribute('aria-label') ??
      node.getAttribute('title') ??
      node.textContent ??
      ''
    ).trim()
    const match = actionPattern.exec(label)
    if (!match || !structuralSubject.test(match[2] ?? '')) continue
    let visible = true
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.pointerEvents === 'none' ||
        Number.parseFloat(style.opacity || '1') === 0
      ) {
        visible = false
        break
      }
    }
    if (!visible) continue
    const verb = match[1]?.toLowerCase() ?? ''
    const action: 'open' | 'close' = /^(open|show|expand|打开|显示|展开)$/i.test(verb)
      ? 'open'
      : 'close'
    const subject = (match[2] ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    const key = `${subject}:${action}`
    if (!subject || seen.has(key)) continue
    seen.add(key)
    toggles.push({ subject, action })
  }
  return { toggles }
}

export async function pageRestoreUiState(state: UiStateSnapshot): Promise<void> {
  if (!state.toggles.length) return
  await new Promise<void>(resolve => setTimeout(resolve, 2_000))
  const actionPattern = /^(open|close|show|hide|expand|collapse|打开|关闭|显示|隐藏|展开|收起)\s*(.+)$/i
  const structuralSubject = /\b(sidebar|menu|panel|dialog|drawer|popover|modal|navigation|nav|search|history|library|projects?|section|tray|sheet)\b|侧边栏|菜单|面板|对话框|抽屉|弹窗|导航|搜索|历史|项目|区域|托盘/i
  type ToggleControl = UiStateSnapshot['toggles'][number] & { node: HTMLElement }
  const readControl = (node: HTMLElement): ToggleControl | null => {
    if (
      node.matches(':disabled,[aria-disabled="true"]') ||
      node.closest('[hidden],[aria-hidden="true"]')
    ) return null
    if (node.closest('[inert]')) return null
    if (node.matches('button')) {
      const button = node as HTMLButtonElement
      if (button.form && (button.type === 'submit' || button.type === 'reset')) return null
    }
    if (node.matches('input')) {
      const input = node as HTMLInputElement
      if (input.form && ['submit', 'reset', 'image'].includes(input.type)) return null
      if (input.type === 'file') return null
    }
    if (node.querySelector('input[type="file"]')) return null
    const associatedLabel = node.closest<HTMLLabelElement>('label')
    if (associatedLabel?.control?.matches('input[type="file"]')) return null
    if ([node.getAttribute('for'), node.getAttribute('aria-controls')]
      .flatMap(value => value?.trim().split(/\s+/).filter(Boolean) ?? [])
      .some(id => document.getElementById(id)?.matches('input[type="file"]'))) return null
    const label = (
      node.getAttribute('aria-label') ??
      node.getAttribute('title') ??
      node.textContent ??
      ''
    ).trim()
    const match = actionPattern.exec(label)
    if (!match || !structuralSubject.test(match[2] ?? '')) return null
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.pointerEvents === 'none' ||
        Number.parseFloat(style.opacity || '1') === 0
      ) return null
    }
    const verb = match[1]?.toLowerCase() ?? ''
    return {
      node,
      subject: (match[2] ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''),
      action: /^(open|show|expand|打开|显示|展开)$/i.test(verb) ? 'open' : 'close'
    }
  }
  const restoration = new Map<string, { clicked: boolean; expectedSeen: boolean }>()
  for (let attempt = 0; attempt < 30; attempt += 1) {
    for (const expected of state.toggles) {
      const matches = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]'))
        .map(readControl)
        .filter((control): control is ToggleControl => control?.subject === expected.subject)
      const status = restoration.get(expected.subject) ?? {
        clicked: false,
        expectedSeen: false
      }
      if (status.clicked && matches.some(control => control.action === expected.action)) {
        status.expectedSeen = true
      }
      const mismatched = matches.filter(control => control.action !== expected.action)
      if (mismatched.length !== 1) continue
      if (status.clicked && !status.expectedSeen) continue
      const control = mismatched[0]
      if (!control) continue
      status.clicked = true
      status.expectedSeen = false
      restoration.set(expected.subject, status)
      control.node.click()
    }
    await new Promise<void>(resolve => setTimeout(resolve, 100))
  }
}

export function pageShowProgress(progress: ScanProgress): void {
  const existing = document.querySelector<HTMLElement>(SMART_SCAN_OVERLAY_SELECTOR)
  const overlay = existing ?? document.createElement('div')
  if (!existing) {
    overlay.setAttribute('data-smart-scan-overlay', 'true')
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      padding: '10px 14px',
      border: '1px solid rgba(0, 0, 0, 0.12)',
      borderRadius: '9999px',
      background: 'rgba(255, 255, 255, 0.96)',
      color: '#111111',
      boxShadow: '0 6px 24px rgba(0, 0, 0, 0.12)',
      font: '500 13px/18px system-ui, sans-serif',
      pointerEvents: 'none'
    })
    document.documentElement.appendChild(overlay)
  }
  overlay.textContent = `UI-Anatomist · Scanning ${progress.completed} / ${progress.maximum}`
}

export function pageHideProgress(): void {
  document.querySelector(SMART_SCAN_OVERLAY_SELECTOR)?.remove()
}

export function createChromePageSession(): ChromePageSession {
  return {
    async hasDraft(tabId) {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageHasDraft
      })
      return entry?.result === true
    },
    async readScroll(tabId) {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageScrollPosition
      })
      const result = entry?.result
      return result && typeof result.x === 'number' && typeof result.y === 'number'
        ? result
        : { x: 0, y: 0 }
    },
    async readUiState(tabId) {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageReadUiState
      })
      const result = entry?.result
      return result && Array.isArray(result.toggles) ? result : { toggles: [] }
    },
    async restoreUiState(tabId, state) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: pageRestoreUiState,
        args: [state]
      })
    },
    async restoreScroll(tabId, position) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: pageRestoreScroll,
        args: [position]
      })
    },
    async showProgress(tabId, progress) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: pageShowProgress,
        args: [progress]
      })
    },
    async hideProgress(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: pageHideProgress
      })
    }
  }
}
