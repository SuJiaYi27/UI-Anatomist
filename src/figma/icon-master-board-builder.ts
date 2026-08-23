import type { AvailableFontName } from './font-resolver'
import { resolveAnnotationFonts } from './annotation-font-resolver'
import type { AppliedIcon } from './icon-component-applier'
import {
  readIconOwnership,
  writeIconOwnership
} from './icon-component-applier'
import {
  ICON_MASTER_BOARD_SPEC,
  layoutIconMasterBoard
} from './icon-master-board-spec'
import { iconIdentityPreviewComponent } from './icon-identity-preview'

export const ICON_MASTER_BOARD_OWNERSHIP_KEY =
  'smartScanIconMasterBoardOrigin'
export const ICON_MASTER_SOURCE_ASSETS_OWNERSHIP_KEY =
  'smartScanIconMasterSourceAssetsOrigin'

const BLACK: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.05, g: 0.05, b: 0.05 }
}
const MUTED: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.42, g: 0.42, b: 0.42 }
}
const BOARD_FILL: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.95, g: 0.95, b: 0.95 }
}
const CARD_FILL: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.985, g: 0.985, b: 0.985 }
}
const CARD_STROKE: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.88, g: 0.88, b: 0.88 }
}

function title(value: string): string {
  return value
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function findBoard(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readIconOwnership(node, ICON_MASTER_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
}

function findSourceAssets(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readIconOwnership(node, ICON_MASTER_SOURCE_ASSETS_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
}

function sourceAssetsContainer(origin: string): FrameNode {
  const container = findSourceAssets(origin) ?? figma.createFrame()
  container.name = 'UI-Anatomist internal icon assets'
  writeIconOwnership(container, ICON_MASTER_SOURCE_ASSETS_OWNERSHIP_KEY, origin)
  container.layoutMode = 'NONE'
  container.fills = []
  container.strokes = []
  container.clipsContent = false
  container.visible = false
  figma.currentPage.appendChild(container)
  return container
}

export function removeOwnedIconMasterBoard(origin: string): boolean {
  const board = findBoard(origin)
  if (!board) return false
  board.remove()
  return true
}

async function text(
  characters: string,
  fontName: AvailableFontName,
  fontSize: number,
  fill: SolidPaint,
  wrapWidth?: number
): Promise<TextNode> {
  const node = figma.createText()
  node.fontName = fontName
  node.fontSize = fontSize
  node.lineHeight = { unit: 'PIXELS', value: fontSize + 4 }
  if (wrapWidth !== undefined) {
    node.textAutoResize = 'HEIGHT'
    node.resize(wrapWidth, fontSize + 4)
  } else {
    node.textAutoResize = 'WIDTH_AND_HEIGHT'
  }
  node.characters = characters
  node.fills = [fill]
  return node
}

export async function buildIconMasterBoard(
  applied: AppliedIcon[],
  availableFonts: AvailableFontName[],
  origin: string
): Promise<FrameNode | null> {
  if (applied.length === 0) {
    removeOwnedIconMasterBoard(origin)
    return null
  }

  const fonts = resolveAnnotationFonts(
    availableFonts,
    'Figma 中没有可用字体，无法生成 Icon Masters 画板。'
  )
  await Promise.all([
    figma.loadFontAsync(fonts.regular),
    figma.loadFontAsync(fonts.semibold)
  ])

  const sorted = [...applied].sort((left, right) =>
    left.entry.source.category.localeCompare(right.entry.source.category) ||
    left.entry.source.name.localeCompare(right.entry.source.name) ||
    left.entry.source.id.localeCompare(right.entry.source.id)
  )
  const labels = new Map<string, TextNode>()
  await Promise.all(sorted.map(async item => {
    const label = await text(
      item.entry.source.name,
      fonts.regular,
      11,
      BLACK,
      ICON_MASTER_BOARD_SPEC.cardWidth - 16
    )
    label.textAlignHorizontal = 'CENTER'
    labels.set(item.entry.source.id, label)
  }))
  const layout = layoutIconMasterBoard(sorted.map(item => ({
    id: item.entry.source.id,
    category: item.entry.source.category,
    labelHeight: labels.get(item.entry.source.id)?.height ?? 15
  })))

  const existing = findBoard(origin)
  const board = existing ?? figma.createFrame()

  // Preserve the reusable Components and Component Sets before clearing a
  // previous board.
  // Moving them to the page detaches them from old specimen cards without
  // recreating assets or breaking existing Instances.
  for (const item of sorted) {
    figma.currentPage.appendChild(
      item.asset as unknown as SceneNode
    )
  }
  for (const child of [...board.children]) child.remove()
  const sourceAssets = sourceAssetsContainer(origin)
  for (const item of sorted) {
    sourceAssets.appendChild(item.asset as unknown as SceneNode)
  }

  board.name = 'UI-Anatomist / Icon Masters'
  writeIconOwnership(board, ICON_MASTER_BOARD_OWNERSHIP_KEY, origin)
  board.layoutMode = 'NONE'
  board.resize(layout.width, layout.height)
  board.cornerRadius = 8
  board.fills = [BOARD_FILL]
  board.clipsContent = false

  const heading = await text('Icon Masters', fonts.semibold, 20, BLACK)
  heading.name = 'Title'
  heading.x = ICON_MASTER_BOARD_SPEC.padding
  heading.y = 32
  board.appendChild(heading)

  const componentCount = sorted.filter(item =>
    item.asset.type === 'COMPONENT'
  ).length
  const componentSetCount = sorted.length - componentCount
  const summary = await text(
    `${sorted.length} reusable assets · ${componentCount} components · ` +
      `${componentSetCount} observed-state sets · original SVG`,
    fonts.regular,
    11,
    MUTED,
    ICON_MASTER_BOARD_SPEC.width - ICON_MASTER_BOARD_SPEC.padding * 2
  )
  summary.name = 'Summary'
  summary.x = ICON_MASTER_BOARD_SPEC.padding
  summary.y = 66
  board.appendChild(summary)

  for (const category of layout.categories) {
    const heading = await text(
      title(category.category),
      fonts.semibold,
      12,
      MUTED
    )
    heading.name = `${title(category.category)} heading`
    heading.x = ICON_MASTER_BOARD_SPEC.padding
    heading.y = category.y
    board.appendChild(heading)
  }

  const byId = new Map(sorted.map(item => [item.entry.source.id, item]))
  for (const cardLayout of layout.cards) {
    const item = byId.get(cardLayout.id)
    if (!item) continue
    const card = figma.createFrame()
    card.name = `Master specimen / ${item.entry.source.name}`
    card.layoutMode = 'NONE'
    card.x = cardLayout.x
    card.y = cardLayout.y
    card.resize(cardLayout.width, cardLayout.height)
    card.cornerRadius = 8
    card.fills = [CARD_FILL]
    card.strokes = [CARD_STROKE]
    card.strokeWeight = 1
    card.clipsContent = false
    board.appendChild(card)

    const preview = iconIdentityPreviewComponent(item).createInstance()
    preview.name = `${item.entry.source.name} identity preview`
    preview.x = (cardLayout.width - preview.width) / 2
    preview.y = ICON_MASTER_BOARD_SPEC.previewY
    card.appendChild(preview)

    const label = labels.get(item.entry.source.id) ?? await text(
      item.entry.source.name,
      fonts.regular,
      11,
      BLACK,
      cardLayout.width - 16
    )
    label.name = 'Component name'
    label.x = 8
    label.y = ICON_MASTER_BOARD_SPEC.labelY
    label.textAlignHorizontal = 'CENTER'
    card.appendChild(label)
  }

  return board
}
