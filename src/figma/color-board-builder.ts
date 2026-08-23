import type {
  Colors,
  ColorValue,
  InteractiveColorToken,
  PrimitiveColorToken,
  SemanticColorToken
} from '../shared/schema'
import type { AppliedColor, ColorVariablePort } from './color-variable-applier'
import { readColorOwnership, writeColorOwnership } from './color-variable-applier'
import type { AvailableFontName } from './font-resolver'
import {
  resolveAnnotationFonts,
  type AnnotationFonts
} from './annotation-font-resolver'
import { TYPOGRAPHY_BOARD_OWNERSHIP_KEY } from './board-builder'
import { RADIUS_BOARD_OWNERSHIP_KEY } from './radius-board-builder'
import { SHADOW_BOARD_OWNERSHIP_KEY } from './shadow-board-builder'
import { TYPOGRAPHY_SHARED_NAMESPACE } from './style-applier'
import { RADIUS_SHARED_NAMESPACE } from './radius-variable-applier'
import { SHADOW_SHARED_NAMESPACE } from './shadow-style-applier'
import { readOwnership } from './ownership'
import {
  COLOR_BOARD_SPECS,
  contrastTextColor,
  formatColorValue,
  layoutInteractiveBoard,
  layoutPrimitiveBoard,
  layoutSemanticBoard,
  nextColorClusterStartY,
  planColorBoardPositions,
  provenanceMark,
  type ColorCellMeasurement,
  type ColorBoardLayout
} from './color-board-spec'

export const COLOR_BOARD_OWNERSHIP_KEY = 'smartScanColorBoardOrigin'
export const COLOR_BOARD_KIND_KEY = 'smartScanColorBoardKind'

type BoardKind = 'primitive' | 'semantic' | 'interactive'
type LabelFonts = AnnotationFonts

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
const MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }
const BORDER: SolidPaint = { type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 } }

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

function wrapTextNodes(
  nodes: TextNode[],
  minimumWidth: number,
  maximumWidth: number
): number {
  const width = Math.min(
    maximumWidth,
    Math.max(minimumWidth, ...nodes.map(node => node.width))
  )
  for (const node of nodes) {
    node.textAutoResize = 'HEIGHT'
    node.resize(width, Math.max(1, node.height))
  }
  return width
}

function findOwnedBoard(origin: string, kind: BoardKind): FrameNode | null {
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readColorOwnership(node, COLOR_BOARD_OWNERSHIP_KEY) === origin &&
    readColorOwnership(node, COLOR_BOARD_KIND_KEY) === kind
  ) as FrameNode | null
}

function setupBoard(
  origin: string,
  kind: BoardKind,
  name: string,
  layout: ColorBoardLayout
): FrameNode {
  const board = findOwnedBoard(origin, kind) ?? figma.createFrame()
  for (const child of [...board.children]) child.remove()
  board.name = name
  writeColorOwnership(board, COLOR_BOARD_OWNERSHIP_KEY, origin)
  writeColorOwnership(board, COLOR_BOARD_KIND_KEY, kind)
  board.layoutMode = 'NONE'
  board.resize(layout.width, layout.height)
  board.cornerRadius = 8
  board.fills = [WHITE]
  board.clipsContent = false
  return board
}

function rawPaint(value: ColorValue): SolidPaint {
  return {
    type: 'SOLID',
    color: { r: value.r, g: value.g, b: value.b },
    opacity: value.a
  }
}

function boundPaint(value: ColorValue, variable: ColorVariablePort): SolidPaint {
  return figma.variables.setBoundVariableForPaint(
    rawPaint(value),
    'color',
    variable as unknown as Variable
  ) as SolidPaint
}

function variableMap(applied: AppliedColor[]): Map<string, ColorVariablePort> {
  return new Map(applied.map(item => [`${item.entry.layer}:${item.entry.source.id}`, item.variable]))
}

function appendSample(
  cell: FrameNode,
  token: PrimitiveColorToken | SemanticColorToken | InteractiveColorToken,
  variable: ColorVariablePort,
  width: number,
  height: number
): RectangleNode {
  const sample = figma.createRectangle()
  sample.name = `Sample / ${token.name}`
  sample.resize(width, height)
  sample.fills = [boundPaint(token.value, variable)]
  sample.strokes = [BORDER]
  sample.strokeWeight = 1
  sample.cornerRadius = 4
  cell.appendChild(sample)
  return sample
}

async function addBoardHeader(
  board: FrameNode,
  titleValue: string,
  summaryValue: string,
  fonts: LabelFonts,
  padding: number
): Promise<void> {
  const title = await createText(titleValue, fonts.semibold, 24, 29, BLACK)
  title.name = 'Title'
  title.x = padding
  title.y = padding
  board.appendChild(title)
  const summary = await createText(summaryValue, fonts.regular, 11, 16, MUTED)
  summary.name = 'Summary'
  summary.x = padding
  summary.y = 75
  board.appendChild(summary)
}

