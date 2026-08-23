export type Candidate = {
  kind: 'link' | 'tab' | 'disclosure' | 'dialog-close' | 'button'
  label: string
  sameOrigin: boolean
  reversible: boolean
  structuralDisclosure?: boolean
  structuralNavigation?: boolean
  url?: string
}

export type Risk = 'safe' | 'uncertain' | 'blocked'
export type CandidateRiskReason =
  | 'structural-disclosure'
  | 'settings-disclosure'
  | 'share-opener'
  | 'settings-navigation'
  | 'blocked-label-or-route'
  | 'missing-label-or-cross-origin'
  | 'safe-navigation'
  | 'reversible-semantic'
  | 'default-uncertain'

const blockedLabel = /\b(delete|remove|clear|reset|archive|logout|log out|sign out|install|uninstall|connect|disconnect|authorize|purchase|buy|checkout|send|submit|save|apply|update|create|pin|settings|billing|subscription|edit profile|new chat|share|unshare|publish|invite|copy link|public link)\b|退出|登出|注销|删除|移除|清除|重置|归档|置顶|安装|卸载|连接|断开|授权|购买|结账|发送|提交|保存|应用|更新|创建|设置|账单|订阅|编辑资料|新对话|分享|取消分享|发布|邀请|复制链接|公开链接/i
const exactSettingsDisclosureLabel = /^(?:settings|preferences|设置|偏好设置)$/i
const qualifiedSettingsDisclosureLabel =
  /^([\p{L}\p{N}][\p{L}\p{N}._-]{0,31})\s+(settings|preferences)$/iu
const unsafeSettingsQualifier =
  /^(?:account|admin|apply|billing|connect|create|delete|disconnect|edit|invite|manage|management|new|payment|profile|publish|reset|save|security|share|subscription|update)$/i
const blockedRoute = /(?:\/|[?&=])(delete|remove|clear|reset|archive|logout|signout|install|uninstall|connect|disconnect|authorize|revoke|purchase|buy|checkout|send|submit|save|apply|update|create|new|join|duplicate|clone|import|pin|leave|invite|accept|new[-_]?chat|account|billing|subscription|edit|manage|security)(?:[-_/]|$|[?&#=])/i
const settingsRoute = /^\/(?:settings|preferences)(?:\/[^/?#]+)*\/?$/i
const safeShareOpenerLabel = /^(?:share|分享)$/i
const safeNavigationLabel = /\b(home|search|explore|discover|browse|library|plugins?|plugin store|extensions?|projects?|project status|status|overview|docs?|documentation|help|history|dashboard|workspace|view|profile|personal page)\b|首页|主页|搜索|探索|发现|浏览|插件库|插件|扩展|项目状态|项目|状态|概览|文档|帮助|历史|工作台|查看|个人主页|个人资料/i
const safeNavigationSegments = new Set([
  'home', 'search', 'explore', 'discover', 'browse', 'library',
  'plugin', 'plugins', 'plugin-store', 'extension', 'extensions',
  'project', 'projects', 'status', 'overview', 'doc', 'docs',
  'documentation', 'help', 'history', 'dashboard', 'workspace',
  'view', 'gpt', 'gpts', 'tool', 'tools', 'profile', 'me'
])
const safeProjectDetailRoute = /^\/(?:projects?|workspace)\/[^/]+\/?$/i
const safeNestedProjectRoute = /^\/g\/[^/]+\/project\/?$/i
const safeConversationRoute = /^\/(?:(?:c|chats?|conversations?)\/[a-z0-9][a-z0-9_-]{5,}|g\/[a-z0-9][a-z0-9_-]{5,}\/c\/[a-z0-9][a-z0-9_-]{5,})\/?$/i

function hasBlockedRoute(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return blockedRoute.test(`${parsed.pathname}${parsed.search}`)
  } catch {
    return true
  }
}

function hasSafeNavigationRoute(url: string | undefined): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname
    const pathWithoutTrailingSlash = pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname
    const segments = pathWithoutTrailingSlash === '/'
      ? []
      : pathWithoutTrailingSlash.slice(1).split('/')
    const hasOnlySafeSegments = segments.every(segment =>
      safeNavigationSegments.has(segment.toLowerCase())
    )
    return hasOnlySafeSegments ||
      safeProjectDetailRoute.test(pathname) ||
      safeNestedProjectRoute.test(pathname)
  } catch {
    return false
  }
}

function hasSafeConversationRoute(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return !parsed.search && safeConversationRoute.test(parsed.pathname)
  } catch {
    return false
  }
}

function hasSafeSettingsRoute(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return !parsed.search &&
      !parsed.hash &&
      settingsRoute.test(parsed.pathname) &&
      !blockedRoute.test(parsed.pathname)
  } catch {
    return false
  }
}

export function isSafeSettingsDisclosureLabel(label: string): boolean {
  const normalized = label.trim()
  if (exactSettingsDisclosureLabel.test(normalized)) return true
  const qualified = qualifiedSettingsDisclosureLabel.exec(normalized)
  return Boolean(qualified?.[1] && !unsafeSettingsQualifier.test(qualified[1]))
}

export function classifyCandidateWithReason(candidate: Candidate): {
  risk: Risk
  reason: CandidateRiskReason
} {
  if (
    candidate.kind === 'disclosure' &&
    candidate.structuralDisclosure === true &&
    candidate.sameOrigin &&
    candidate.reversible &&
    !candidate.url
  ) return { risk: 'safe', reason: 'structural-disclosure' }
  if (
    candidate.kind === 'disclosure' &&
    candidate.sameOrigin &&
    candidate.reversible &&
    !candidate.url &&
    isSafeSettingsDisclosureLabel(candidate.label)
  ) return { risk: 'safe', reason: 'settings-disclosure' }
  if (
    candidate.kind === 'button' &&
    candidate.sameOrigin &&
    safeShareOpenerLabel.test(candidate.label.trim())
  ) return { risk: 'safe', reason: 'share-opener' }
  if (
    candidate.kind === 'link' &&
    candidate.sameOrigin &&
    candidate.reversible &&
    isSafeSettingsDisclosureLabel(candidate.label) &&
    hasSafeSettingsRoute(candidate.url)
  ) return { risk: 'safe', reason: 'settings-navigation' }
  if (blockedLabel.test(candidate.label) || hasBlockedRoute(candidate.url)) {
    return { risk: 'blocked', reason: 'blocked-label-or-route' }
  }
  if (!candidate.label.trim() || !candidate.sameOrigin) {
    return { risk: 'uncertain', reason: 'missing-label-or-cross-origin' }
  }
  if (candidate.kind === 'link') {
    const safe = candidate.reversible && (
      hasSafeConversationRoute(candidate.url) ||
      (safeNavigationLabel.test(candidate.label) && hasSafeNavigationRoute(candidate.url))
    )
    return safe
      ? { risk: 'safe', reason: 'safe-navigation' }
      : { risk: 'uncertain', reason: 'default-uncertain' }
  }
  if (
    candidate.reversible &&
    (candidate.kind === 'tab' || candidate.kind === 'disclosure' || candidate.kind === 'dialog-close')
  ) return { risk: 'safe', reason: 'reversible-semantic' }
  return { risk: 'uncertain', reason: 'default-uncertain' }
}

export function classifyCandidate(candidate: Candidate): Risk {
  return classifyCandidateWithReason(candidate).risk
}
