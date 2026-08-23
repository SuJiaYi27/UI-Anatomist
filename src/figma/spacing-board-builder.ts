import type { SpacingToken } from '../shared/schema'
import type { AvailableFontName } from './font-resolver'
import { resolveFont } from './font-resolver'
import {
  SPACING_SHARED_NAMESPACE,
  type AppliedSpacing
} from './spacing-variable-applier'
import { readOwnership, writeOwnership } from './ownership'
import {
  SPACING_BOARD_SPEC,
  spacingTokenDetail,
  spacingTokenLabel
} from './spacing-board-spec'

export const SPACING_BOARD_OWNERSHIP_KEY = 'smartScanSpacingBoardOrigin'

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }
const LIGHT_MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.55 } }
const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
const BAR_FILL: SolidPaint = { type: 'SOLID', color: { r: 217 / 255, g: 229 / 255, b: 1 } }
const BAR_STROKE: SolidPaint = {
  type: 'SOLID',
  color: { r: 153 / 255, g: 178 / 255, b: 229 / 255 }
}

function labelFonts(available: AvailableFontName[]): {
  regular: AvailableFontName
  semibold: AvailableFontName
} {
  if (available.length === 0) throw new Error('Figma 中没有可用字体，无法生成 Spacing 画板。')
  const regular = resolveFont(['Inter'], 400, 'normal', available)
    ?? available.find(font => /regular|book|normal/i.test(font.style))
    ?? available[0]
  const semibold = resolveFont([regular.family], 600, 'normal', available) ?? regular
  return { regular, semibold }
}

async function createText(
  characters: string,
  fontName: AvailableFontName,
  fontSize: number,
  lineHeight: number,
  fill: SolidPaint
): Promise<TextNode> {
  const text = figma.createText()
  text.fontName = fontName
  text.fontSize = fontSize
  text.characters = characters
  text.lineHeight = { unit: 'PIXELS', value: lineHeight }
  text.fills = [fill]
  text.textAutoResize = 'WIDTH_AND_HEIGHT'
  return text
}

function findOwnedBoard(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, SPACING_SHARED_NAMESPACE, SPACING_BOARD_OWNERSHIP_KEY) === origin
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

