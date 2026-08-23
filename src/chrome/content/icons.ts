import type {
  ColorValue,
  ControlSlot,
  ControlToken,
  IconCategory,
  IconInteractionState,
  IconInteractionSurface,
  IconTheme,
  IconToken
} from '../../shared/schema'
import { isAuthorSuppliedGraphicPayload } from './content-payload'
import { isSafeIconNameValue } from '../../shared/schema'
import { stableIconId } from '../../shared/stable-id'
import { parseCssColor } from './colors'
import { isPrivateControlContext } from './control-sample-text'
import { HOVER_TARGET_ATTRIBUTE } from './hover-state-explorer'
import { findPaintedIconSurface } from './icon-interaction-surface'
import {
  discoverUiGraphicCandidates,
  sanitizeUiGraphic,
  UI_GRAPHIC_SELECTOR
} from './ui-graphic'
import {
  FONT_ICON_SELECTOR,
  isFontIconCandidate
} from './font-icon'
import {
  isRenderedVisualElement,
  isRenderedVisualTextContainer
} from './rendered-visual'
import {
  isLikelyBrandGraphic,
  isLikelyGraphicOnlyBrandCluster,
  isLikelyIdentityGraphic,
  isLikelyTitledWordmarkGraphic
} from './ui-vector'

type IconEvidence = IconToken & {
  nameEvidence: Array<{
    value: string
    occurrences: number
    priority: number
    source: NonNullable<IconToken['nameSource']>
  }>
}

function normalizedNumber(value: number): number {
  return Number(value.toFixed(4))
}

function visible(element: Element, view: Window): boolean {
  return isRenderedVisualElement(element, view)
}

function normalizeName(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (/^[\x00-\x7F]+$/.test(normalized)) {
    return normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }
  return normalized
}

function firstSafeVisibleControlText(
  control: HTMLElement | null,
  view: Window
): string | null {
  if (!control) return null
  const walker = control.ownerDocument.createTreeWalker(
    control,
    control.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4
  )
  let node = walker.nextNode()
  while (node) {
    const parent = node.parentElement
    const value = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (
      parent &&
      value &&
      !parent.closest(UI_GRAPHIC_SELECTOR) &&
      visible(parent, view) &&
      isRenderedVisualTextContainer(parent, view, control) &&
      isSafeIconNameValue(value)
    ) return value
    node = walker.nextNode()
  }
  return null
}

function safeName(
  element: Element,
  repeatedNavigationCard = false
): {
  value: string
  priority: number
  source: NonNullable<IconToken['nameSource']>
} | null {
  const control = element.closest<HTMLElement>(
    'button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],a[href]'
  )
  if (
    !repeatedNavigationCard &&
    isPrivateControlContext(control ?? element)
  ) return null
  const view = element.ownerDocument.defaultView
  const values = [
    {
      value: element.getAttribute('title'),
      priority: 3,
      source: 'svg-title' as const
    },
    {
      value: element.querySelector('title')?.textContent,
      priority: 3,
      source: 'svg-title' as const
    },
    {
      value: control?.getAttribute('title'),
      priority: 3,
      source: 'svg-title' as const
    },
    {
      value: repeatedNavigationCard && view
        ? firstSafeVisibleControlText(control, view)
        : null,
      priority: 2,
      source: 'visible-text' as const
    }
  ]
  for (const candidate of values) {
    const value = candidate.value?.replace(/\s+/g, ' ').trim() ?? ''
    if (
      !isSafeIconNameValue(value)
    ) continue
    const name = normalizeName(value)
    if (name) return {
      value: name.slice(0, 64),
      priority: candidate.priority,
      source: candidate.source
    }
  }
  return null
}

function categoryFor(element: Element, name: string | null): IconCategory {
  const normalized = name ?? ''
  if (
    element.closest('nav,aside,header,[role="navigation"]') ||
    /(?:search|menu|sidebar|navigation|back|forward|home|history|library|project|plugin|搜索|菜单|侧边栏|导航|返回|主页|历史|项目|插件)/i.test(normalized)
  ) return 'navigation'
  if (
    element.closest('form,[contenteditable]:not([contenteditable="false"])') ||
    /(?:attach|upload|send|voice|mic|dictat|compose|add-files?|添加|附件|上传|发送|语音|听写)/i.test(normalized)
  ) return 'composer'
  if (
    element.closest('[role="status"],[role="alert"]') ||
    /(?:success|warning|error|info|check|alert|成功|警告|错误|提示|状态)/i.test(normalized)
  ) return 'status-system'
  if (element.closest('button,[role="button"],[role="menuitem"],[role="option"]')) {
    return 'action'
  }
  return 'misc'
}

