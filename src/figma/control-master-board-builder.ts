import type {
  AppliedControl,
  ControlNodePort
} from './control-component-applier'
import type { AppliedComposite } from './composite-component-applier'
import {
  readControlOwnership,
  writeControlOwnership
} from './control-component-applier'
import type { AvailableFontName } from './font-resolver'
import { resolveAnnotationFonts } from './annotation-font-resolver'
import {
  controlContentKind,
  controlPresentationForeground,
  controlPresentationSize,
  controlPresentationSurface
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
  controlPreviewNote,
  controlPreviewSurfacePaint
} from './control-preview-surface'

export const CONTROL_MASTER_BOARD_OWNERSHIP_KEY = 'smartScanControlMasterBoardOrigin'

type PositionableControlNode = ControlNodePort & {
  x: number
  y: number
  width: number
  height: number
  absoluteBoundingBox?: Rect | null
  absoluteRenderBounds?: Rect | null
}

type Rect = {
  x: number
  y: number
  width: number
  height: number
}

type LocalRenderBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type RenderableControlNode = {
  x?: number
  y?: number
  width?: number
  height?: number
  visible?: boolean
  clipsContent?: boolean
  children?: readonly RenderableControlNode[]
  absoluteBoundingBox?: Rect | null
  absoluteRenderBounds?: Rect | null
}

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05 } }
const MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.42, g: 0.42, b: 0.42 } }
const CARD_FILL: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
const CARD_STROKE: SolidPaint = { type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 } }