export async function buildSpacingBoard(
  tokens: SpacingToken[],
  applied: AppliedSpacing[],
  availableFonts: AvailableFontName[],
  origin: string
): Promise<FrameNode> {
  const fonts = labelFonts(availableFonts)
  await Promise.all([fonts.regular, fonts.semibold].map(font => figma.loadFontAsync(font)))
  const existing = findOwnedBoard(origin)
  const board = existing ?? figma.createFrame()
  if (!existing) placeNewBoard(board)
  for (const child of [...board.children]) child.remove()

  board.name = 'UI-Anatomist / Spacing'
  writeOwnership(board, SPACING_SHARED_NAMESPACE, SPACING_BOARD_OWNERSHIP_KEY, origin)
  board.layoutMode = 'NONE'
  board.cornerRadius = SPACING_BOARD_SPEC.cornerRadius
  board.fills = [WHITE]
  board.clipsContent = false

  const title = await createText(
    'Spacing',
    fonts.semibold,
    SPACING_BOARD_SPEC.titleFontSize,
    SPACING_BOARD_SPEC.titleLineHeight,
    BLACK
  )
  title.name = 'Title'
  title.x = SPACING_BOARD_SPEC.padding
  title.y = SPACING_BOARD_SPEC.padding
  board.appendChild(title)

  if (tokens.length === 0) {
    const empty = await createText(
      'No confirmed spacing found',
      fonts.regular,
      12,
      16,
      MUTED
    )
    empty.name = 'Empty state'
    empty.x = SPACING_BOARD_SPEC.padding
    empty.y = SPACING_BOARD_SPEC.rowStartY
    board.appendChild(empty)
  }

  const variableByTokenId = new Map(applied.map(item => [
    item.entry.source.id,
    item.variable
  ]))
  const specimens: Array<{
    token: SpacingToken
    bar: RectangleNode
    label: TextNode
    detail: TextNode
  }> = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const bar = figma.createRectangle()
    bar.name = `Sample / ${spacingTokenLabel(token)}`
    bar.resize(token.value, SPACING_BOARD_SPEC.barHeight)
    bar.fills = [BAR_FILL]
    bar.strokes = [BAR_STROKE]
    bar.strokeWeight = 1
    bar.cornerRadius = 4
    const variable = variableByTokenId.get(token.id)
    if (variable) bar.setBoundVariable('width', variable as unknown as Variable)

    const label = await createText(
      spacingTokenLabel(token),
      fonts.regular,
      SPACING_BOARD_SPEC.labelFontSize,
      SPACING_BOARD_SPEC.labelLineHeight,
      MUTED
    )
    label.name = 'Value'

    const detail = await createText(
      spacingTokenDetail(token),
      fonts.regular,
      SPACING_BOARD_SPEC.detailFontSize,
      SPACING_BOARD_SPEC.detailLineHeight,
      LIGHT_MUTED
    )
    detail.name = 'Evidence'
    specimens.push({ token, bar, label, detail })
  }

  const cellWidth = Math.max(
    SPACING_BOARD_SPEC.cellWidth,
    ...specimens.flatMap(({ bar, label, detail }) => [bar.width, label.width, detail.width])
  )
  const baselineContentWidth = SPACING_BOARD_SPEC.width - SPACING_BOARD_SPEC.padding * 2
  const columns = Math.max(1, Math.min(
    SPACING_BOARD_SPEC.columns,
    Math.floor(
      (baselineContentWidth + SPACING_BOARD_SPEC.columnGap) /
      (cellWidth + SPACING_BOARD_SPEC.columnGap)
    )
  ))
  const usedColumns = Math.max(1, Math.min(columns, specimens.length))
  const boardWidth = Math.max(
    SPACING_BOARD_SPEC.width,
    SPACING_BOARD_SPEC.padding * 2 +
      usedColumns * cellWidth +
      Math.max(0, usedColumns - 1) * SPACING_BOARD_SPEC.columnGap
  )

  let cellHeight = SPACING_BOARD_SPEC.cellHeight
  for (const specimen of specimens) {
    specimen.label.resize(cellWidth, Math.max(specimen.label.height, SPACING_BOARD_SPEC.labelLineHeight))
    specimen.label.textAutoResize = 'HEIGHT'
    specimen.detail.resize(cellWidth, Math.max(specimen.detail.height, SPACING_BOARD_SPEC.detailLineHeight))
    specimen.detail.textAutoResize = 'HEIGHT'
    cellHeight = Math.max(
      cellHeight,
      SPACING_BOARD_SPEC.barHeight +
        SPACING_BOARD_SPEC.labelGap +
        specimen.label.height +
        SPACING_BOARD_SPEC.detailGap +
        specimen.detail.height
    )
  }
  const rows = Math.max(1, Math.ceil(specimens.length / columns))
  const boardHeight = SPACING_BOARD_SPEC.rowStartY +
    rows * cellHeight +
    Math.max(0, rows - 1) * SPACING_BOARD_SPEC.rowGap +
    SPACING_BOARD_SPEC.padding
  board.resize(boardWidth, boardHeight)

  for (let index = 0; index < specimens.length; index += 1) {
    const specimen = specimens[index]
    if (!specimen) continue
    const row = Math.floor(index / columns)
    const column = index % columns
    const cell = figma.createFrame()
    cell.name = `Spacing / ${specimen.token.name}`
    cell.layoutMode = 'NONE'
    cell.resize(cellWidth, cellHeight)
    cell.x = SPACING_BOARD_SPEC.padding + column * (
      cellWidth + SPACING_BOARD_SPEC.columnGap
    )
    cell.y = SPACING_BOARD_SPEC.rowStartY + row * (
      cellHeight + SPACING_BOARD_SPEC.rowGap
    )
    cell.fills = []
    cell.clipsContent = false
    board.appendChild(cell)

    specimen.bar.x = 0
    specimen.bar.y = 0
    cell.appendChild(specimen.bar)
    specimen.label.x = 0
    specimen.label.y = SPACING_BOARD_SPEC.barHeight + SPACING_BOARD_SPEC.labelGap
    cell.appendChild(specimen.label)
    specimen.detail.x = 0
    specimen.detail.y = specimen.label.y + specimen.label.height + SPACING_BOARD_SPEC.detailGap
    cell.appendChild(specimen.detail)
  }

  figma.currentPage.selection = [board]
  figma.viewport.scrollAndZoomIntoView([board])
  return board
}