function foreground(element: Element, view: Window): ColorValue {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const color = parseCssColor(view.getComputedStyle(current).color)
    if (color && color.a > 0) return color
  }
  return { r: 0, g: 0, b: 0, a: 1 }
}

function themeFor(element: Element, view: Window): IconTheme {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const background = parseCssColor(view.getComputedStyle(current).backgroundColor)
    if (!background || background.a < 0.5) continue
    const luminance = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b
    return luminance < 0.5 ? 'dark' : 'light'
  }
  return 'light'
}

const ICON_CONTROL_SELECTOR =
  'button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],a[href]'
const REPEATED_NAVIGATION_CARD_SELECTOR = 'a[href],button,[role="button"]'

function hasVisibleControlText(control: HTMLElement, view: Window): boolean {
  const document = control.ownerDocument
  const walker = document.createTreeWalker(
    control,
    document.defaultView?.NodeFilter.SHOW_TEXT ?? 4
  )
  let node = walker.nextNode()
  while (node) {
    if (
      node.textContent?.trim() &&
      !(node.parentElement?.closest('svg')) &&
      Boolean(node.parentElement) &&
      isRenderedVisualTextContainer(node.parentElement!, view, control) &&
      !(
        node.parentElement?.closest(FONT_ICON_SELECTOR) &&
        isFontIconCandidate(
          node.parentElement.closest(FONT_ICON_SELECTOR)!,
          view
        )
      )
    ) return true
    node = walker.nextNode()
  }
  return false
}

/**
 * Distinguishes a reusable navigation-category glyph from an identity asset
 * without reading a site or product name.
 *
 * A lone self-describing card remains quarantined. When at least three visible
 * same-level interactive cards share comparable geometry and each carries
 * rendered text plus one compact graphic, the repeated slot is evidence of a
 * website-owned category system rather than an authored entity payload.
 */
export function isRepeatedNavigationCardGraphic(
  element: Element,
  view: Window
): boolean {
  const control = element.closest<HTMLElement>(
    REPEATED_NAVIGATION_CARD_SELECTOR
  )
  if (
    !control ||
    !visible(control, view) ||
    !hasVisibleControlText(control, view)
  ) return false
  const graphicBounds = element.getBoundingClientRect()
  const controlBounds = control.getBoundingClientRect()
  if (
    graphicBounds.width < 12 ||
    graphicBounds.height < 12 ||
    graphicBounds.width > 64 ||
    graphicBounds.height > 64 ||
    controlBounds.width < 96 ||
    controlBounds.height < 48
  ) return false

  let container = control.parentElement
  for (let depth = 0; container && depth < 3; depth += 1) {
    if (
      container === control.ownerDocument.body ||
      container === control.ownerDocument.documentElement
    ) break
    const peers: HTMLElement[] = Array.from(
      container.querySelectorAll<HTMLElement>(
        REPEATED_NAVIGATION_CARD_SELECTOR
      )
    ).filter((peer: HTMLElement) => peer.parentElement === container)
    const compatible: HTMLElement[] = peers.filter((peer: HTMLElement) => {
      if (!visible(peer, view) || !hasVisibleControlText(peer, view)) return false
      const bounds = peer.getBoundingClientRect()
      const widthTolerance = Math.max(16, controlBounds.width * 0.25)
      const heightTolerance = Math.max(12, controlBounds.height * 0.25)
      if (
        Math.abs(bounds.width - controlBounds.width) > widthTolerance ||
        Math.abs(bounds.height - controlBounds.height) > heightTolerance
      ) return false
      const graphics = discoverUiGraphicCandidates(peer, view)
        .filter(candidate => visible(candidate.host, view))
      return graphics.length === 1
    })
    if (compatible.includes(control) && compatible.length >= 3) return true
    container = container.parentElement
  }
  return false
}

