import { createChromeAdapter } from './chrome-adapter'
import { notifyScanComplete } from './completion-notice'
import { runScanWorkflow } from './scan-workflow'
import {
  INTERACTION_RESTORE_ABORT_CODE,
  INTERACTION_RESTORE_ABORT_MESSAGE,
  isInteractionRestoreReason,
  isInteractionRestoreError
} from '../interaction-restore-error'

function platformLabel(): string {
  return navigator.platform || 'unknown'
}

async function clearReadyBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: '' })
  } catch {
    // Badge cleanup must never block a scan or overwrite its result state.
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'START_SCAN') return false

  void (async () => {
    try {
      const url = new URL(String(message.url))
      if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) pages can be scanned')
      const tabId = Number(message.tabId)
      if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('Active tab identity is missing')
      const granted = await chrome.permissions.contains({ origins: [`${url.origin}/*`] })
      if (!granted) throw new Error('Origin permission is missing')
      await clearReadyBadge()
      const result = await runScanWorkflow({
        tabId,
        url: url.href,
        locale: chrome.i18n.getUILanguage(),
        platform: platformLabel()
      }, {
        createAdapter: options => createChromeAdapter(options),
        storageSet: value => chrome.storage.session.set(value)
      })
      await notifyScanComplete(tabId, {
        queryActiveTab: async () => {
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
          if (!activeTab?.windowId) return undefined
          const activeWindow = await chrome.windows.get(activeTab.windowId)
          return activeWindow.focused ? activeTab : undefined
        },
        openPopup: windowId => {
          if (!chrome.action.openPopup) throw new Error('openPopup is unavailable')
          return chrome.action.openPopup({ windowId })
        },
        setBadgeText: async text => {
          if (text) await chrome.action.setBadgeBackgroundColor({ color: '#1A7F37' })
          await chrome.action.setBadgeText({ text })
        }
      })
      sendResponse(result)
    } catch (error) {
      const fatalRecovery = isInteractionRestoreError(error)
      const recoveryReason = fatalRecovery && isInteractionRestoreReason(error.reason)
        ? error.reason
        : ''
      const messageText = fatalRecovery
        ? INTERACTION_RESTORE_ABORT_MESSAGE
        : error instanceof Error ? error.message : String(error)
      await clearReadyBadge()
      await chrome.storage.session.set({
        scanStatus: 'error',
        scanJson: '',
        scanError: messageText,
        scanErrorCode: fatalRecovery ? INTERACTION_RESTORE_ABORT_CODE : '',
        scanErrorReason: recoveryReason,
        scanHeartbeatAt: 0,
        scanProgress: null
      })
      sendResponse(fatalRecovery
        ? {
            ok: false,
            code: INTERACTION_RESTORE_ABORT_CODE,
            reason: recoveryReason || 'unknown'
          }
        : { ok: false, error: messageText })
    }
  })()

  return true
})
