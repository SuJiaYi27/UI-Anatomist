import { BOARD_SAMPLE_TEXT, BOARD_SPEC } from './board-spec'
import type { AvailableFontName } from './font-resolver'
import { resolveFont } from './font-resolver'
import {
  TYPOGRAPHY_SHARED_NAMESPACE,
  type AppliedStyle
} from './style-applier'
import { readOwnership, writeOwnership } from './ownership'

export const TYPOGRAPHY_BOARD_OWNERSHIP_KEY = 'smartScanTypographyBoardOrigin'
const LEGACY_BOARD_OWNERSHIP_KEY = 'smartScanTypographyBoard'
const LEGACY_BOARD_OWNERSHIP_VALUE = 'v1'
const DARK: SolidPaint = { type: 'SOLID', color: { r: 0.102, g: 0.102, b: 0.102 } }
const MUTED: SolidPaint = { type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }
const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }

type LabelFonts = {
  regular: AvailableFontName
  medium: AvailableFontName
  semibold: AvailableFontName
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

function labelFonts(availableFonts: AvailableFontName[]): LabelFonts {
  if (availableFonts.length === 0) throw new Error('Figma 中没有可用字体，无法生成 Typography 画板。')
  const regular = resolveFont(['Inter'], 400, 'normal', availableFonts)
    ?? availableFonts.find(font => /regular|book|normal/i.test(font.style))
    ?? availableFonts[0]
  const medium = resolveFont([regular.family], 500, 'normal', availableFonts) ?? regular
  const semibold = resolveFont([regular.family], 600, 'normal', availableFonts) ?? medium
  return { regular, medium, semibold }
}

async function createText(
  characters: string,
  fontName: AvailableFontName,
  fontSize: number,
  fill: SolidPaint,
  lineHeight?: number,
  width?: number
): Promise<TextNode> {
  const node = figma.createText()
  node.fontName = fontName
  node.fontSize = fontSize
  node.characters = characters
  node.fills = [fill]
  if (lineHeight) node.lineHeight = { unit: 'PIXELS', value: lineHeight }
  if (width !== undefined) {
    node.resize(width, Math.max(node.height, lineHeight ?? Math.ceil(fontSize * 1.2)))
    node.textAutoResize = 'HEIGHT'
  } else {
    node.textAutoResize = 'WIDTH_AND_HEIGHT'
  }
  return node
}

function findOwnedBoard(origin: string): FrameNode | null {
  const exact = figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, TYPOGRAPHY_SHARED_NAMESPACE, TYPOGRAPHY_BOARD_OWNERSHIP_KEY) === origin
  ) as FrameNode | null
  if (exact) return exact
  return figma.currentPage.findOne(node =>
    node.type === 'FRAME' &&
    readOwnership(node, TYPOGRAPHY_SHARED_NAMESPACE, LEGACY_BOARD_OWNERSHIP_KEY) ===
      LEGACY_BOARD_OWNERSHIP_VALUE &&
    !readOwnership(node, TYPOGRAPHY_SHARED_NAMESPACE, TYPOGRAPHY_BOARD_OWNERSHIP_KEY)
  ) as FrameNode | null
}