function interactionState(control: HTMLElement): IconInteractionState {
  const state = control.getAttribute('data-state')?.trim().toLowerCase()
  if (state === 'hover' || state === 'pressed' || state === 'selected') return state
  if (control.hasAttribute(HOVER_TARGET_ATTRIBUTE)) return 'hover'
  if (
    control.matches(':active') ||
    control.getAttribute('aria-pressed') === 'true'
  ) return 'pressed'
  if (
    control.getAttribute('aria-selected') === 'true' ||
    control.getAttribute('aria-current') === 'true'
  ) return 'selected'
  if (control.getAttribute('aria-expanded') === 'true') return 'expanded'
  return 'default'
}

function interactionSurface(
  element: Element,
  view: Window
): IconInteractionSurface | null {
  const control = element.closest<HTMLElement>(ICON_CONTROL_SELECTOR)
  if (
    !control ||
    !visible(control, view) ||
    hasVisibleControlText(control, view) ||
    discoverUiGraphicCandidates(control, view).length !== 1
  ) return null
  const surface = findPaintedIconSurface(element, view)
  if (!surface) return null
  const graphicBounds = element.getBoundingClientRect()
  const maximumCompactScale = 4
  if (
    surface.width > graphicBounds.width * maximumCompactScale ||
    surface.height > graphicBounds.height * maximumCompactScale
  ) return null
  return {
    state: interactionState(control),
    theme: themeFor(surface.element, view),
    background: surface.background,
    width: surface.width,
    height: surface.height,
    radii: surface.radii,
    occurrences: 1
  }
}

function surfaceKey(surface: IconInteractionSurface): string {
  return JSON.stringify({
    state: surface.state,
    theme: surface.theme,
    background: surface.background,
    width: surface.width,
    height: surface.height,
    radii: surface.radii
  })
}

function chooseName(
  evidence: IconEvidence['nameEvidence'],
  id: string
): {
  value: string
  source: NonNullable<IconToken['nameSource']>
} {
  const maximumPriority = Math.max(0, ...evidence.map(item => item.priority))
  const ranked = evidence
    .filter(item => item.priority === maximumPriority)
    .sort((left, right) =>
    right.occurrences - left.occurrences ||
    left.value.localeCompare(right.value)
  )
  const distinct = [...new Set(ranked.map(item => item.value))]
  if (distinct.length === 1) return {
    value: distinct[0]!,
    source: ranked[0]?.source ?? 'geometry'
  }
  const actionNames = distinct.filter(value =>
    /^(?:open|close|toggle|show|hide|start|stop|turn|add|remove|search|create|edit|download|upload|打开|关闭|切换|显示|隐藏|开始|停止|添加|移除|搜索|创建|编辑|下载|上传)(?:-|$)/i.test(value)
  )
  if (actionNames.length === 1) return {
    value: actionNames[0]!,
    source: ranked.find(item => item.value === actionNames[0])?.source ?? 'accessible-name'
  }
  if (distinct.length > 1 && distinct.every(value => /^[a-z0-9-]+$/.test(value))) {
    const words = distinct.map(value => value.split('-').filter(Boolean))
    const prefix: string[] = []
    for (let index = 0; index < Math.min(...words.map(value => value.length)); index += 1) {
      const word = words[0]?.[index]
      if (!word || !words.every(value => value[index] === word)) break
      prefix.push(word)
    }
    while (['for', 'to', 'of', 'the', 'and', 'or'].includes(prefix.at(-1) ?? '')) {
      prefix.pop()
    }
    if (prefix.length > 0) return {
      value: prefix.join('-'),
      source: ranked[0]?.source ?? 'accessible-name'
    }
  }
  return {
    value: `icon-${id.slice('sha256:'.length, 'sha256:'.length + 6)}`,
    source: 'geometry'
  }
}

