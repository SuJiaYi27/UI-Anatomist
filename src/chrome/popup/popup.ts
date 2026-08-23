import {
  INTERACTION_RESTORE_ABORT_CODE,
  INTERACTION_RESTORE_ABORT_MESSAGE,
  InteractionRestoreError,
  isInteractionRestoreReason,
  isInteractionRestoreError
} from '../interaction-restore-error'

export type PopupStatus = 'idle' | 'scanning' | 'ready' | 'error'
export type PopupAction = 'smart-scan' | 'copy-json' | 'download-json'
const STALE_SCAN_AFTER_MS = 60_000

export function actionsForStatus(status: PopupStatus): PopupAction[] {
  if (status === 'ready') return ['smart-scan', 'copy-json', 'download-json']
  if (status === 'idle' || status === 'error') return ['smart-scan']
  return []
}

export function originPermissionPattern(rawUrl: string): string {
  return `${new URL(rawUrl).origin}/*`
}

export function isStaleScan(
  status: PopupStatus,
  heartbeatAt: unknown,
  now = Date.now()
): boolean {
  if (status !== 'scanning') return false
  return typeof heartbeatAt !== 'number' ||
    !Number.isFinite(heartbeatAt) ||
    now - heartbeatAt > STALE_SCAN_AFTER_MS
}

export async function copyJson(json: string): Promise<void> {
  await navigator.clipboard.writeText(json)
}

export function readyStatus(json: string): string {
  try {
    const value = JSON.parse(json) as {
      typography?: unknown
      borderRadii?: unknown
      shadows?: unknown
      colors?: { primitives?: unknown; semantic?: unknown; interactive?: unknown }
      spacing?: unknown
      controls?: unknown
      icons?: unknown
    }
    if (!Array.isArray(value.typography) || !Array.isArray(value.borderRadii)) return 'JSON is ready'
    const shadowCount = Array.isArray(value.shadows) ? value.shadows.length : 0
    const primitiveCount = Array.isArray(value.colors?.primitives) ? value.colors.primitives.length : 0
    const semanticCount = Array.isArray(value.colors?.semantic) ? value.colors.semantic.length : 0
    const interactiveCount = Array.isArray(value.colors?.interactive) ? value.colors.interactive.length : 0
    const spacingCount = Array.isArray(value.spacing) ? value.spacing.length : 0
    const controlsCount = Array.isArray(value.controls) ? value.controls.length : 0
    const iconsCount = Array.isArray(value.icons) ? value.icons.length : 0
    return `JSON is ready · ${value.typography.length} type styles · ${value.borderRadii.length} radii · ${shadowCount} shadows · ${primitiveCount} primitive · ${semanticCount} semantic · ${interactiveCount} interactive · ${spacingCount} spacing · ${controlsCount} controls · ${iconsCount} icons`
  } catch {
    return 'JSON is ready'
  }
}