async function addGroupLabels(
  board: FrameNode,
  layout: ColorBoardLayout,
  fonts: LabelFonts
): Promise<void> {
  for (const group of layout.groups) {
    const label = await createText(group.key, fonts.medium, 14, 20, BLACK)
    label.name = `Group / ${group.key}`
    label.x = group.x
    label.y = group.y
    board.appendChild(label)
  }
}

async function addEmptyState(board: FrameNode, fonts: LabelFonts): Promise<void> {
  const empty = await createText('未发现已确认的颜色', fonts.regular, 12, 16, MUTED)
  empty.name = 'Empty state'
  empty.x = 40
  empty.y = 116
  board.appendChild(empty)
}

async function buildPrimitiveBoard(
  tokens: PrimitiveColorToken[],
  variables: Map<string, ColorVariablePort>,
  fonts: LabelFonts,
  origin: string
): Promise<FrameNode> {
  const visible = tokens.filter(token =>
    token.provenance !== 'inferred' &&
    variables.has(`primitive:${token.id}`)
  )
  const initialLayout = layoutPrimitiveBoard(visible)
  const initialPositions = new Map(initialLayout.cells.map(position => [position.tokenId, position]))
  const textByToken = new Map<string, { label: TextNode; value: TextNode }>()
  const measurements = new Map<string, ColorCellMeasurement>()
  for (const token of visible) {
    const position = initialPositions.get(token.id)
    if (!position) continue
    const label = await createText(
      `${provenanceMark(token.provenance)} · ${position.label}`,
      fonts.regular, 9, 12, MUTED
    )
    label.name = 'Token name and source'
    const value = await createText(formatColorValue(token.value), fonts.regular, 8, 10, MUTED)
    value.name = 'Color value'
    const width = wrapTextNodes(
      [label, value],
      COLOR_BOARD_SPECS.primitive.sampleWidth,
      220
    )
    measurements.set(token.id, {
      width,
      height: Math.max(
        COLOR_BOARD_SPECS.primitive.cellHeight,
        COLOR_BOARD_SPECS.primitive.sampleHeight + 4 +
          label.height + 2 + value.height + 4
      )
    })
    textByToken.set(token.id, { label, value })
  }
  const layout = layoutPrimitiveBoard(visible, measurements)
  const board = setupBoard(origin, 'primitive', 'UI-Anatomist / Color Primitives', layout)
  await addBoardHeader(board, 'Primitives',
    `${visible.length} 个实测颜色 · 按色族与明度排序`,
    fonts,
    COLOR_BOARD_SPECS.primitive.padding
  )
  await addGroupLabels(board, layout, fonts)
  if (visible.length === 0) await addEmptyState(board, fonts)

  const byId = new Map(visible.map(token => [token.id, token]))
  for (const position of layout.cells) {
    const token = byId.get(position.tokenId)
    const variable = token ? variables.get(`primitive:${token.id}`) : null
    if (!token || !variable) continue
    const cell = figma.createFrame()
    cell.name = `Primitive / ${token.name}`
    cell.layoutMode = 'NONE'
    cell.fills = []
    cell.clipsContent = false
    cell.resize(position.width, position.height)
    cell.x = position.x
    cell.y = position.y
    board.appendChild(cell)
    const sample = appendSample(
      cell, token, variable,
      COLOR_BOARD_SPECS.primitive.sampleWidth,
      COLOR_BOARD_SPECS.primitive.sampleHeight
    )
    sample.x = 0
    sample.y = 0
    const prepared = textByToken.get(token.id)
    if (!prepared) continue
    const { label, value } = prepared
    label.x = 0
    label.y = COLOR_BOARD_SPECS.primitive.sampleHeight + 4
    cell.appendChild(label)
    value.x = 0
    value.y = label.y + label.height + 2
    cell.appendChild(value)
  }
  return board
}

