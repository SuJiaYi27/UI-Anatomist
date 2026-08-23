import { describe, expect, it, vi } from 'vitest'

import { notifyScanComplete } from '../../src/chrome/background/completion-notice'

describe('notifyScanComplete', () => {
  it('opens the popup when the initiating tab is still active', async () => {
    const openPopup = vi.fn().mockResolvedValue(undefined)
    const setBadgeText = vi.fn().mockResolvedValue(undefined)

    const result = await notifyScanComplete(73, {
      queryActiveTab: async () => ({ id: 73, windowId: 9 }),
      openPopup,
      setBadgeText
    })

    expect(result).toBe('popup')
    expect(openPopup).toHaveBeenCalledWith(9)
    expect(setBadgeText).toHaveBeenCalledWith('')
  })

  it('shows READY without opening when the user switched tabs', async () => {
    const openPopup = vi.fn()
    const setBadgeText = vi.fn().mockResolvedValue(undefined)

    const result = await notifyScanComplete(73, {
      queryActiveTab: async () => ({ id: 74, windowId: 9 }),
      openPopup,
      setBadgeText
    })

    expect(result).toBe('badge')
    expect(openPopup).not.toHaveBeenCalled()
    expect(setBadgeText).toHaveBeenCalledWith('READY')
  })

  it('falls back to READY when openPopup is unavailable at runtime', async () => {
    const setBadgeText = vi.fn().mockResolvedValue(undefined)

    const result = await notifyScanComplete(73, {
      queryActiveTab: async () => ({ id: 73, windowId: 9 }),
      openPopup: async () => { throw new Error('unsupported') },
      setBadgeText
    })

    expect(result).toBe('badge')
    expect(setBadgeText).toHaveBeenCalledWith('READY')
  })

  it('never turns a completed scan into an error when notice APIs fail', async () => {
    await expect(notifyScanComplete(73, {
      queryActiveTab: async () => { throw new Error('window query failed') },
      openPopup: async () => { throw new Error('popup failed') },
      setBadgeText: async () => { throw new Error('badge failed') }
    })).resolves.toBe('badge')
  })
})