function dominantFamily(styles: AppliedStyle[]): string {
  const counts = new Map<string, number>()
  for (const { entry, style } of styles) {
    const count = counts.get(style.fontName.family) ?? 0
    counts.set(style.fontName.family, count + entry.source.occurrences)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
}

function monoFamily(styles: AppliedStyle[]): string {
  const mono = styles.find(({ entry }) =>
    entry.source.fontFamilyStack.some(family => /mono|code|consolas|menlo/i.test(family))
  )
  return mono?.style.fontName.family ?? '—'
}

export async function buildTypographyBoard(
  styles: AppliedStyle[],
  availableFonts: AvailableFontName[],
  origin: string
): Promise<FrameNode | null> {
  const existing = findOwnedBoard(origin)
  if (styles.length === 0) {
    existing?.remove()
    return null
  }
  const labels = labelFonts(availableFonts)
  await Promise.all(uniqueFonts(Object.values(labels)).map(font => figma.loadFontAsync(font)))

  const board = existing ?? figma.createFrame()
  for (const child of [...board.children]) child.remove()

  board.name = 'UI-Anatomist / 字体'
  writeOwnership(
    board,
    TYPOGRAPHY_SHARED_NAMESPACE,
    TYPOGRAPHY_BOARD_OWNERSHIP_KEY,
    origin
  )
  board.layoutMode = 'VERTICAL'
  board.primaryAxisSizingMode = 'FIXED'
  board.counterAxisSizingMode = 'FIXED'
  board.resize(BOARD_SPEC.width, BOARD_SPEC.minHeight)
  board.minHeight = BOARD_SPEC.minHeight
  board.paddingTop = BOARD_SPEC.padding
  board.paddingRight = BOARD_SPEC.padding
  board.paddingBottom = BOARD_SPEC.padding
  board.paddingLeft = BOARD_SPEC.padding
  board.itemSpacing = BOARD_SPEC.sectionGap
  board.cornerRadius = BOARD_SPEC.cornerRadius
  board.fills = [WHITE]
  board.clipsContent = false

  const contentWidth = BOARD_SPEC.width - BOARD_SPEC.padding * 2
  const title = await createText('字体', labels.semibold, 24, DARK, 29, contentWidth)
  title.name = 'Title'
  board.appendChild(title)

  const subtitle = await createText(
    `默认字体："${dominantFamily(styles)}" · 等宽字体："${monoFamily(styles)}"`,
    labels.regular,
    12,
    MUTED,
    16,
    contentWidth
  )
  subtitle.name = 'Font summary'
  board.appendChild(subtitle)

  for (const { entry, style } of styles) {
    const nameParts = entry.targetName.split('/')
    const displayName = nameParts[nameParts.length - 1] || entry.source.name
    const row = figma.createFrame()
    row.name = displayName
    row.layoutMode = 'HORIZONTAL'
    row.primaryAxisSizingMode = 'FIXED'
    row.counterAxisSizingMode = 'AUTO'
    row.resize(contentWidth, 40)
    row.itemSpacing = 24
    row.counterAxisAlignItems = 'CENTER'
    row.fills = []
    row.clipsContent = false
    board.appendChild(row)

    const info = figma.createFrame()
    info.name = 'Style info'
    info.layoutMode = 'VERTICAL'
    info.primaryAxisSizingMode = 'FIXED'
    info.counterAxisSizingMode = 'FIXED'
    info.resize(BOARD_SPEC.infoWidth, 36)
    info.itemSpacing = 4
    info.fills = []
    info.clipsContent = false
    row.appendChild(info)

    const name = await createText(displayName, labels.medium, 12, DARK, 16, BOARD_SPEC.infoWidth)
    name.name = 'Style name'
    info.appendChild(name)

    const lineHeight = entry.source.lineHeightPx === null ? 'Auto' : `${entry.source.lineHeightPx}px`
    const specification = await createText(
      `${entry.source.fontSizePx}px / ${entry.source.fontWeight} / ${lineHeight}`,
      labels.regular,
      10,
      MUTED,
      12,
      BOARD_SPEC.infoWidth
    )
    specification.name = 'Style values'
    info.appendChild(specification)
    const infoHeight = Math.max(36, name.height + info.itemSpacing + specification.height)
    info.resize(BOARD_SPEC.infoWidth, infoHeight)

    const sampleWidth = contentWidth - BOARD_SPEC.infoWidth - row.itemSpacing
    const sample = await createText(
      BOARD_SAMPLE_TEXT,
      style.fontName,
      entry.source.fontSizePx,
      DARK,
      entry.source.lineHeightPx ?? undefined,
      sampleWidth
    )
    sample.name = 'Sample'
    await sample.setTextStyleIdAsync(style.id)
    sample.resize(
      sampleWidth,
      Math.max(sample.height, entry.source.lineHeightPx ?? Math.ceil(entry.source.fontSizePx * 1.2))
    )
    sample.textAutoResize = 'HEIGHT'
    sample.layoutAlign = 'INHERIT'
    sample.layoutGrow = 1
    row.appendChild(sample)
    row.counterAxisSizingMode = 'FIXED'
    row.resize(contentWidth, Math.max(40, info.height, sample.height))
  }

  const childHeight = board.children.reduce((sum, child) => sum + child.height, 0)
  const gapHeight = Math.max(0, board.children.length - 1) * board.itemSpacing
  const requiredHeight = board.paddingTop + childHeight + gapHeight + board.paddingBottom
  board.resize(BOARD_SPEC.width, Math.max(BOARD_SPEC.minHeight, requiredHeight))

  figma.currentPage.selection = [board]
  figma.viewport.scrollAndZoomIntoView([board])
  return board
}
