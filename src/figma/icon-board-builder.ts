import {
  readIconOwnership,
  writeIconOwnership,
  type AppliedIcon
} from './icon-component-applier'
import {
  ICON_BOARD_SPEC,
  iconCardWidth,
  layoutIconBoard
} from './icon-board-spec'
import type { AvailableFontName } from './font-resolver'
import { resolveAnnotationFonts } from './annotation-font-resolver'
import { iconIdentityPreviewComponent } from './icon-identity-preview'

export const ICON_BOARD_OWNERSHIP_KEY = 'smartScanIconBoardOrigin'

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
const DARK: SolidPaint = { type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }
const MUTED_LIGHT: SolidPaint = { type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }
const MUTED_DARK: SolidPaint = { type: 'SOLID', color: { r: 0.68, g: 0.68, b: 0.68 } }
const CARD_LIGHT: SolidPaint = { type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.98 } }
const CARD_DARK: SolidPaint = { type: 'SOLID', color: { r: 0.11, g: 0.11, b: 0.11 } }

function title(value: string): string {
  return value.split('-').map(part =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(' ')
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
    node.textAlignHorizontal = 'CENTER'
  } else {
    node.textAutoResize = 'WIDTH_AND_HEIGHT'
  }
  node.characters = characters
  node.fills = [fill]
  return node
}