function mergeEvidence(
  existing: IconEvidence,
  incoming: IconEvidence,
  addStateOccurrences: boolean
): IconEvidence {
  const sizes = new Map(existing.observedSizes.map(size => [
    `${size.width}x${size.height}`,
    { ...size }
  ]))
  for (const size of incoming.observedSizes) {
    const key = `${size.width}x${size.height}`
    const current = sizes.get(key)
    sizes.set(key, current
      ? { ...current, occurrences: current.occurrences + size.occurrences }
      : { ...size })
  }
  const themes = new Map(existing.themes.map(theme => [theme.theme, { ...theme }]))
  for (const theme of incoming.themes) {
    const current = themes.get(theme.theme)
    if (!current) {
      themes.set(theme.theme, { ...theme })
      continue
    }
    const currentColorKey = JSON.stringify(current.color)
    const incomingColorKey = JSON.stringify(theme.color)
    const preferIncomingColor =
      theme.occurrences > current.occurrences ||
      (theme.occurrences === current.occurrences && incomingColorKey < currentColorKey)
    themes.set(theme.theme, {
      ...(preferIncomingColor ? theme : current),
      occurrences: current.occurrences + theme.occurrences
    })
  }
  const names = new Map(existing.nameEvidence.map(name => [name.value, { ...name }]))
  for (const name of incoming.nameEvidence) {
    const current = names.get(name.value)
    names.set(name.value, current
      ? {
          ...(name.priority > current.priority ? name : current),
          occurrences: current.occurrences + name.occurrences
        }
      : { ...name })
  }
  const surfaces = new Map(
    (existing.interactionSurfaces ?? []).map(surface => [
      surfaceKey(surface),
      { ...surface, radii: { ...surface.radii } }
    ])
  )
  for (const surface of incoming.interactionSurfaces ?? []) {
    const key = surfaceKey(surface)
    const current = surfaces.get(key)
    surfaces.set(key, current
      ? { ...current, occurrences: current.occurrences + surface.occurrences }
      : { ...surface, radii: { ...surface.radii } })
  }
  const nameEvidence = [...names.values()]
  const chosenName = chooseName(nameEvidence, existing.id)
  return {
    ...existing,
    name: chosenName.value,
    nameSource: chosenName.source,
    category: existing.category === 'misc' ? incoming.category : existing.category,
    observedSizes: [...sizes.values()].sort((left, right) =>
      left.width - right.width || left.height - right.height
    ),
    themes: [...themes.values()].sort((left, right) =>
      left.theme.localeCompare(right.theme)
    ),
    ...(surfaces.size > 0
      ? {
          interactionSurfaces: [...surfaces.values()].sort((left, right) =>
            left.state.localeCompare(right.state) ||
            left.theme.localeCompare(right.theme) ||
            left.width - right.width ||
            left.height - right.height ||
            surfaceKey(left).localeCompare(surfaceKey(right))
          )
        }
      : { interactionSurfaces: undefined }),
    occurrences: existing.occurrences + incoming.occurrences,
    stateOccurrences: addStateOccurrences
      ? existing.stateOccurrences + incoming.stateOccurrences
      : Math.max(existing.stateOccurrences, incoming.stateOccurrences),
    nameEvidence
  }
}

export function mergeIconTokens(
  groups: IconToken[][]
): IconToken[] {
  const merged = new Map<string, IconEvidence>()
  for (const token of groups.flat()) {
    const evidence: IconEvidence = {
      ...token,
      nameEvidence: token.name.startsWith('icon-')
        ? []
        : [{
            value: token.name,
            occurrences: token.occurrences,
            priority: token.nameSource === 'accessible-name'
              ? 4
              : token.nameSource === 'svg-title'
                ? 3
                : token.nameSource === 'visible-text'
                  ? 2
                  : 1,
            source: token.nameSource ?? 'visible-text'
          }]
    }
    const existing = merged.get(token.id)
    merged.set(token.id, existing ? mergeEvidence(existing, evidence, true) : evidence)
  }
  return [...merged.values()]
    .map(({ nameEvidence: _evidence, ...token }) => token)
    .sort((left, right) =>
      left.category.localeCompare(right.category) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    )
}

export async function collectExcludedGraphicIds(document: Document): Promise<string[]> {
  const view = document.defaultView
  if (!view) return []
  const ids = new Set<string>()
  for (const candidate of discoverUiGraphicCandidates(document, view)) {
    const element = candidate.host
    const repeatedNavigationCard = isRepeatedNavigationCardGraphic(element, view)
    if (
      !visible(element, view) ||
      (
        !isLikelyBrandGraphic(element) &&
        !isLikelyGraphicOnlyBrandCluster(element, view) &&
        (
          repeatedNavigationCard ||
          !isLikelyIdentityGraphic(element, view)
        ) &&
        !isLikelyTitledWordmarkGraphic(element, view)
      )
    ) continue
    const sanitized = await sanitizeUiGraphic(candidate, view, {
      vector: {
        allowCurrentColorFill: true,
        allowResolvedCurrentColorFill: true,
        maximumLength: 65_536
      }
    })
    if (!sanitized) continue
    ids.add(await stableIconId({ vectorSvg: sanitized.vectorSvg }))
  }
  return [...ids].sort()
}