async function buildSemanticBoard(
  tokens: SemanticColorToken[],
  primitiveTokens: PrimitiveColorToken[],
  variables: Map<string, ColorVariablePort>,
  fonts: LabelFonts,
  origin: string
): Promise<FrameNode> {
  const visible = tokens.filter(token => variables.has(`semantic:${token.id}`))
  const initialLayout = layoutSemanticBoard(visible)
  const initialPositions = new Map(initialLayout.cells.map(position => [position.tokenId, position]))
  const primitiveNameById = new Map(primitiveTokens.map(token => [token.id, token.name]))
  const textByToken = new Map<string, { name: TextNode; alias: TextNode }>()
  const measurements = new Map<string, ColorCellMeasurement>()
  for (const token of visible) {
    const position = initialPositions.get(token.id)
    if (!position) continue
    const name = await createText(
      position.label,
      fonts.medium, 10, 14, BLACK
    )
    name.name = 'Semantic name'
    const primitiveName = primitiveNameById.get(token.primitiveId) ?? 'unknown primitive'
    const alias = await createText(
      `→ ${primitiveName}`,
      fonts.regular, 9, 12, MUTED
    )
    alias.name = 'Primitive alias'
    const textWidth = wrapTextNodes([name, alias], 120, 300)
    measurements.set(token.id, {
      width: COLOR_BOARD_SPECS.semantic.sampleWidth + 12 + textWidth,
      height: Math.max(
        COLOR_BOARD_SPECS.semantic.cellHeight,
        COLOR_BOARD_SPECS.semantic.sampleHeight,
        name.height + 2 + alias.height
      )
    })
    textByToken.set(token.id, { name, alias })
  }
  const layout = layoutSemanticBoard(visible, measurements)
  const board = setupBoard(origin, 'semantic', 'UI-Anatomist / Semantic Colors', layout)
  await addBoardHeader(board, 'Semantic Colors',
    `${visible.length} 个语义别名 · 映射到 Primitive`,
    fonts,
    COLOR_BOARD_SPECS.semantic.padding
  )
  await addGroupLabels(board, layout, fonts)
  if (visible.length === 0) await addEmptyState(board, fonts)

  const byId = new Map(visible.map(token => [token.id, token]))
  for (const position of layout.cells) {
    const token = byId.get(position.tokenId)
    const variable = token ? variables.get(`semantic:${token.id}`) : null
    if (!token || !variable) continue
    const cell = figma.createFrame()
    cell.name = `Semantic / ${token.name}`
    cell.layoutMode = 'NONE'
    cell.fills = []
    cell.clipsContent = false
    cell.resize(position.width, position.height)
    cell.x = position.x
    cell.y = position.y
    board.appendChild(cell)
    appendSample(
      cell, token, variable,
      COLOR_BOARD_SPECS.semantic.sampleWidth,
      COLOR_BOARD_SPECS.semantic.sampleHeight
    )
    const prepared = textByToken.get(token.id)
    if (!prepared) continue
    const { name, alias } = prepared
    name.x = COLOR_BOARD_SPECS.semantic.sampleWidth + 12
    name.y = 0
    cell.appendChild(name)
    alias.x = name.x
    alias.y = name.y + name.height + 2
    cell.appendChild(alias)
  }
  return board
}

async function buildInteractiveBoard(
  tokens: InteractiveColorToken[],
  variables: Map<string, ColorVariablePort>,
  fonts: LabelFonts,
  origin: string
): Promise<FrameNode> {
  const visible = tokens.filter(token => variables.has(`interactive:${token.id}`))
  const initialLayout = layoutInteractiveBoard(visible)
  const initialPositions = new Map(initialLayout.cells.map(position => [position.tokenId, position]))
  const textByToken = new Map<string, { state: TextNode; source: TextNode }>()
  const measurements = new Map<string, ColorCellMeasurement>()
  for (const token of visible) {
    const position = initialPositions.get(token.id)
    if (!position) continue
    const textColor = contrastTextColor(token.value) === 'dark' ? BLACK : WHITE
    const state = await createText(position.label, fonts.regular, 10, 14, textColor)
    state.name = 'State'
    state.textAutoResize = 'HEIGHT'
    state.resize(COLOR_BOARD_SPECS.interactive.sampleWidth, Math.max(1, state.height))
    state.textAlignHorizontal = 'CENTER'
    const source = await createText(formatColorValue(token.value), fonts.regular, 8, 10, MUTED)
    source.name = 'Color value'
    const width = wrapTextNodes(
      [source],
      COLOR_BOARD_SPECS.interactive.sampleWidth,
      COLOR_BOARD_SPECS.interactive.sampleWidth
    )
    measurements.set(token.id, {
      width,
      height: Math.max(
        COLOR_BOARD_SPECS.interactive.cellHeight,
        40 + source.height + 2
      )
    })
    textByToken.set(token.id, { state, source })
  }
  const layout = layoutInteractiveBoard(visible, measurements)
  const board = setupBoard(origin, 'interactive', 'UI-Anatomist / Interactive Colors', layout)
  await addBoardHeader(board, 'Interactive Colors',
    `${visible.length} 个交互色 · 按用途与状态分组`,
    fonts,
    COLOR_BOARD_SPECS.interactive.padding
  )
  await addGroupLabels(board, layout, fonts)
  if (visible.length === 0) await addEmptyState(board, fonts)

  const byId = new Map(visible.map(token => [token.id, token]))
  for (const position of layout.cells) {
    const token = byId.get(position.tokenId)
    const variable = token ? variables.get(`interactive:${token.id}`) : null
    if (!token || !variable) continue
    const cell = figma.createFrame()
    cell.name = `Interactive / ${token.name}`
    cell.layoutMode = 'NONE'
    cell.fills = []
    cell.clipsContent = false
    cell.resize(position.width, position.height)
    cell.x = position.x
    cell.y = position.y
    board.appendChild(cell)
    const sample = appendSample(
      cell, token, variable,
      COLOR_BOARD_SPECS.interactive.sampleWidth,
      COLOR_BOARD_SPECS.interactive.sampleHeight
    )
    sample.cornerRadius = 8
    const prepared = textByToken.get(token.id)
    if (!prepared) continue
    const { state, source } = prepared
    state.x = 0
    state.y = (COLOR_BOARD_SPECS.interactive.sampleHeight - state.height) / 2
    cell.appendChild(state)
    source.x = 0
    source.y = 40
    cell.appendChild(source)
  }
  return board
}

