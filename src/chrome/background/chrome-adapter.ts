import {
  createChromePageSession,
  type ChromePageSession,
  type ScrollPosition,
  type UiStateSnapshot
} from './page-session'
import type { InspectContext, InspectResult, ScanAdapter } from './scan-site'
import {
  INTERACTION_RESTORE_ABORT_CODE,
  InteractionRestoreError,
  isInteractionRestoreReason
} from '../interaction-restore-error'

async function waitForTabComplete(tabId: number, timeoutMs = 20_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout>
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      if (error) reject(error)
      else resolve()
    }
    const listener = (updatedId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return
      finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    timeout = setTimeout(() => finish(new Error('Page load timed out')), timeoutMs)
    void chrome.tabs.get(tabId)
      .then(current => {
        if (current.status === 'complete') finish()
      })
      .catch(finish)
  })
}

async function inspect(tabId: number, context?: InspectContext): Promise<InspectResult> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-scan.js']
  })
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'INSPECT_PAGE',
    exploredInteractionFamilies: context?.exploredInteractionFamilies ?? []
  })
  if (!response?.ok) {
    if (response?.code === INTERACTION_RESTORE_ABORT_CODE) {
      throw new InteractionRestoreError(
        isInteractionRestoreReason(response.reason) ? response.reason : 'unknown'
      )
    }
    throw new Error(response?.error ?? 'Page inspection failed')
  }
  return response.result as InspectResult
}

export type ChromeAdapterOptions = {
  tabId: number
  originalUrl: string
  pageSession?: ChromePageSession
}

export function createChromeAdapter(options: ChromeAdapterOptions): ScanAdapter {
  const pageSession = options.pageSession ?? createChromePageSession()
  let originalScroll: ScrollPosition | null = null
  let originalUiState: UiStateSnapshot | null = null

  const navigateTo = async (url: string) => {
    await chrome.tabs.update(options.tabId, { url, active: true })
    await waitForTabComplete(options.tabId)
  }

  const isMissingTabError = (error: unknown) =>
    /no tab with id|invalid tab id|tab (?:was )?closed|does not exist/i.test(
      error instanceof Error ? error.message : String(error)
    )

  const tabIsMissing = async (): Promise<boolean> => {
    try {
      await chrome.tabs.get(options.tabId)
      return false
    } catch (error) {
      if (isMissingTabError(error)) return true
      throw error
    }
  }

  const tabIsAtOriginalUrl = async (): Promise<boolean> => {
    const current = await chrome.tabs.get(options.tabId)
    if (!current.url) return false
    try {
      return new URL(current.url).href === new URL(options.originalUrl).href
    } catch {
      return current.url === options.originalUrl
    }
  }

  const restoreSession = async () => {
    let restoreError: unknown = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (!(await tabIsAtOriginalUrl())) await navigateTo(options.originalUrl)
        if (originalUiState) await pageSession.restoreUiState(options.tabId, originalUiState)
        if (originalScroll) await pageSession.restoreScroll(options.tabId, originalScroll)
        restoreError = null
        break
      } catch (error) {
        restoreError = error
        if (await tabIsMissing()) {
          restoreError = null
          break
        }
      }
    }

    try {
      await pageSession.hideProgress(options.tabId)
    } catch (error) {
      if (!(await tabIsMissing()) && restoreError === null) restoreError = error
    }
    if (restoreError !== null) throw restoreError
  }

  return {
    async open(_url) {
      if (await pageSession.hasDraft(options.tabId)) {
        throw new Error('检测到未发送内容，请先发送、保存或清空后再运行 UI-Anatomist。')
      }
      originalScroll = await pageSession.readScroll(options.tabId)
      try {
        await pageSession.showProgress(options.tabId, { completed: 0, maximum: 9 })
        originalUiState = await pageSession.readUiState(options.tabId)
        return options.tabId
      } catch (error) {
        await restoreSession()
        throw error
      }
    },
    inspect,
    async navigate(tabId, url) {
      if (tabId !== options.tabId) throw new Error('UI-Anatomist tab identity changed unexpectedly')
      await navigateTo(url)
    },
    async reportProgress(tabId, progress) {
      if (tabId !== options.tabId) throw new Error('UI-Anatomist tab identity changed unexpectedly')
      await pageSession.showProgress(tabId, progress)
    },
    async close(_tabId, mode = 'restore') {
      if (mode === 'dirty-abort') {
        try {
          await pageSession.hideProgress(options.tabId)
        } catch {
          // A dirty page must not be touched further, and overlay cleanup is best effort.
        }
        return
      }
      await restoreSession()
    }
  }
}
