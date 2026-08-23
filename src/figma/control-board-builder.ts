import type { ControlToken } from '../shared/schema'
import type { AppliedControl, ControlComponentPort } from './control-component-applier'
import type { AppliedComposite } from './composite-component-applier'
import {
  readControlOwnership,
  writeControlOwnership
} from './control-component-applier'
import {
  CONTROL_BOARD_SPEC,
  atomicPreviewHeight,
  atomicSpecimenWidth,
  type ControlCatalogSection,
  layoutControlBoard
} from './control-board-spec'
import type { AvailableFontName } from './font-resolver'
import { resolveAnnotationFonts } from './annotation-font-resolver'
import {
  controlContentKind,
  controlPresentationForeground,
  controlPresentationSize,
  controlPresentationSurface,
  reusableControlStateFamilyKey
} from './control-presentation'
import {
  controlFamilyHeading,
  localizeCompositeDirection,
  localizeCompositeKind,
  localizeCompositeState,
  localizeControlContent,
  localizeControlForeground,
  localizeControlIntent,
  localizeControlSize,
  localizeControlState,
  localizeControlSurface,
  localizeWidthBehavior
} from './control-caption-localization'
import {
  controlNeedsDarkPreview,
  controlPreviewNote,
  controlPreviewSurfacePaint
} from './control-preview-surface'

export const CONTROL_BOARD_OWNERSHIP_KEY = 'smartScanControlBoardOrigin'

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.42, g: 0.42, b: 0.42 } }
const SEPARATOR: SolidPaint = { type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }
const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
const SPECIMEN_BORDER: SolidPaint = { type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 } }

