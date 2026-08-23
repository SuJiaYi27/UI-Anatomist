type ActiveTab = {
  id?: number
  windowId?: number
}

type CompletionNoticeDependencies = {
  queryActiveTab(): Promise<ActiveTab | undefined>
  openPopup(windowId: number): Promise<void>
  setBadgeText(text: string): Promise<void>
}

export async function notifyScanComplete(
  initiatingTabId: number,
  dependencies: CompletionNoticeDependencies
): Promise<'popup' | 'badge'> {
  let activeTab: ActiveTab | undefined
  try {
    activeTab = await dependencies.queryActiveTab()
  } catch {
    activeTab = undefined
  }

  if (activeTab?.id === initiatingTabId && Number.isInteger(activeTab.windowId)) {
    try {
      await dependencies.openPopup(activeTab.windowId as number)
      try {
        await dependencies.setBadgeText('')
      } catch {
        // The ready popup is already visible; badge cleanup is best effort.
      }
      return 'popup'
    } catch {
      // Fall through to the non-disruptive badge.
    }
  }

  try {
    await dependencies.setBadgeText('READY')
  } catch {
    // Notification failure must not invalidate the stored scan result.
  }
  return 'badge'
}