export function downloadJson(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `ui-anatomist-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function text(id: string, value: string): void {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

function setHidden(id: string, hidden: boolean): void {
  const node = document.getElementById(id)
  if (node) node.hidden = hidden
}

async function clearReadyBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: '' })
  } catch {
    // Badge cleanup is best effort and must not hide a stored scan result.
  }
}

async function readState(): Promise<{
  status: PopupStatus
  json: string
  errorCode: string
  errorReason: string
}> {
  const stored = await chrome.storage.session.get([
    'scanStatus',
    'scanJson',
    'scanError',
    'scanErrorCode',
    'scanErrorReason',
    'scanHeartbeatAt'
  ])
  const status = (stored.scanStatus as PopupStatus | undefined) ?? 'idle'
  if (isStaleScan(status, stored.scanHeartbeatAt)) {
    await chrome.storage.session.set({
      scanStatus: 'error',
      scanError: 'The previous scan stopped before completion.',
      scanErrorCode: '',
      scanErrorReason: '',
      scanHeartbeatAt: 0,
      scanJson: '',
      scanProgress: null
    })
    return { status: 'error', json: '', errorCode: '', errorReason: '' }
  }
  return {
    status,
    json: typeof stored.scanJson === 'string' ? stored.scanJson : '',
    errorCode: typeof stored.scanErrorCode === 'string'
      ? stored.scanErrorCode
      : '',
    errorReason: typeof stored.scanErrorReason === 'string'
      ? stored.scanErrorReason
      : ''
  }
}

async function render(): Promise<void> {
  const { status, json, errorCode, errorReason } = await readState()
  const actions = actionsForStatus(status)
  setHidden('smart-scan', !actions.includes('smart-scan'))
  setHidden('ready-actions', status !== 'ready')
  text('status', status === 'scanning'
    ? 'Scanning safe states…'
    : status === 'ready'
      ? readyStatus(json)
      : status === 'error'
        ? errorCode === INTERACTION_RESTORE_ABORT_CODE
          ? `${INTERACTION_RESTORE_ABORT_MESSAGE} [${
              isInteractionRestoreReason(errorReason) ? errorReason : 'unknown'
            }]`
          : 'Scan stopped safely. Try again.'
        : 'Ready to scan this site')
}

async function startScan(tab: Pick<chrome.tabs.Tab, 'id' | 'url'>): Promise<void> {
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('Open an http(s) page first')
  // permissions.request must be the first browser API called from the click gesture.
  const granted = await chrome.permissions.request({ origins: [originPermissionPattern(tab.url)] })
  if (!granted) throw new Error('Site permission was not granted')
  await clearReadyBadge()
  await chrome.storage.session.set({
    scanStatus: 'scanning',
    scanJson: '',
    scanError: '',
    scanErrorCode: '',
    scanErrorReason: '',
    scanProgress: null,
    scanHeartbeatAt: Date.now()
  })
  await render()
  const response = await chrome.runtime.sendMessage({ type: 'START_SCAN', tabId: tab.id, url: tab.url })
  if (!response?.ok) {
    if (response?.code === INTERACTION_RESTORE_ABORT_CODE) {
      throw new InteractionRestoreError(
        isInteractionRestoreReason(response.reason) ? response.reason : 'unknown'
      )
    }
    throw new Error(response?.error ?? 'Scan failed')
  }
  await render()
}

export async function initializePopup(): Promise<void> {
  await clearReadyBadge()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const scanButton = document.getElementById('smart-scan') as HTMLButtonElement | null
  await render()
  document.getElementById('copy-json')?.addEventListener('click', () => {
    void readState().then(async state => {
      await clearReadyBadge()
      await copyJson(state.json)
      text('status', 'JSON copied')
    })
  })
  document.getElementById('download-json')?.addEventListener('click', () => {
    void readState().then(async state => {
      await clearReadyBadge()
      downloadJson(state.json)
    })
  })
  chrome.storage.onChanged.addListener(() => { void render() })

  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    if (scanButton) scanButton.disabled = true
    const state = await readState()
    if (state.status !== 'ready') text('status', 'Open an http(s) page first')
    return
  }
  document.getElementById('smart-scan')?.addEventListener('click', () => {
    void startScan(tab).catch(async error => {
      const fatalRecovery = isInteractionRestoreError(error)
      const recoveryReason = fatalRecovery && isInteractionRestoreReason(error.reason)
        ? error.reason
        : ''
      await chrome.storage.session.set({
        scanStatus: 'error',
        scanJson: '',
        scanError: fatalRecovery
          ? INTERACTION_RESTORE_ABORT_MESSAGE
          : String(error),
        scanErrorCode: fatalRecovery ? INTERACTION_RESTORE_ABORT_CODE : '',
        scanErrorReason: recoveryReason,
        scanHeartbeatAt: 0,
        scanProgress: null
      })
      await render()
    })
  })
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  void initializePopup()
}
