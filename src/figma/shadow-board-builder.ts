import type { ShadowToken } from '../shared/schema'
import type { AvailableFontName } from './font-resolver'
import { resolveFont } from './font-resolver'
import {
  SHADOW_SHARED_NAMESPACE,
  type AppliedShadow
} from './shadow-style-applier'
import { readOwnership, writeOwnership } from './ownership'
import {
  SHADOW_BOARD_SPEC,
  layoutShadowCells,
  shadowSpecimenFill,
  shadowTokenLabel
} from './shadow-board-spec'

export const SHADOW_BOARD_OWNERSHIP_KEY = 'smartScanShadowBoardOrigin'

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }
const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }

function labelFonts(available: AvailableFontName[]): {
  regular: AvailableFontName
  semibold: AvailableFontName
} {
  if (available.length === 0) throw new Error('Figma 中没有可用字体，无法生成阴影画板。')
  const regular = resolveFont(['Inter'], 400, 'normal', available)
    ?? available.find(font => /regular|book|normal/i.test(font.style))
    ?? available[0]
  const semibold = resolveFont([regular.family], 600, 'normal', available) ?? regular
  return { regular, semibold }
}

function uniqueFonts(fonts: AvailableFontName[]): AvailableFontName[] {
  const seen = new Set<string>()
  return fonts.filter(font => {
    const key = `${font.family}\u0000${font.style}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

function findOwnedBoard(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, SHADOW_SHARED_NAMESPACE, SHADOW_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
}

function placeNewBoard(board: FrameNode): void {
  const foundations = figma.currentPage.children.filter(node =>
    node.type === 'FRAME' && /^UI-Anatomist \/ (Typography|字体|Border Radii|Shadows|阴影)$/.test(node.name)
  ) as FrameNode[]
  if (foundations.length === 0) {
    board.x = 100
    board.y = 100
    return
  }
  board.x = Math.min(...foundations.map(node => node.x))
  board.y = Math.max(...foundations.map(node => node.y + node.height)) + 80
}

type CellNodes = {
  cell: FrameNode
  sample: RectangleNode
  label: TextNode
}

export async function buildShadowBoard(
  tokens: ShadowToken[],
  applied: AppliedShadow[],
  availableFonts: AvailableFontName[],
  origin: string
): Promise<FrameNode> {
  const fonts = labelFonts(availableFonts)
  await Promise.all(uniqueFonts([fonts.regular, fonts.semibold]).map(font => figma.loadFontAsync(font)))

  const existing = findOwnedBoard(origin)
  const board = existing ?? figma.createFrame()
  if (!existing) placeNewBoard(board)
  for (const child of [...board.children]) child.remove()

  board.name = 'UI-Anatomist / 阴影'
  writeOwnership(board, SHADOW_SHARED_NAMESPACE, SHADOW_BOARD_OWNERSHIP_KEY, origin)
  board.layoutMode = 'NONE'
  board.resize(SHADOW_BOARD_SPEC.width, SHADOW_BOARD_SPEC.baselineHeight)
  board.cornerRadius = SHADOW_BOARD_SPEC.cornerRadius
  board.fills = [WHITE]
  board.clipsContent = false

  const title = await createText(
    '阴影',
    fonts.semibold,
    SHADOW_BOARD_SPEC.titleFontSize,
    SHADOW_BOARD_SPEC.titleLineHeight,
    BLACK
  )
  title.name = 'Title'
  title.x = SHADOW_BOARD_SPEC.padding
  title.y = SHADOW_BOARD_SPEC.padding
  board.appendChild(title)

  if (tokens.length === 0) {
    const empty = await createText('未发现可见阴影', fonts.regular, 12, 16, MUTED)
    empty.name = 'Empty state'
    empty.x = SHADOW_BOARD_SPEC.padding
    empty.y = SHADOW_BOARD_SPEC.rowStartY
    board.appendChild(empty)
    figma.currentPage.selection = [board]
    figma.viewport.scrollAndZoomIntoView([board])
    return board
  }

  const styleByTokenId = new Map(applied.map(item => [item.entry.source.id, item.style]))
  const items = figma.createFrame()
  items.name = 'shadows'
  items.layoutMode = 'NONE'
  items.fills = []
  items.clipsContent = false
  items.x = SHADOW_BOARD_SPEC.padding
  items.y = SHADOW_BOARD_SPEC.rowStartY
  items.resize(
    SHADOW_BOARD_SPEC.width - SHADOW_BOARD_SPEC.padding * 2,
    SHADOW_BOARD_SPEC.sampleHeight +
      SHADOW_BOARD_SPEC.labelGap +
      SHADOW_BOARD_SPEC.labelLineHeight
  )
  board.appendChild(items)

  const cells: CellNodes[] = []
  for (const token of tokens) {
    const style = styleByTokenId.get(token.id)
    if (!style) throw new Error(`无法找到阴影样式：${token.name}`)
    const cell = figma.createFrame()
    cell.name = `Shadow / ${token.name}`
    cell.layoutMode = 'NONE'
    cell.fills = []
    cell.clipsContent = false
    items.appendChild(cell)

    const sample = figma.createRectangle()
    sample.name = `Sample / ${token.name}`
    sample.resize(SHADOW_BOARD_SPEC.sampleWidth, SHADOW_BOARD_SPEC.sampleHeight)
    const specimenFill = shadowSpecimenFill(token)
    sample.fills = [{
      type: 'SOLID',
      color: {
        r: specimenFill.r,
        g: specimenFill.g,
        b: specimenFill.b
      },
      opacity: specimenFill.a
    }]
    await sample.setEffectStyleIdAsync(style.id)
    cell.appendChild(sample)

    const label = await createText(
      shadowTokenLabel(token),
      fonts.regular,
      SHADOW_BOARD_SPEC.labelFontSize,
      SHADOW_BOARD_SPEC.labelLineHeight,
      MUTED
    )
    label.name = 'Token name'
    cell.appendChild(label)
    cells.push({ cell, sample, label })
  }

  const layout = layoutShadowCells(cells.map(({ label }) => ({
    labelWidth: label.width,
    labelHeight: label.height
  })))
  board.resize(SHADOW_BOARD_SPEC.width, layout.boardHeight)
  items.resize(
    SHADOW_BOARD_SPEC.width - SHADOW_BOARD_SPEC.padding * 2,
    Math.max(
      SHADOW_BOARD_SPEC.sampleHeight +
        SHADOW_BOARD_SPEC.labelGap +
        SHADOW_BOARD_SPEC.labelLineHeight,
      layout.boardHeight - SHADOW_BOARD_SPEC.rowStartY - SHADOW_BOARD_SPEC.padding
    )
  )

  for (let index = 0; index < cells.length; index += 1) {
    const nodes = cells[index]
    const position = layout.cells[index]
    if (!nodes || !position) continue
    nodes.cell.resize(position.width, position.height)
    nodes.cell.x = position.x - SHADOW_BOARD_SPEC.padding
    nodes.cell.y = position.y - SHADOW_BOARD_SPEC.rowStartY
    nodes.sample.x = position.sampleX
    nodes.sample.y = position.sampleY
    nodes.label.textAutoResize = 'HEIGHT'
    nodes.label.resize(position.width, Math.max(1, nodes.label.height))
    nodes.label.textAlignHorizontal = 'CENTER'
    nodes.label.x = 0
    nodes.label.y = position.labelY
  }

  figma.currentPage.selection = [board]
  figma.viewport.scrollAndZoomIntoView([board])
  return board
}