export async function quarantineExcludedGraphics<T extends ControlToken>(
  controls: T[],
  icons: IconToken[],
  excludedGraphicIds: Iterable<string>
): Promise<{ controls: T[]; icons: IconToken[] }> {
  const excluded = new Set(excludedGraphicIds)
  if (excluded.size === 0) return { controls, icons }
  const slotIdCache = new Map<string, Promise<string>>()
  const quarantineSlot = async (slot: ControlSlot | null): Promise<ControlSlot | null> => {
    if (!slot?.vectorSvg || slot.assetType !== 'ui-icon') return slot
    let id = slotIdCache.get(slot.vectorSvg)
    if (!id) {
      id = stableIconId({ vectorSvg: slot.vectorSvg })
      slotIdCache.set(slot.vectorSvg, id)
    }
    if (!excluded.has(await id)) return slot
    return {
      width: slot.width,
      height: slot.height,
      assetType: 'unknown'
    }
  }
  return {
    controls: await Promise.all(controls.map(async token => ({
      ...token,
      slots: {
        leading: await quarantineSlot(token.slots.leading),
        trailing: await quarantineSlot(token.slots.trailing)
      }
    }))),
    icons: icons.filter(token => !excluded.has(token.id))
  }
}

export async function collectIcons(document: Document): Promise<IconToken[]> {
  const view = document.defaultView
  if (!view) return []
  const merged = new Map<string, IconEvidence>()
  for (const candidate of discoverUiGraphicCandidates(document, view)) {
    const element = candidate.host
    const repeatedNavigationCard = isRepeatedNavigationCardGraphic(element, view)
    if (
      !visible(element, view) ||
      isLikelyBrandGraphic(element) ||
      isLikelyGraphicOnlyBrandCluster(element, view) ||
      (
        !repeatedNavigationCard &&
        isLikelyIdentityGraphic(element, view)
      ) ||
      isLikelyTitledWordmarkGraphic(element, view) ||
      isAuthorSuppliedGraphicPayload(element) ||
      (
        element.getAttribute('role') === 'img' &&
        Boolean(element.getAttribute('aria-label')?.trim()) &&
        !repeatedNavigationCard &&
        !element.closest(
          'button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],a[href]'
        )
      ) ||
      (
        !repeatedNavigationCard &&
        isPrivateControlContext(element)
      )
    ) continue
    const sanitized = await sanitizeUiGraphic(candidate, view, {
      vector: {
        allowCurrentColorFill: true,
        allowResolvedCurrentColorFill: true,
        maximumLength: 65_536
      }
    })
    if (!sanitized) continue
    const bounds = element.getBoundingClientRect()
    const id = await stableIconId({ vectorSvg: sanitized.vectorSvg })
    const safe = safeName(element, repeatedNavigationCard)
    if (!safe && element.closest(
      '[data-testid*="profile" i],[data-testid*="account" i],[aria-label*="account" i],[aria-label*="账户"],[aria-label*="账号"]'
    )) continue
    const surface = interactionSurface(element, view)
    const evidence: IconEvidence = {
      id,
      name: safe?.value ?? `icon-${id.slice('sha256:'.length, 'sha256:'.length + 6)}`,
      nameSource: safe?.source ?? 'geometry',
      category: categoryFor(element, safe?.value ?? null),
      vectorSvg: sanitized.vectorSvg,
      viewBox: sanitized.viewBox,
      observedSizes: [{
        width: normalizedNumber(bounds.width),
        height: normalizedNumber(bounds.height),
        occurrences: 1
      }],
      themes: [{
        theme: themeFor(element, view),
        color: foreground(element, view),
        occurrences: 1
      }],
      ...(surface ? { interactionSurfaces: [surface] } : {}),
      occurrences: 1,
      stateOccurrences: 1,
      nameEvidence: safe ? [{
        value: safe.value,
        occurrences: 1,
        priority: safe.priority,
        source: safe.source
      }] : []
    }
    const existing = merged.get(id)
    merged.set(id, existing ? mergeEvidence(existing, evidence, false) : evidence)
  }
  return [...merged.values()]
    .map(({ nameEvidence: _evidence, ...token }) => token)
    .sort((left, right) =>
      left.category.localeCompare(right.category) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    )
}