function findBoard(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readIconOwnership(node, ICON_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
}

export function removeOwnedIconBoard(origin: string): boolean {
  const board = findBoard(origin)
  if (!board) return false
  board.remove()
  return true
}

function place(board: FrameNode): void {
  const boards = figma.currentPage.children.filter(node =>
    node.type === 'FRAME' && node.name.startsWith('UI-Anatomist /')
  ) as FrameNode[]
  board.x = boards.length ? Math.min(...boards.map(node => node.x)) : 100
  board.y = boards.length
    ? Math.max(...boards.map(node => node.y + node.height)) + 80
    : 100
}

function previewFootprint(item: AppliedIcon): { width: number; height: number } {
  // The board lays out the same full component that it previews. Measure a
  // detached instance rather than inferring its footprint from an icon name
  // or a glyph's nominal size.
  const instance = iconIdentityPreviewComponent(item).createInstance()
  const footprint = {
    width: Math.max(1, instance.width),
    height: Math.max(1, instance.height)
  }
  instance.remove()
  return footprint
}

export function setIconBoardThemeMode(
  frame: FrameNode,
  collection: VariableCollection,
  modeId: string
): void {
  frame.setExplicitVariableModeForCollection(collection, modeId)
}

export async function buildIconBoard(
  applied: AppliedIcon[],
  availableFonts: AvailableFontName[],
  origin: string,
  variableModes?: {
    collection: VariableCollection
    light?: string
    dark?: string
  }
): Promise<FrameNode | null> {
  if (applied.length === 0) {
    removeOwnedIconBoard(origin)
    return null
  }
  const { regular, semibold } = resolveAnnotationFonts(
    availableFonts,
    'Figma 中没有可用字体，无法生成 Icons 画板。'
  )
  await Promise.all([regular, semibold].map(font => figma.loadFontAsync(font)))
  const footprints = new Map(applied.map(item => [
    item.entry.source.id,
    previewFootprint(item)
  ]))
  const labelNodes = new Map<string, TextNode>()
  await Promise.all(applied.flatMap(item =>
    (['light', 'dark'] as const).map(async theme => {
      const footprint = footprints.get(item.entry.source.id)!
      const label = await text(
        item.entry.source.name,
        regular,
        11,
        theme === 'dark' ? WHITE : BLACK,
        iconCardWidth({
          id: item.entry.source.id,
          category: item.entry.source.category,
          footprint
        }) - ICON_BOARD_SPEC.labelInset * 2
      )
      labelNodes.set(`${theme}:${item.entry.source.id}`, label)
    })
  ))
  const layout = layoutIconBoard(applied.map(item => ({
    id: item.entry.source.id,
    category: item.entry.source.category,
    footprint: footprints.get(item.entry.source.id),
    labelHeight: Math.max(
      labelNodes.get(`light:${item.entry.source.id}`)?.height ?? 15,
      labelNodes.get(`dark:${item.entry.source.id}`)?.height ?? 15
    )
  })))
  const existing = findBoard(origin)
  const board = existing ?? figma.createFrame()
  if (!existing) place(board)
  for (const child of [...board.children]) child.remove()
  board.name = 'UI-Anatomist / Icons'
  writeIconOwnership(board, ICON_BOARD_OWNERSHIP_KEY, origin)
  board.layoutMode = 'NONE'
  board.resize(ICON_BOARD_SPEC.width, layout.boardHeight)
  board.cornerRadius = ICON_BOARD_SPEC.cornerRadius
  board.fills = [WHITE]
  board.clipsContent = false

  const heading = await text('Icon Library', semibold, 24, BLACK)
  heading.x = ICON_BOARD_SPEC.padding
  heading.y = ICON_BOARD_SPEC.padding
  board.appendChild(heading)
  const byId = new Map(applied.map(item => [item.entry.source.id, item]))
  for (const themeLayout of layout.themes) {
    const isDark = themeLayout.theme === 'dark'
    const themeFrame = figma.createFrame()
    themeFrame.name = title(themeLayout.theme)
    themeFrame.layoutMode = 'NONE'
    themeFrame.x = 0
    themeFrame.y = themeLayout.y
    themeFrame.resize(ICON_BOARD_SPEC.width, themeLayout.height)
    themeFrame.fills = [isDark ? DARK : WHITE]
    themeFrame.clipsContent = false
    themeFrame.constraints = {
      horizontal: 'STRETCH',
      vertical: isDark ? 'STRETCH' : 'MIN'
    }
    const modeId = variableModes?.[themeLayout.theme]
    if (variableModes?.collection && modeId) {
      setIconBoardThemeMode(themeFrame, variableModes.collection, modeId)
    }
    board.appendChild(themeFrame)
    const themeHeading = await text(
      title(themeLayout.theme),
      semibold,
      18,
      isDark ? WHITE : BLACK
    )
    themeHeading.x = ICON_BOARD_SPEC.padding
    themeHeading.y = 8
    themeFrame.appendChild(themeHeading)
    for (const categoryLayout of themeLayout.categories) {
      const label = await text(
        title(categoryLayout.category),
        semibold,
        12,
        isDark ? MUTED_DARK : MUTED_LIGHT
      )
      label.x = ICON_BOARD_SPEC.padding
      label.y = categoryLayout.y - themeLayout.y
      themeFrame.appendChild(label)
    }
    for (const cardLayout of themeLayout.cards) {
      const item = byId.get(cardLayout.id)
      if (!item) continue
      const card = figma.createFrame()
      card.name = `${item.entry.source.name} · ${title(themeLayout.theme)}`
      card.layoutMode = 'NONE'
      card.x = cardLayout.x
      card.y = cardLayout.y - themeLayout.y
      card.resize(cardLayout.width, cardLayout.height)
      card.cornerRadius = 8
      card.fills = [isDark ? CARD_DARK : CARD_LIGHT]
      card.strokes = []
      card.clipsContent = false
      themeFrame.appendChild(card)
      const instance = iconIdentityPreviewComponent(item).createInstance()
      instance.name = item.entry.source.name
      instance.x = cardLayout.preview.x +
        (cardLayout.preview.width - instance.width) / 2
      instance.y = cardLayout.preview.y +
        (cardLayout.preview.height - instance.height) / 2
      card.appendChild(instance)
      const name = labelNodes.get(
        `${themeLayout.theme}:${item.entry.source.id}`
      ) ?? await text(
        item.entry.source.name,
        regular,
        11,
        isDark ? WHITE : BLACK,
        cardLayout.label.width
      )
      name.x = cardLayout.label.x
      name.y = cardLayout.label.y
      card.appendChild(name)
      if (item.entry.states.includes('Hover')) {
        const hoverIndicator = figma.createEllipse()
        hoverIndicator.name = 'hover-indicator'
        hoverIndicator.resize(
          ICON_BOARD_SPEC.indicatorSize,
          ICON_BOARD_SPEC.indicatorSize
        )
        hoverIndicator.x = cardLayout.indicator.x
        hoverIndicator.y = cardLayout.indicator.y
        hoverIndicator.fills = [isDark ? MUTED_DARK : MUTED_LIGHT]
        card.appendChild(hoverIndicator)
      }
    }
  }
  return board
}