function findOwnedMasterBoard(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readControlOwnership(node, CONTROL_MASTER_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
}

function uniqueRoots(values: AppliedControl[]): PositionableControlNode[] {
  const roots = new Map<string, PositionableControlNode>()
  for (const value of values) {
    const root = (value.componentSet ?? value.component) as PositionableControlNode
    roots.set(root.id, root)
  }
  return [...roots.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  )
}

function uniqueCompositeRoots(
  values: AppliedComposite[]
): PositionableControlNode[] {
  const roots = new Map<string, PositionableControlNode>()
  for (const value of values) {
    const root = (value.componentSet ?? value.component) as PositionableControlNode
    roots.set(root.id, root)
  }
  return [...roots.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  )
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

function localRenderBounds(root: PositionableControlNode): LocalRenderBounds {
  let left = 0
  let top = 0
  let right = root.width
  let bottom = root.height

  const include = (
    candidateLeft: number,
    candidateTop: number,
    candidateRight: number,
    candidateBottom: number
  ): void => {
    if (![candidateLeft, candidateTop, candidateRight, candidateBottom]
      .every(Number.isFinite)) return
    left = Math.min(left, candidateLeft)
    top = Math.min(top, candidateTop)
    right = Math.max(right, candidateRight)
    bottom = Math.max(bottom, candidateBottom)
  }

  const rootGeometry = root.absoluteBoundingBox
  const visit = (
    node: RenderableControlNode,
    parentLeft: number,
    parentTop: number,
    isRoot = false
  ): void => {
    if (node.visible === false) return
    const nodeLeft = isRoot
      ? 0
      : parentLeft + (Number.isFinite(node.x) ? node.x ?? 0 : 0)
    const nodeTop = isRoot
      ? 0
      : parentTop + (Number.isFinite(node.y) ? node.y ?? 0 : 0)
    const nodeWidth = Number.isFinite(node.width) ? Math.max(0, node.width ?? 0) : 0
    const nodeHeight = Number.isFinite(node.height) ? Math.max(0, node.height ?? 0) : 0
    include(nodeLeft, nodeTop, nodeLeft + nodeWidth, nodeTop + nodeHeight)

    const rendered = node.absoluteRenderBounds
    const geometry = node.absoluteBoundingBox
    if (rendered && rootGeometry) {
      include(
        rendered.x - rootGeometry.x,
        rendered.y - rootGeometry.y,
        rendered.x + rendered.width - rootGeometry.x,
        rendered.y + rendered.height - rootGeometry.y
      )
    } else if (rendered && geometry) {
      include(
        nodeLeft + rendered.x - geometry.x,
        nodeTop + rendered.y - geometry.y,
        nodeLeft + rendered.x + rendered.width - geometry.x,
        nodeTop + rendered.y + rendered.height - geometry.y
      )
    }

    if (node.clipsContent === true) return
    for (const child of node.children ?? []) {
      visit(child, nodeLeft, nodeTop)
    }
  }
  visit(root as unknown as RenderableControlNode, 0, 0, true)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function readableName(
  root: PositionableControlNode,
  values: AppliedControl[]
): string {
  const value = values.find(item =>
    (item.componentSet ?? item.component).id === root.id
  )
  if (!value) return root.name
  const source = value.entry.source
  return [
    controlFamilyHeading(source.family),
    localizeControlIntent(source.intent),
    localizeControlSurface(controlPresentationSurface(source)),
    localizeControlSize(controlPresentationSize(source.geometry.height)),
    localizeControlForeground(controlPresentationForeground(source.appearance.foreground)),
    localizeControlContent(controlContentKind(source))
  ].join(' · ')
}

function compositeValuesForRoot(
  root: PositionableControlNode,
  values: AppliedComposite[]
): AppliedComposite[] {
  return values.filter(value =>
    (value.componentSet ?? value.component).id === root.id
  )
}

function readableCompositeName(values: AppliedComposite[]): string {
  const source = values[0]?.entry.source
  if (!source) return '复合组件'
  return [
    '复合组件',
    localizeCompositeKind(source.kind),
    localizeCompositeDirection(source.layout.direction),
    localizeWidthBehavior(source.layout.widthBehavior)
  ].join(' · ')
}

function compositeTokens(values: AppliedComposite[]) {
  return values.flatMap(value =>
    (value.entry.children ?? []).flatMap(child =>
      child.kind === 'control' ? [child.source] : []
    )
  )
}

function statesForRoot(
  root: PositionableControlNode,
  values: AppliedControl[]
): AppliedControl['entry']['source']['state'][] {
  return [...new Set(values
    .filter(value => (value.componentSet ?? value.component).id === root.id)
    .map(value => value.entry.source.state)
  )].sort()
}

function tokensForRoot(
  root: PositionableControlNode,
  values: AppliedControl[]
): AppliedControl['entry']['source'][] {
  return values
    .filter(value => (value.componentSet ?? value.component).id === root.id)
    .map(value => value.entry.source)
}

function previewNotesForRoot(
  root: PositionableControlNode,
  values: AppliedControl[]
): string[] {
  return [...new Set(values
    .filter(value => (value.componentSet ?? value.component).id === root.id)
    .map(value => controlPreviewNote(
      value.entry.source,
      Boolean(value.entry.fontName)
    ))
    .filter((value): value is string => Boolean(value))
  )]
}

export async function buildControlMasterBoard(
  applied: AppliedControl[],
  availableFonts: AvailableFontName[],
  origin: string,
  anchor: FrameNode,
  appliedComposites: AppliedComposite[] = []
): Promise<FrameNode> {
  const fonts = resolveAnnotationFonts(
    availableFonts,
    'Figma 中没有可用字体，无法生成 Control Masters 画板。'
  )
  await Promise.all([fonts.regular, fonts.semibold].map(font => figma.loadFontAsync(font)))
  const existing = findOwnedMasterBoard(origin)
  const board = existing ?? figma.createFrame()
  const compositeRoots = uniqueCompositeRoots(appliedComposites)
  const atomicRoots = uniqueRoots(applied)
  const roots = [...compositeRoots, ...atomicRoots]
  const compositeRootIds = new Set(compositeRoots.map(root => root.id))

  for (const root of roots) {
    figma.currentPage.appendChild(root as unknown as SceneNode)
  }
  for (const child of [...board.children]) child.remove()

  board.name = 'UI-Anatomist / Control Masters'
  writeControlOwnership(board, CONTROL_MASTER_BOARD_OWNERSHIP_KEY, origin)
  board.layoutMode = 'NONE'
  board.x = anchor.x + anchor.width + 80
  board.y = anchor.y
  board.cornerRadius = 8
  board.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }]
  board.clipsContent = false

  const padding = 40
  const gap = 16
  const minimumCardWidth = 304
  const preferredColumns = 3
  const preferredBoardWidth =
    padding * 2 +
    preferredColumns * minimumCardWidth +
    (preferredColumns - 1) * gap
  const preferredContentRight = preferredBoardWidth - padding
  const contentStartY = 104

  const title = await createText('Control Masters', fonts.semibold, 20, 28, BLACK)
  title.name = 'Title'
  title.x = padding
  title.y = 32
  board.appendChild(title)

  const summary = await createText(
    `${compositeRoots.length} composite groups · ${atomicRoots.length} atomic groups · ` +
      'components unchanged · no specimen overlays',
    fonts.regular,
    11,
    16,
    MUTED
  )
  summary.name = 'Summary'
  summary.x = padding
  summary.y = 66
  wrapText(summary, preferredBoardWidth - padding * 2)
  board.appendChild(summary)

  let cursorX = padding
  let cursorY = contentStartY
  let rowHeight = 0
  let maximumRight = padding

  for (const root of roots) {
    const isComposite = compositeRootIds.has(root.id)
    const compositeValues = isComposite
      ? compositeValuesForRoot(root, appliedComposites)
      : []
    const states = isComposite
      ? [...new Set(compositeValues.map(value =>
          localizeCompositeState(value.entry.source.state)
        ))]
      : statesForRoot(root, applied).map(localizeControlState)
    const previewNotes = isComposite
      ? []
      : previewNotesForRoot(root, applied)
    const renderBounds = localRenderBounds(root)
    const cardWidth = Math.max(
      minimumCardWidth,
      renderBounds.width + 16 + 32
    )
    const previewHeight = Math.max(72, renderBounds.height + 24)
    const label = await createText(
      isComposite
        ? readableCompositeName(compositeValues)
        : readableName(root, applied),
      fonts.semibold,
      10,
      14,
      BLACK
    )
    label.name = 'Component name'
    wrapText(label, cardWidth - 32)

    const stateSummary = await createText(
      `状态：${states.length > 0
        ? states.join(' / ')
        : localizeControlState('default')}` +
        (previewNotes.length > 0 ? ` · ${previewNotes.join(' / ')}` : ''),
      fonts.regular,
      10,
      14,
      MUTED
    )
    stateSummary.name = 'State summary'
    wrapText(stateSummary, cardWidth - 32)

    const labelY = 14
    const stateY = labelY + label.height + 4
    const previewY = stateY + stateSummary.height + 8
    const cardHeight = previewY + previewHeight + 16
    if (
      cursorX > padding &&
      cursorX + cardWidth > preferredContentRight
    ) {
      cursorX = padding
      cursorY += rowHeight + gap
      rowHeight = 0
    }

    const card = figma.createFrame()
    card.name = `Master specimen / ${isComposite ? 'Composite' : root.name}`
    card.layoutMode = 'NONE'
    card.resize(cardWidth, cardHeight)
    card.x = cursorX
    card.y = cursorY
    card.cornerRadius = 10
    card.fills = [CARD_FILL]
    card.strokes = [CARD_STROKE]
    card.strokeWeight = 1
    card.clipsContent = false
    board.appendChild(card)

    label.x = 16
    label.y = labelY
    card.appendChild(label)

    stateSummary.x = 16
    stateSummary.y = stateY
    card.appendChild(stateSummary)

    const preview = figma.createFrame()
    preview.name = 'Preview surface'
    preview.layoutMode = 'NONE'
    preview.resize(cardWidth - 32, previewHeight)
    preview.x = 16
    preview.y = previewY
    preview.cornerRadius = 8
    const previewPaint = controlPreviewSurfacePaint(
      isComposite
        ? compositeTokens(compositeValues)
        : tokensForRoot(root, applied)
    )
    preview.fills = previewPaint ? [previewPaint] : []
    preview.strokes = [CARD_STROKE]
    preview.strokeWeight = 1
    preview.clipsContent = false
    card.appendChild(preview)

    const rootX = (preview.width - renderBounds.width) / 2 -
      renderBounds.left
    const rootY = (preview.height - renderBounds.height) / 2 -
      renderBounds.top
    preview.appendChild(root as unknown as SceneNode)
    root.x = rootX
    root.y = rootY
    cursorX += cardWidth + gap
    rowHeight = Math.max(rowHeight, cardHeight)
    maximumRight = Math.max(maximumRight, card.x + card.width)
  }

  board.resize(
    Math.max(preferredBoardWidth, maximumRight + padding),
    Math.max(180, cursorY + rowHeight + padding)
  )
  return board
}
