import { describe, expect, it } from 'vitest'
import {
  classifyCandidate,
  classifyCandidateWithReason
} from '../../src/chrome/risk-policy'

describe('classifyCandidate', () => {
  it('reports generic reasons without changing the classification result', () => {
    const structural = {
      kind: 'disclosure' as const,
      label: 'Private account wording',
      sameOrigin: true,
      reversible: true,
      structuralDisclosure: true
    }
    const blocked = {
      kind: 'button' as const,
      label: 'Delete private repository',
      sameOrigin: true,
      reversible: false
    }
    const uncertain = {
      kind: 'button' as const,
      label: 'Mystery action',
      sameOrigin: true,
      reversible: false
    }

    expect(classifyCandidateWithReason(structural)).toEqual({
      risk: classifyCandidate(structural),
      reason: 'structural-disclosure'
    })
    expect(classifyCandidateWithReason(blocked)).toEqual({
      risk: classifyCandidate(blocked),
      reason: 'blocked-label-or-route'
    })
    expect(classifyCandidateWithReason(uncertain)).toEqual({
      risk: classifyCandidate(uncertain),
      reason: 'default-uncertain'
    })
  })

  it.each([
    '退出', '登出', '注销', 'Sign out', 'Log out', 'Delete', 'Clear history', 'Archive',
    '置顶', 'Install', 'Uninstall', 'Connect', 'Disconnect', 'Settings', 'New chat',
    'Publish', 'Invite', 'Copy link', 'Unshare', 'Share publicly',
    '发布', '邀请', '复制链接', '取消分享', '公开分享'
  ])(
    'blocks %s',
    label => {
      expect(classifyCandidate({ kind: 'button', label, sameOrigin: true, reversible: false })).toBe('blocked')
    }
  )

  it.each(['Share', '分享'])(
    'allows the exact low-risk share opener %s',
    label => {
      expect(classifyCandidate({ kind: 'button', label, sameOrigin: true, reversible: false })).toBe('safe')
    }
  )

  it('blocks sensitive account routes even when the label is vague', () => {
    expect(classifyCandidate({
      kind: 'link',
      label: 'Open',
      sameOrigin: true,
      reversible: true,
      url: 'https://example.com/account'
    })).toBe('blocked')
  })

  it('allows same-origin navigation and reversible disclosure controls', () => {
    expect(classifyCandidate({
      kind: 'link', label: 'Plugins', sameOrigin: true, reversible: true, url: 'https://example.com/plugins'
    })).toBe('safe')
    expect(classifyCandidate({ kind: 'disclosure', label: 'Search', sameOrigin: true, reversible: true })).toBe('safe')
    expect(classifyCandidate({ kind: 'disclosure', label: 'Account menu', sameOrigin: true, reversible: true })).toBe('safe')
    expect(classifyCandidate({ kind: 'button', label: 'Sign out', sameOrigin: true, reversible: false })).toBe('blocked')
  })

  it('allows a structural disclosure opener without allowing its mutating inner action', () => {
    expect(classifyCandidate({
      kind: 'disclosure',
      label: 'Click to change subscription settings',
      sameOrigin: true,
      reversible: true,
      structuralDisclosure: true
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'button',
      label: 'Change subscription settings',
      sameOrigin: true,
      reversible: false,
      structuralDisclosure: false
    })).toBe('blocked')
  })

  it('allows an exact reversible settings disclosure and read-only settings destination', () => {
    expect(classifyCandidate({
      kind: 'disclosure',
      label: 'Settings',
      sameOrigin: true,
      reversible: true
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'disclosure',
      label: '设置',
      sameOrigin: true,
      reversible: true
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'disclosure',
      label: 'Product settings',
      sameOrigin: true,
      reversible: true
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'button',
      label: 'Settings',
      sameOrigin: true,
      reversible: false
    })).toBe('blocked')
    expect(classifyCandidate({
      kind: 'link',
      label: 'Settings',
      sameOrigin: true,
      reversible: true,
      url: 'https://example.com/settings'
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'link',
      label: 'Preferences',
      sameOrigin: true,
      reversible: true,
      url: 'https://example.com/preferences/appearance'
    })).toBe('safe')
  })

  it('keeps mutating and sensitive settings destinations blocked', () => {
    for (const path of [
      '/settings/billing',
      '/settings/security',
      '/settings/account',
      '/settings?save=true',
      '/preferences/subscription',
      '/settings/delete-account',
      '/preferences/manage_profile',
      '/settings/save-changes'
    ]) {
      expect(classifyCandidate({
        kind: 'link',
        label: 'Settings',
        sameOrigin: true,
        reversible: true,
        url: `https://example.com${path}`
      })).toBe('blocked')
    }
    expect(classifyCandidate({
      kind: 'button',
      label: 'Save settings',
      sameOrigin: true,
      reversible: false
    })).toBe('blocked')
    for (const label of [
      'Account settings',
      'Billing settings',
      'Security settings'
    ]) {
      expect(classifyCandidate({
        kind: 'disclosure',
        label,
        sameOrigin: true,
        reversible: true
      })).toBe('blocked')
    }
  })

  it('allows exact view-only profile and project destinations', () => {
    expect(classifyCandidate({
      kind: 'link', label: 'View profile', sameOrigin: true, reversible: true, url: 'https://example.com/profile'
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'link', label: 'Project', sameOrigin: true, reversible: true, url: 'https://example.com/projects/abc'
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'link', label: 'Project', sameOrigin: true, reversible: true,
      url: 'https://chatgpt.com/g/g-p-abc123/project'
    })).toBe('safe')
  })

  it.each([
    '/c/550e8400-e29b-41d4-a716-446655440000',
    '/conversation/550e8400-e29b-41d4-a716-446655440000',
    '/g/g-p-example123/c/550e8400-e29b-41d4-a716-446655440000'
  ])('allows an opaque read-only conversation route: %s', path => {
    expect(classifyCandidate({
      kind: 'link',
      label: 'Quarterly design review',
      sameOrigin: true,
      reversible: true,
      url: `https://example.com${path}`
    })).toBe('safe')
  })

  it('never follows a state-changing route even when its label looks harmless', () => {
    expect(classifyCandidate({
      kind: 'link',
      label: 'Continue',
      sameOrigin: true,
      reversible: true,
      url: 'https://example.com/delete/123'
    })).toBe('blocked')
    expect(classifyCandidate({
      kind: 'link',
      label: 'Home',
      sameOrigin: true,
      reversible: true,
      url: 'https://example.com/archive/123'
    })).toBe('blocked')
  })

  it.each([
    '/projects/new',
    '/projects/join',
    '/projects/duplicate',
    '/workspace/clone',
    '/g/new/project',
    '/g/import/project'
  ])('blocks action slugs that occupy an otherwise safe project-id position: %s', path => {
    expect(classifyCandidate({
      kind: 'link',
      label: 'Project',
      sameOrigin: true,
      reversible: true,
      url: `https://example.com${path}`
    })).toBe('blocked')
  })

  it.each([
    'install', 'connect', 'authorize', 'purchase', 'buy', 'send', 'submit', 'create', 'pin', 'new-chat'
  ])('blocks /%s routes even with a read-only label', action => {
    expect(classifyCandidate({
      kind: 'link',
      label: 'View',
      sameOrigin: true,
      reversible: true,
      url: `https://example.com/${action}/123`
    })).toBe('blocked')
  })

  it('skips same-origin links unless their label is an explicit read-only destination', () => {
    expect(classifyCandidate({
      kind: 'link', label: 'Continue', sameOrigin: true, reversible: true, url: 'https://example.com/continue'
    })).toBe('uncertain')
    expect(classifyCandidate({
      kind: 'link', label: 'Project status', sameOrigin: true, reversible: true, url: 'https://example.com/status'
    })).toBe('safe')
    expect(classifyCandidate({
      kind: 'link', label: 'Home', sameOrigin: true, reversible: true, url: 'https://example.com/mystery'
    })).toBe('uncertain')
  })

  it('rejects a long almost-safe navigation route without excessive backtracking', () => {
    const path = `/${Array.from({ length: 26 }, () => 'project').join('/')}/!`
    const startedAt = performance.now()

    const risk = classifyCandidate({
      kind: 'link',
      label: 'Home',
      sameOrigin: true,
      reversible: true,
      url: `https://example.com${path}`
    })

    expect(risk).toBe('uncertain')
    expect(performance.now() - startedAt).toBeLessThan(100)
  })

  it.each([
    '/profile/edit',
    '/account',
    '/projects/123/archive',
    '/projects/123/checkout',
    '/workspace/invite/accept',
    '/logout'
  ])('blocks known action and management destinations: %s', path => {
    expect(classifyCandidate({
      kind: 'link', label: 'View', sameOrigin: true, reversible: true, url: `https://example.com${path}`
    })).toBe('blocked')
  })

  it.each([
    '/projects/123/unsubscribe',
    '/projects/123/deactivate'
  ])('does not trust arbitrary descendants of an allowed area: %s', path => {
    expect(classifyCandidate({
      kind: 'link', label: 'View', sameOrigin: true, reversible: true, url: `https://example.com${path}`
    })).toBe('uncertain')
  })

  it('skips unlabeled controls and leaves unknown buttons uncertain', () => {
    expect(classifyCandidate({ kind: 'link', label: '', sameOrigin: true, reversible: true })).toBe('uncertain')
    expect(classifyCandidate({ kind: 'button', label: 'Mystery', sameOrigin: true, reversible: false })).toBe('uncertain')
  })

  it('does not treat arbitrary shallow routes as safe merely because they are structural navigation', () => {
    expect(classifyCandidate({
      kind: 'link',
      label: 'Workspace',
      sameOrigin: true,
      reversible: true,
      structuralNavigation: true,
      url: 'https://example.com/app'
    })).toBe('uncertain')
    expect(classifyCandidate({
      kind: 'link',
      label: 'Catalog',
      sameOrigin: true,
      reversible: true,
      structuralNavigation: true,
      url: 'https://example.com/catalog/view'
    })).toBe('uncertain')
    expect(classifyCandidate({
      kind: 'link',
      label: 'Catalog',
      sameOrigin: true,
      reversible: true,
      structuralNavigation: false,
      url: 'https://example.com/catalog/view'
    })).toBe('uncertain')
    expect(classifyCandidate({
      kind: 'link',
      label: 'Open',
      sameOrigin: true,
      reversible: true,
      structuralNavigation: true,
      url: 'https://example.com/catalog/550e8400-e29b-41d4-a716-446655440000'
    })).toBe('uncertain')
    expect(classifyCandidate({
      kind: 'link',
      label: 'Settings',
      sameOrigin: true,
      reversible: true,
      structuralNavigation: true,
      url: 'https://example.com/settings'
    })).toBe('safe')
  })
})