function title(value: string): string {
  return value
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function createText(
  characters: string,
  fontName: AvailableFontName,
  fontSize: number,
  lineHeight: number,
  fill: SolidPaint
): Promise<TextNode> {
  const node = figma.createText()
  node.fontName = fontName
  node.fontSize = fontSize
  node.characters = characters
  node.lineHeight = { unit: 'PIXELS', value: lineHeight }
  node.fills = [fill]
  node.textAutoResize = 'WIDTH_AND_HEIGHT'
  return node
}

function wrapText(node: TextNode, width: number): void {
  node.textAutoResize = 'HEIGHT'
  node.resize(Math.max(1, width), Math.max(1, node.height))
}

function findOwnedBoard(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readControlOwnership(node, CONTROL_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
}

function placeNewBoard(board: FrameNode): void {
  const foundations = figma.currentPage.children.filter(node =>
    node.type === 'FRAME' && node.name.startsWith('UI-Anatomist /')
  ) as FrameNode[]
  if (foundations.length === 0) {
    board.x = 100
    board.y = 100
    return
  }
  board.x = Math.min(...foundations.map(node => node.x))
  board.y = Math.max(...foundations.map(node => node.y + node.height)) + 80
}

const BOARD_STATE_ORDER = [
  'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
] as const

function controlSurfaceScore(source: ControlToken): number {
  const background = source.appearance.background.a > 0
    ? 400 + source.appearance.background.a * 100
    : 0
  const hasBorder = source.geometry.borderWidth > 0 ||
    Object.values(source.geometry.borderWidths ?? {}).some(width => width > 0)
  const border = hasBorder && source.appearance.border.a > 0
    ? 300 + source.appearance.border.a * 100
    : 0
  const outline = source.appearance.outlineWidth > 0 &&
    source.appearance.outline.a > 0
    ? 200 + source.appearance.outline.a * 100
    : 0
  const shadow = source.appearance.shadows.some(item => item.color.a > 0)
    ? 100
    : 0
  return Math.max(background, border, outline, shadow)
}

function specimenSurfaceScore(value: AppliedControl): number {
  return controlSurfaceScore(value.entry.source)
}

function boardEvidenceOrder(left: AppliedControl, right: AppliedControl): number {
  return specimenSurfaceScore(right) - specimenSurfaceScore(left) ||
    BOARD_STATE_ORDER.indexOf(left.entry.source.state) -
      BOARD_STATE_ORDER.indexOf(right.entry.source.state) ||
    right.entry.source.stateOccurrences - left.entry.source.stateOccurrences ||
    right.entry.source.occurrences - left.entry.source.occurrences ||
    left.entry.source.id.localeCompare(right.entry.source.id)
}

function catalogSourceOrder(left: ControlToken, right: ControlToken): number {
  return BOARD_STATE_ORDER.indexOf(left.state) -
      BOARD_STATE_ORDER.indexOf(right.state) ||
    controlSurfaceScore(right) - controlSurfaceScore(left) ||
    right.stateOccurrences - left.stateOccurrences ||
    right.occurrences - left.occurrences ||
    left.id.localeCompare(right.id)
}

function selectCatalogPreviewSource(
  candidates: ControlToken[]
): ControlToken | null {
  const ordered = [...candidates].sort(catalogSourceOrder)
  const defaults = ordered.filter(source => source.state === 'default')
  const surfacedDefault = defaults.find(source => controlSurfaceScore(source) > 0)
  if (surfacedDefault) return surfacedDefault
  const surfacedHover = ordered.find(source =>
    source.state === 'hover' && controlSurfaceScore(source) > 0
  )
  return surfacedHover ?? defaults[0] ?? ordered[0] ?? null
}

type InstantiableComponent = ControlComponentPort & {
  createInstance(): InstanceNode
}

type AtomicPreview = {
  applied: AppliedControl
  source: ControlToken
  placementWidth?: number
}

type AtomicCatalogGroup = {
  primary: AppliedControl
  values: AppliedControl[]
  previews: AtomicPreview[]
}

function confirmedUiSlot(source: ControlToken): boolean {
  const slots = [
    source.slots.leading,
    source.slots.trailing,
    ...(source.slotGroups?.leading ?? []),
    ...(source.slotGroups?.trailing ?? [])
  ]
  return slots.some(slot =>
    slot?.assetType === 'ui-icon' && Boolean(slot.vectorSvg)
  )
}

function hasPublicInstanceEvidence(source: ControlToken): boolean {
  return Boolean(
    source.sampleText ||
    source.supportingText ||
    confirmedUiSlot(source) ||
    (
      ['input', 'select', 'textarea'].includes(source.family) &&
      controlSurfaceScore(source) > 0
    ) ||
    ['toggle', 'checkbox', 'radio'].includes(source.family)
  )
}

function boardOnlyInputHint(source: ControlToken): string | null {
  if (source.sampleText) return null
  return ['input', 'select', 'textarea'].includes(source.family)
    ? '输入区域'
    : null
}

function controlBindingKey(value: Pick<
  ControlToken,
  'id' | 'instanceId' | 'state'
>): string {
  return `${value.id}|${value.instanceId ?? value.id}|${value.state}`
}

function observedPreviewWidths(
  composites: AppliedComposite[]
): Map<string, number> {
  const widths = new Map<string, Set<number>>()
  const visit = (children: AppliedComposite['entry']['children']): void => {
    for (const child of children) {
      if (child.kind === 'control' && child.placement) {
        const key = controlBindingKey({
          id: child.controlId,
          instanceId: child.instanceId,
          state: child.state
        })
        const values = widths.get(key) ?? new Set<number>()
        values.add(child.placement.width)
        widths.set(key, values)
      } else if (child.kind === 'structure' && child.children) {
        visit(child.children)
      }
    }
  }
  for (const composite of composites) visit(composite.entry.children)
  return new Map([...widths].flatMap(([key, values]) =>
    values.size === 1 ? [[key, [...values][0]!]] : []
  ))
}

function atomicCatalogGroups(
  values: AppliedControl[],
  previewWidths: ReadonlyMap<string, number>
): AtomicCatalogGroup[] {
  const byGroup = new Map<string, AppliedControl[]>()
  for (const value of values) {
    const group = byGroup.get(value.group.groupId) ?? []
    group.push(value)
    byGroup.set(value.group.groupId, group)
  }
  const mergedGroups: AppliedControl[][] = []
  const reusableFamilies = new Map<string, AppliedControl[]>()
  for (const groupValues of byGroup.values()) {
    const reusableKey = reusableControlStateFamilyKey(
      groupValues.map(value => value.entry.source)
    )
    if (!reusableKey) {
      mergedGroups.push(groupValues)
      continue
    }
    const family = reusableFamilies.get(reusableKey) ?? []
    family.push(...groupValues)
    reusableFamilies.set(reusableKey, family)
  }
  mergedGroups.push(...reusableFamilies.values())

  return mergedGroups.flatMap(groupValues => {
    const ordered = [...groupValues].sort(boardEvidenceOrder)
    const fallbackPrimary = ordered[0]!
    const modern = Boolean(
      fallbackPrimary.entry.source.templateId &&
      fallbackPrimary.entry.source.logicalControlId &&
      fallbackPrimary.entry.source.instanceId
    )
    if (!modern) {
      const source = selectCatalogPreviewSource(
        groupValues.map(value => value.entry.source)
      ) ?? fallbackPrimary.entry.source
      const primary = groupValues.find(value => value.entry.source === source) ??
        fallbackPrimary
      return [{
        primary,
        values: groupValues,
        previews: [{
          applied: primary,
          source,
          placementWidth: previewWidths.get(controlBindingKey(source))
        }]
      }]
    }
    const candidatesByInstance = new Map<string, ControlToken>()
    for (const value of groupValues) {
      for (const candidate of value.group.instances ?? [value.entry.source]) {
        candidatesByInstance.set(
          `${candidate.id}|${candidate.instanceId ?? candidate.id}|${candidate.state}`,
          candidate
        )
      }
    }
    const candidates = [...candidatesByInstance.values()]
    const publicCandidates = candidates.filter(hasPublicInstanceEvidence)
    if (publicCandidates.length === 0) return []
    const source = selectCatalogPreviewSource(publicCandidates)
    if (!source) return []
    const primary = groupValues.find(item =>
      item.entry.source.state === source.state
    ) ?? fallbackPrimary
    const previews = [{
      applied: primary,
      source,
      placementWidth: previewWidths.get(controlBindingKey(source))
    }]
    return [{ primary, values: groupValues, previews }]
  })
}

function compositeCatalogGroups(values: AppliedComposite[]): AppliedComposite[][] {
  const byGroup = new Map<string, AppliedComposite[]>()
  for (const value of values) {
    const group = byGroup.get(value.group.groupId) ?? []
    group.push(value)
    byGroup.set(value.group.groupId, group)
  }
  const stateOrder = [
    'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
  ]
  return [...byGroup.values()].map(group => [...group].sort((left, right) =>
    stateOrder.indexOf(left.entry.source.state) -
      stateOrder.indexOf(right.entry.source.state) ||
    left.entry.source.id.localeCompare(right.entry.source.id)
  ))
}

async function applySafeContentOverride(
  instance: InstanceNode,
  source: ControlToken
): Promise<void> {
  if (typeof instance.findOne !== 'function') return
  const values: Array<[string, string | undefined]> = source.content?.kind === 'compound-row'
    ? [
        ['Primary label', source.sampleText?.value],
        ['Supporting label', source.supportingText?.value]
      ]
    : source.content?.kind === 'compound-input'
      ? [['Placeholder', source.sampleText?.value]]
      : [['Label', source.sampleText?.value]]
  for (const [name, value] of values) {
    if (!value) continue
    const node = instance.findOne(child =>
      child.type === 'TEXT' && child.name === name
    )
    if (node?.type !== 'TEXT') continue
    if (node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName)
    node.characters = value
  }
}

type PreparedCatalogPreview = {
  component: InstantiableComponent
  source: ControlToken | null
  name: string
  stateLabel: string | null
  placementWidth?: number
}

type PreparedCatalogItem = {
  id: string
  family: ControlCatalogSection
  state: ControlToken['state'] | AppliedComposite['entry']['source']['state']
  width: number
  height: number
  previewHeight: number
  previewPaint: SolidPaint | null
  displayName: string
  assetName: TextNode
  caption: TextNode
  detail: TextNode
  previewAnnotation: TextNode | null
  previewStateLabels: boolean
  previews: PreparedCatalogPreview[]
}

function compactSafeEvidence(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= 32 ? normalized : `${normalized.slice(0, 31)}…`
}

function compositeEvidence(group: AppliedComposite[]): string | null {
  for (const value of group) {
    for (const child of value.entry.children ?? []) {
      if (child.kind !== 'control') continue
      const evidence = child.source.sampleText?.value ??
        child.source.supportingText?.value
      if (evidence) return compactSafeEvidence(evidence)
    }
  }
  return null
}

function compositeSafeArea(
  padding: AppliedComposite['entry']['source']['geometry']['padding']
): string {
  const values = [padding.top, padding.right, padding.bottom, padding.left]
  if (values.every(value => value === values[0])) return `安全区 ${values[0]}px`
  return `安全区 ${values.join('/')}px（上/右/下/左）`
}

function contrastingAnnotationPaint(paint: SolidPaint | null): SolidPaint {
  if (!paint) return MUTED
  const { r, g, b } = paint.color
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance < 0.45 ? WHITE : MUTED
}

export async function buildControlBoard(
  appliedValues: AppliedControl[],
  availableFonts: AvailableFontName[],
  origin: string,
  rawTokenCount = appliedValues.length,
  appliedComposites: AppliedComposite[] = []
): Promise<FrameNode> {
  const fonts = resolveAnnotationFonts(
    availableFonts,
    'Figma 中没有可用字体，无法生成 Interactive Controls 画板。'
  )
  await Promise.all([fonts.regular, fonts.semibold].map(font => figma.loadFontAsync(font)))
  const existing = findOwnedBoard(origin)
  const board = existing ?? figma.createFrame()
  if (!existing) placeNewBoard(board)
  for (const child of [...board.children]) child.remove()

  const atomicGroups = atomicCatalogGroups(
    appliedValues,
    observedPreviewWidths(appliedComposites)
  )
  const compositeGroups = compositeCatalogGroups(appliedComposites)
  const preparedAtomic = await Promise.all(atomicGroups.map(
    async (group): Promise<PreparedCatalogItem> => {
      const source = group.primary.entry.source
      const previewContentWidth = group.previews.reduce((sum, preview) =>
        sum + (preview.placementWidth ?? preview.applied.component.width), 0
      ) + Math.max(0, group.previews.length - 1) * 16
      const observedPreviewHeight = Math.max(
        ...group.previews.map(preview => preview.applied.component.height)
      )
      const width = Math.max(
        atomicSpecimenWidth(previewContentWidth),
        previewContentWidth + CONTROL_BOARD_SPEC.specimenPadding * 2 + 32
      )
      let previewHeight = Math.max(
        atomicPreviewHeight(observedPreviewHeight),
        observedPreviewHeight + CONTROL_BOARD_SPEC.previewVerticalPadding * 2
      )
      const displayName = [
        controlFamilyHeading(source.family),
        localizeControlIntent(source.intent),
        localizeControlSurface(controlPresentationSurface(source))
      ].join(' · ')
      const assetName = await createText(
        displayName,
        fonts.semibold,
        CONTROL_BOARD_SPEC.assetNameFontSize,
        CONTROL_BOARD_SPEC.assetNameLineHeight,
        BLACK
      )
      assetName.name = 'Asset name'
      wrapText(assetName, width - CONTROL_BOARD_SPEC.specimenPadding * 2)
      const caption = await createText(
        [
          localizeControlSize(controlPresentationSize(source.geometry.height)),
          localizeControlForeground(
            controlPresentationForeground(source.appearance.foreground)
          ),
          localizeControlContent(controlContentKind(source))
        ].join(' · '),
        fonts.regular,
        CONTROL_BOARD_SPEC.stateFontSize,
        CONTROL_BOARD_SPEC.stateLineHeight,
        BLACK
      )
      caption.name = 'Component'
      wrapText(caption, width - CONTROL_BOARD_SPEC.specimenPadding * 2)

      const visibilityNote = controlPreviewNote(
        source,
        Boolean(group.primary.entry.fontName)
      )
      const previewOnlyHint = boardOnlyInputHint(source)
      const previewAnnotation = !group.primary.entry.fontName && visibilityNote
        ? await createText(
            visibilityNote,
            fonts.regular,
            11,
            16,
            controlNeedsDarkPreview(source) ? WHITE : MUTED
          )
        : null
      if (previewAnnotation) {
        previewAnnotation.name = 'Missing font annotation'
        wrapText(
          previewAnnotation,
          width - CONTROL_BOARD_SPEC.specimenPadding * 2 - 16
        )
        previewHeight += previewAnnotation.height + 8
      }
      const states = [...new Set(group.previews.map(preview =>
        preview.source.state
      ))]
      const modern = Boolean(source.templateId && source.instanceId)
      const detail = await createText(
        modern
          ? [
              `状态：${states.map(localizeControlState).join(' / ')}`,
              `${group.previews.length} 个内容实例`,
              `${source.geometry.height}px`,
              previewOnlyHint ? '检视占位，非源网页文案' : null,
              visibilityNote
            ].filter(Boolean).join(' · ')
          : [
              localizeControlState(source.state),
              `${source.geometry.height}px`,
              previewOnlyHint ? '检视占位，非源网页文案' : null,
              visibilityNote
            ].filter(Boolean).join(' · '),
        fonts.regular,
        CONTROL_BOARD_SPEC.stateFontSize,
        CONTROL_BOARD_SPEC.stateLineHeight,
        MUTED
      )
      detail.name = 'State and size'
      wrapText(detail, width - CONTROL_BOARD_SPEC.specimenPadding * 2)
      const height =
        CONTROL_BOARD_SPEC.specimenPadding +
        assetName.height +
        CONTROL_BOARD_SPEC.assetNameGap +
        previewHeight +
        CONTROL_BOARD_SPEC.specimenCaptionGap +
        caption.height +
        detail.height +
        CONTROL_BOARD_SPEC.specimenPadding
      return {
        id: `atomic:${group.primary.group.groupId}`,
        family: source.family,
        state: source.state,
        width,
        height,
        previewHeight,
        previewPaint: controlPreviewSurfacePaint(
          group.values.map(value => value.entry.source)
        ),
        displayName,
        assetName,
        caption,
        detail,
        previewAnnotation,
        previewStateLabels: false,
        previews: group.previews.map((preview, index) => ({
          component: preview.applied.component as InstantiableComponent,
          source: preview.source,
          name: `${controlFamilyHeading(preview.source.family)} ${index + 1}`,
          stateLabel: null,
          placementWidth: preview.placementWidth
        }))
      }
    }
  ))
  const preparedComposites = await Promise.all(compositeGroups.map(
    async (group): Promise<PreparedCatalogItem> => {
      const source = group[0]!.entry.source
      const previewContentWidth = group.reduce((sum, value) =>
        sum + value.component.width, 0
      ) + Math.max(0, group.length - 1) * 16
      const width = Math.max(
        CONTROL_BOARD_SPEC.specimenMinWidth,
        previewContentWidth + CONTROL_BOARD_SPEC.specimenPadding * 2 + 32
      )
      const previewStateLabels = new Set(group.map(value =>
        value.entry.source.state
      )).size > 1
      const previewHeight = Math.max(
        CONTROL_BOARD_SPEC.previewMinHeight,
        ...group.map(value =>
          value.component.height + CONTROL_BOARD_SPEC.previewVerticalPadding * 2 +
            (previewStateLabels ? 20 : 0)
        )
      )
      const evidence = compositeEvidence(group)
      const displayName = [
        '复合组件',
        localizeCompositeKind(source.kind),
        evidence
      ].filter(Boolean).join(' · ')
      const assetName = await createText(
        displayName,
        fonts.semibold,
        CONTROL_BOARD_SPEC.assetNameFontSize,
        CONTROL_BOARD_SPEC.assetNameLineHeight,
        BLACK
      )
      assetName.name = 'Asset name'
      wrapText(assetName, width - CONTROL_BOARD_SPEC.specimenPadding * 2)
      const caption = await createText(
        [
          localizeCompositeDirection(source.layout.direction),
          localizeWidthBehavior(source.layout.widthBehavior),
          `${source.children.length} 个子项`,
          `间距 ${source.geometry.gap}px`,
          compositeSafeArea(source.geometry.padding)
        ].join(' · '),
        fonts.regular,
        CONTROL_BOARD_SPEC.stateFontSize,
        CONTROL_BOARD_SPEC.stateLineHeight,
        BLACK
      )
      caption.name = 'Component'
      wrapText(caption, width - CONTROL_BOARD_SPEC.specimenPadding * 2)
      const detail = await createText(
        `状态：${group.map(value =>
          localizeCompositeState(value.entry.source.state)
        ).join(' / ')} · ${source.geometry.width}×${source.geometry.height}px`,
        fonts.regular,
        CONTROL_BOARD_SPEC.stateFontSize,
        CONTROL_BOARD_SPEC.stateLineHeight,
        MUTED
      )
      detail.name = 'State and size'
      wrapText(detail, width - CONTROL_BOARD_SPEC.specimenPadding * 2)
      const controlTokens = group.flatMap(value =>
        (value.entry.children ?? []).flatMap(child =>
          child.kind === 'control' ? [child.source] : []
        )
      )
      const height =
        CONTROL_BOARD_SPEC.specimenPadding +
        assetName.height +
        CONTROL_BOARD_SPEC.assetNameGap +
        previewHeight +
        CONTROL_BOARD_SPEC.specimenCaptionGap +
        caption.height +
        detail.height +
        CONTROL_BOARD_SPEC.specimenPadding
      return {
        id: `composite:${group[0]!.group.groupId}`,
        family: 'composites',
        state: source.state,
        width,
        height,
        previewHeight,
        previewPaint: controlPreviewSurfacePaint(controlTokens),
        displayName,
        assetName,
        caption,
        detail,
        previewAnnotation: null,
        previewStateLabels,
        previews: group.map((value, index) => ({
          component: value.component as InstantiableComponent,
          source: null,
          name: `${localizeCompositeKind(value.entry.source.kind)} ${index + 1}`,
          stateLabel: previewStateLabels
            ? localizeCompositeState(value.entry.source.state)
            : null
        }))
      }
    }
  ))
  const prepared = [...preparedComposites, ...preparedAtomic]
  const layout = layoutControlBoard(prepared.map(item => ({
    id: item.id,
    family: item.family,
    state: item.state,
    width: item.width,
    height: item.height
  })))
  const preparedById = new Map(prepared.map(item => [item.id, item]))

  board.name = 'UI-Anatomist / Interactive Controls'
  writeControlOwnership(board, CONTROL_BOARD_OWNERSHIP_KEY, origin)
  board.layoutMode = 'NONE'
  board.resize(layout.boardWidth, layout.boardHeight)
  board.cornerRadius = CONTROL_BOARD_SPEC.cornerRadius
  board.fills = [WHITE]
  board.clipsContent = false

  const boardTitle = await createText(
    'Interactive Controls',
    fonts.semibold,
    CONTROL_BOARD_SPEC.titleFontSize,
    CONTROL_BOARD_SPEC.titleLineHeight,
    BLACK
  )
  boardTitle.name = 'Title'
  boardTitle.x = CONTROL_BOARD_SPEC.padding
  boardTitle.y = CONTROL_BOARD_SPEC.padding
  board.appendChild(boardTitle)

  const summary = await createText(
    `${rawTokenCount} 个原始控件 · ${compositeGroups.length} 个复合组件 · ` +
      `${atomicGroups.length} 个原子模板 · 真实状态与矢量已保留 · ` +
      '匿名结构仅保留于复合组件和技术母版',
    fonts.regular,
    11,
    16,
    MUTED
  )
  summary.name = 'Summary'
  summary.x = CONTROL_BOARD_SPEC.padding
  summary.y = 75
  wrapText(summary, layout.boardWidth - CONTROL_BOARD_SPEC.padding * 2)
  board.appendChild(summary)

  if (prepared.length === 0) {
    const empty = await createText(
      'No confirmed interactive controls found',
      fonts.regular,
      12,
      16,
      MUTED
    )
    empty.name = 'Empty state'
    empty.x = CONTROL_BOARD_SPEC.padding
    empty.y = CONTROL_BOARD_SPEC.contentStartY
    board.appendChild(empty)
  }

  const sectionByFamily = new Map<ControlCatalogSection, FrameNode>()
  for (const sectionLayout of layout.sections) {
    const section = figma.createFrame()
    const sectionName = sectionLayout.family === 'composites'
      ? 'Composite components'
      : controlFamilyHeading(sectionLayout.family)
    section.name = `${sectionName} (${sectionLayout.count})`
    section.layoutMode = 'NONE'
    section.resize(layout.boardWidth, sectionLayout.height)
    section.x = 0
    section.y = sectionLayout.y
    section.fills = []
    section.clipsContent = false
    board.appendChild(section)
    sectionByFamily.set(sectionLayout.family, section)

    const heading = await createText(
      `${sectionLayout.family === 'composites'
        ? '复合组件'
        : controlFamilyHeading(sectionLayout.family)} (${sectionLayout.count})`,
      fonts.semibold,
      CONTROL_BOARD_SPEC.familyFontSize,
      CONTROL_BOARD_SPEC.familyLineHeight,
      BLACK
    )
    heading.name = 'Family'
    heading.x = CONTROL_BOARD_SPEC.padding
    heading.y = 0
    section.appendChild(heading)

    const separator = figma.createFrame()
    separator.name = 'Separator'
    separator.layoutMode = 'NONE'
    separator.resize(
      layout.boardWidth - CONTROL_BOARD_SPEC.padding * 2,
      1
    )
    separator.x = CONTROL_BOARD_SPEC.padding
    separator.y = CONTROL_BOARD_SPEC.sectionHeaderHeight + 7
    separator.fills = [SEPARATOR]
    section.appendChild(separator)
  }

  for (const itemLayout of layout.items) {
    const preparedItem = preparedById.get(itemLayout.id)
    const section = sectionByFamily.get(itemLayout.family)
    if (!preparedItem || !section) continue
    const { assetName, caption, detail, previewAnnotation, previewHeight } =
      preparedItem
    const card = figma.createFrame()
    card.name = `Specimen / ${preparedItem.displayName}`
    card.layoutMode = 'NONE'
    card.resize(itemLayout.width, itemLayout.height)
    card.x = itemLayout.x
    card.y = itemLayout.y - section.y
    card.cornerRadius = 8
    card.fills = [WHITE]
    card.strokes = [SPECIMEN_BORDER]
    card.strokeWeight = 1
    card.clipsContent = false
    section.appendChild(card)

    assetName.x = CONTROL_BOARD_SPEC.specimenPadding
    assetName.y = CONTROL_BOARD_SPEC.specimenPadding
    card.appendChild(assetName)

    const preview = figma.createFrame()
    preview.name = 'Preview surface'
    preview.layoutMode = 'NONE'
    preview.resize(
      itemLayout.width - CONTROL_BOARD_SPEC.specimenPadding * 2,
      previewHeight
    )
    preview.x = CONTROL_BOARD_SPEC.specimenPadding
    preview.y = assetName.y + assetName.height + CONTROL_BOARD_SPEC.assetNameGap
    preview.fills = preparedItem.previewPaint ? [preparedItem.previewPaint] : []
    preview.strokes = []
    preview.cornerRadius = 8
    preview.clipsContent = false
    card.appendChild(preview)

    const previewInstances: InstanceNode[] = []
    for (const previewItem of preparedItem.previews) {
      if (typeof previewItem.component.createInstance !== 'function') {
        throw new Error(`无法创建组件实例：${preparedItem.displayName}`)
      }
      const instance = previewItem.component.createInstance()
      instance.name = previewItem.name
      if (previewItem.placementWidth !== undefined) {
        instance.resize(previewItem.placementWidth, instance.height)
      }
      if (previewItem.source) {
        await applySafeContentOverride(instance, previewItem.source)
      }
      previewInstances.push(instance)
    }
    const instancesWidth = previewInstances.reduce((sum, instance) =>
      sum + instance.width, 0
    ) + Math.max(0, previewInstances.length - 1) * 16
    let instanceX = (preview.width - instancesWidth) / 2
    const maxInstanceHeight = Math.max(0, ...previewInstances.map(instance =>
      instance.height
    ))
    const stateLabelReserve = preparedItem.previewStateLabels ? 20 : 0
    const annotationReserve = previewAnnotation
      ? previewAnnotation.height + 8
      : 0
    const contentTop = annotationReserve + (
      preview.height - annotationReserve - maxInstanceHeight - stateLabelReserve
    ) / 2
    for (let index = 0; index < previewInstances.length; index += 1) {
      const instance = previewInstances[index]!
      const previewItem = preparedItem.previews[index]!
      instance.x = instanceX
      instance.y = contentTop + stateLabelReserve +
        (maxInstanceHeight - instance.height) / 2
      preview.appendChild(instance)
      const inputHint = previewItem.source
        ? boardOnlyInputHint(previewItem.source)
        : null
      if (inputHint && previewItem.source) {
        const hint = await createText(
          inputHint,
          fonts.regular,
          11,
          16,
          MUTED
        )
        hint.name = 'Preview-only input hint'
        hint.x = instance.x + Math.max(
          8,
          previewItem.source.geometry.padding.left
        )
        hint.y = previewItem.source.family === 'textarea'
          ? instance.y + Math.max(8, previewItem.source.geometry.padding.top)
          : instance.y + Math.max(0, (instance.height - hint.height) / 2)
        preview.appendChild(hint)
      }
      if (previewItem.stateLabel) {
        const stateLabel = await createText(
          previewItem.stateLabel,
          fonts.regular,
          11,
          16,
          contrastingAnnotationPaint(preparedItem.previewPaint)
        )
        stateLabel.name = 'Preview state'
        stateLabel.x = instanceX
        stateLabel.y = Math.max(4, contentTop)
        preview.appendChild(stateLabel)
      }
      instanceX += instance.width + 16
    }
    if (previewAnnotation) {
      previewAnnotation.x = 8
      previewAnnotation.y = Math.max(
        4,
        contentTop - previewAnnotation.height - 8
      )
      preview.appendChild(previewAnnotation)
    }

    caption.x = CONTROL_BOARD_SPEC.specimenPadding
    caption.y = preview.y + preview.height + CONTROL_BOARD_SPEC.specimenCaptionGap
    card.appendChild(caption)

    detail.x = CONTROL_BOARD_SPEC.specimenPadding
    detail.y = caption.y + caption.height
    card.appendChild(detail)
  }

  figma.currentPage.selection = [board]
  figma.viewport.scrollAndZoomIntoView([board])
  return board
}
