import type { BorderRadiusToken } from '../shared/schema'
import type { AvailableFontName } from './font-resolver'
import { resolveFont } from './font-resolver'
import {
  RADIUS_BOARD_SPEC,
  radiusBoardHeight,
  radiusSampleValue,
  radiusTokenLabel
} from './radius-board-spec'
import {
  RADIUS_SHARED_NAMESPACE,
  type AppliedRadius
} from './radius-variable-applier'
import { readOwnership, writeOwnership } from './ownership'

export const RADIUS_BOARD_OWNERSHIP_KEY = 'smartScanRadiusBoardOrigin'
const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }
const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
const SAMPLE_FILL: SolidPaint = { type: 'SOLID', color: { r: 217 / 255, g: 229 / 255, b: 1 } }
const SAMPLE_STROKE: SolidPaint = { type: 'SOLID', color: { r: 153 / 255, g: 178 / 255, b: 229 / 255 } }

function labelFonts(available: AvailableFontName[]): { regular: AvailableFontName; semibold: AvailableFontName } {
  if (available.length === 0) throw new Error('Figma 中没有可用字体，无法生成 Border Radii 画板。')
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
  fill: SolidPaint,
  lineHeight: number
): Promise<TextNode> {
  const node = figma.createText()
  node.fontName = fontName
  node.fontSize = fontSize
  node.characters = characters
  node.fills = [fill]
  node.lineHeight = { unit: 'PIXELS', value: lineHeight }
  node.textAutoResize = 'WIDTH_AND_HEIGHT'
  return node
}

function findOwnedBoard(origin: string): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, RADIUS_SHARED_NAMESPACE, RADIUS_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
}

function placeNewBoard(board: FrameNode): void {
  const typography = figma.currentPage.findOne(node =>
    node.type === 'FRAME' && ['UI-Anatomist / Typography', 'UI-Anatomist / 字体'].includes(node.name)
  ) as FrameNode | null
  if (!typography) return
  board.x = typography.x + typography.width + 80
  board.y = typography.y
}

export async function buildRadiusBoard(
  tokens: BorderRadiusToken[],
  applied: AppliedRadius[],
  availableFonts: AvailableFontName[],
  origin: string
): Promise<FrameNode | null> {
  const existing = findOwnedBoard(origin)
  if (tokens.length === 0) {
    existing?.remove()
    return null
  }
  const fonts = labelFonts(availableFonts)
  await Promise.all([fonts.regular, fonts.semibold].map(font => figma.loadFontAsync(font)))
  const board = existing ?? figma.createFrame()
  if (!existing) placeNewBoard(board)
  for (const child of [...board.children]) child.remove()

  board.name = 'UI-Anatomist / Border Radii'
  writeOwnership(board, RADIUS_SHARED_NAMESPACE, RADIUS_BOARD_OWNERSHIP_KEY, origin)
  board.layoutMode = 'NONE'
  board.resize(RADIUS_BOARD_SPEC.width, radiusBoardHeight(tokens.length))
  board.cornerRadius = RADIUS_BOARD_SPEC.cornerRadius
  board.fills = [WHITE]
  board.clipsContent = false

  const title = await createText('Border Radii', fonts.semibold, 24, BLACK, 29)
  title.name = 'Title'
  title.x = RADIUS_BOARD_SPEC.padding
  title.y = RADIUS_BOARD_SPEC.padding
  board.appendChild(title)

  const variableByTokenId = new Map(applied.map(item => [item.entry.source.id, item.variable]))
  const cells: FrameNode[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const cell = figma.createFrame()
    cell.name = token.name
    cell.layoutMode = 'NONE'
    cell.fills = []
    cell.clipsContent = false
    board.appendChild(cell)

    const sample = figma.createRectangle()
    sample.name = `Sample / ${radiusTokenLabel(token)}`
    sample.resize(RADIUS_BOARD_SPEC.sampleSize, RADIUS_BOARD_SPEC.sampleSize)
    sample.fills = [SAMPLE_FILL]
    sample.strokes = [SAMPLE_STROKE]
    sample.strokeWeight = 1
    sample.cornerRadius = radiusSampleValue(token)
    const variable = variableByTokenId.get(token.id)
    if (variable && token.kind !== 'percent') {
      sample.setBoundVariable('cornerRadius', variable as unknown as Variable)
    }
    cell.appendChild(sample)

    const label = await createText(
      radiusTokenLabel(token),
      fonts.regular,
      RADIUS_BOARD_SPEC.labelFontSize,
      MUTED,
      RADIUS_BOARD_SPEC.labelLineHeight
    )
    label.name = 'Value'
    label.resize(RADIUS_BOARD_SPEC.sampleSize, Math.max(label.height, RADIUS_BOARD_SPEC.labelLineHeight))
    label.textAutoResize = 'HEIGHT'
    label.textAlignHorizontal = 'CENTER'
    label.x = 0
    label.y = RADIUS_BOARD_SPEC.sampleSize + RADIUS_BOARD_SPEC.labelGap
    cell.appendChild(label)
    cell.resize(
      RADIUS_BOARD_SPEC.sampleSize,
      Math.max(RADIUS_BOARD_SPEC.rowHeight, label.y + label.height)
    )
    cells.push(cell)
  }

  let currentY = 93
  for (let rowStart = 0; rowStart < cells.length; rowStart += RADIUS_BOARD_SPEC.columns) {
    const row = cells.slice(rowStart, rowStart + RADIUS_BOARD_SPEC.columns)
    const rowHeight = Math.max(...row.map(cell => cell.height))
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex]
      if (!cell) continue
      cell.x = RADIUS_BOARD_SPEC.padding + columnIndex * (
        RADIUS_BOARD_SPEC.sampleSize + RADIUS_BOARD_SPEC.columnGap
      )
      cell.y = currentY
    }
    currentY += rowHeight + RADIUS_BOARD_SPEC.rowGap
  }
  const contentBottom = currentY - RADIUS_BOARD_SPEC.rowGap
  board.resize(
    RADIUS_BOARD_SPEC.width,
    Math.max(radiusBoardHeight(tokens.length), contentBottom + RADIUS_BOARD_SPEC.padding)
  )

  figma.currentPage.selection = [board]
  figma.viewport.scrollAndZoomIntoView([board])
  return board
}