function positionBoards(
  primitive: FrameNode,
  semantic: FrameNode,
  interactive: FrameNode,
  origin: string,
  startY: number
): void {
  const positions = planColorBoardPositions({
    primitiveHeight: primitive.height,
    semanticHeight: semantic.height,
    interactiveHeight: interactive.height,
    startY
  })
  primitive.x = positions.primitive.x
  primitive.y = positions.primitive.y
  semantic.x = positions.semantic.x
  semantic.y = positions.semantic.y
  interactive.x = positions.interactive.x
  interactive.y = positions.interactive.y

  const typography = figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, TYPOGRAPHY_SHARED_NAMESPACE, TYPOGRAPHY_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
  const radii = figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, RADIUS_SHARED_NAMESPACE, RADIUS_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
  const shadows = figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, SHADOW_SHARED_NAMESPACE, SHADOW_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
  if (typography) {
    typography.x = 100
    typography.y = positions.foundationY
  }
  if (radii) {
    radii.x = typography ? typography.x + typography.width + 80 : 100
    radii.y = positions.foundationY
  }
  if (shadows) {
    const previousBottom = Math.max(
      typography ? typography.y + typography.height : positions.foundationY,
      radii ? radii.y + radii.height : positions.foundationY
    )
    shadows.x = 100
    shadows.y = previousBottom + 80
  }
}

export async function buildColorBoards(
  colors: Colors,
  applied: AppliedColor[],
  availableFonts: AvailableFontName[],
  origin: string
): Promise<{ primitive: FrameNode; semantic: FrameNode; interactive: FrameNode }> {
  const fonts = resolveAnnotationFonts(
    availableFonts,
    'Figma 中没有可用字体，无法生成 Colors 画板。'
  )
  await Promise.all(uniqueFonts(Object.values(fonts)).map(font => figma.loadFontAsync(font)))
  const variables = variableMap(applied)
  const existingPrimitive = findOwnedBoard(origin, 'primitive')
  const otherOwnedBoards = figma.currentPage.children.filter(node => {
    if (node.type !== 'FRAME') return false
    const owners = [
      readColorOwnership(node, COLOR_BOARD_OWNERSHIP_KEY),
      readOwnership(node, TYPOGRAPHY_SHARED_NAMESPACE, TYPOGRAPHY_BOARD_OWNERSHIP_KEY),
      readOwnership(node, RADIUS_SHARED_NAMESPACE, RADIUS_BOARD_OWNERSHIP_KEY),
      readOwnership(node, SHADOW_SHARED_NAMESPACE, SHADOW_BOARD_OWNERSHIP_KEY)
    ].filter(Boolean)
    return owners.length > 0 && !owners.includes(origin)
  }) as FrameNode[]
  const startY = nextColorClusterStartY(
    otherOwnedBoards.map(board => ({ y: board.y, height: board.height })),
    existingPrimitive?.y ?? null
  )
  const primitive = await buildPrimitiveBoard(colors.primitives, variables, fonts, origin)
  const semantic = await buildSemanticBoard(
    colors.semantic,
    colors.primitives,
    variables,
    fonts,
    origin
  )
  const interactive = await buildInteractiveBoard(colors.interactive, variables, fonts, origin)
  positionBoards(primitive, semantic, interactive, origin, startY)
  figma.currentPage.selection = [primitive, semantic, interactive]
  figma.viewport.scrollAndZoomIntoView([primitive, semantic, interactive])
  return { primitive, semantic, interactive }
}
