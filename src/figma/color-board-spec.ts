import type {
  ColorProvenance,
  ColorValue,
  InteractiveColorUsage,
  InteractiveColorToken,
  PrimitiveColorToken,
  SemanticColorToken
} from '../shared/schema'

export const COLOR_BOARD_SPECS = {
  primitive: {
    width: 1513,
    padding: 40,
    titleFontSize: 24,
    titleLineHeight: 29,
    cornerRadius: 8,
    sampleWidth: 144,
    sampleHeight: 52,
    cellWidth: 160,
    cellHeight: 94,
    columnGap: 16,
    rowGap: 20,
    sectionGap: 32,
    contentStartY: 116
  },
  semantic: {
    width: 880,
    padding: 40,
    titleFontSize: 24,
    titleLineHeight: 29,
    cornerRadius: 8,
    sampleWidth: 48,
    sampleHeight: 40,
    cellWidth: 240,
    cellHeight: 56,
    columnGap: 16,
    rowGap: 16,
    sectionGap: 32,
    contentStartY: 116
  },
  interactive: {
    width: 506,
    padding: 40,
    titleFontSize: 24,
    titleLineHeight: 29,
    cornerRadius: 8,
    sampleWidth: 64,
    sampleHeight: 36,
    cellWidth: 64,
    cellHeight: 52,
    columnGap: 8,
    rowGap: 12,
    sectionGap: 24,
    contentStartY: 116
  }
} as const

const FAMILY_ORDER: PrimitiveColorToken['family'][] = [
  'neutral', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'other'
]
const SEMANTIC_ORDER: SemanticColorToken['group'][] = [
  'background', 'text', 'border', 'link', 'status', 'content', 'misc'
]
const INTENT_ORDER: InteractiveColorToken['intent'][] = [
  'accent', 'danger', 'primary', 'secondary', 'tertiary', 'other'
]
const STATE_ORDER: InteractiveColorToken['state'][] = [
  'default', 'hover', 'focus', 'pressed', 'selected', 'disabled'
]
const INTERACTIVE_USAGE_ORDER: InteractiveColorUsage[] = [
  'background', 'foreground', 'border', 'outline'
]

const COLOR_DETAIL_LABELS: Record<string, string> = {
  neutral: '中性灰',
  blue: '蓝色',
  cyan: '青色',
  green: '绿色',
  yellow: '黄色',
  orange: '橙色',
  red: '红色',
  pink: '粉色',
  purple: '紫色',
  other: '其他',
  background: '背景',
  text: '文字',
  foreground: '前景',
  border: '边框',
  link: '链接',
  status: '状态',
  content: '内容',
  misc: '其他',
  accent: '强调',
  danger: '危险',
  primary: '主要',
  secondary: '次要',
  tertiary: '低强调',
  default: '默认',
  hover: '悬浮',
  focus: '聚焦',
  pressed: '按下',
  selected: '选中',
  disabled: '禁用',
  outline: '轮廓'
}

export type ColorBoardCell = {
  tokenId: string
  x: number
  y: number
  width: number
  height: number
  label: string
}

export type ColorCellMeasurement = {
  width: number
  height: number
}

export type ColorBoardGroup = {
  key: string
  x: number
  y: number
  width: number
  height: number
}

export type ColorBoardLayout = {
  width: number
  height: number
  groups: ColorBoardGroup[]
  cells: ColorBoardCell[]
}

export type BoardBounds = { y: number; height: number }
export type OwnedBoardBounds = BoardBounds & { origin: string }

export function planOwnedClusterShifts(
  boards: OwnedBoardBounds[],
  gap = 80
): Array<{ origin: string; shiftY: number }> {
  const clusters = new Map<string, { top: number; bottom: number }>()
  for (const board of boards) {
    const previous = clusters.get(board.origin)
    const bottom = board.y + board.height
    clusters.set(board.origin, previous ? {
      top: Math.min(previous.top, board.y),
      bottom: Math.max(previous.bottom, bottom)
    } : { top: board.y, bottom })
  }

  let cursor = Number.NEGATIVE_INFINITY
  return [...clusters.entries()]
    .sort((left, right) => left[1].top - right[1].top || left[0].localeCompare(right[0]))
    .map(([origin, bounds]) => {
      const targetTop = Math.max(bounds.top, cursor)
      const shiftY = targetTop - bounds.top
      cursor = bounds.bottom + shiftY + gap
      return { origin, shiftY }
    })
}

export function nextColorClusterStartY(
  otherOwnedBoards: BoardBounds[],
  currentStartY: number | null
): number {
  if (currentStartY !== null) return currentStartY
  if (otherOwnedBoards.length === 0) return 100
  return Math.max(...otherOwnedBoards.map(board => board.y + board.height)) + 80
}

export function planColorBoardPositions(input: {
  primitiveHeight: number
  semanticHeight: number
  interactiveHeight: number
  startY: number
}): {
  primitive: { x: number; y: number }
  semantic: { x: number; y: number }
  interactive: { x: number; y: number }
  foundationY: number
} {
  const primitive = { x: 100, y: input.startY }
  const semantic = { x: 100, y: primitive.y + input.primitiveHeight + 80 }
  const interactive = {
    x: 100 + COLOR_BOARD_SPECS.semantic.width + 80,
    y: semantic.y
  }
  return {
    primitive,
    semantic,
    interactive,
    foundationY: Math.max(
      semantic.y + input.semanticHeight,
      interactive.y + input.interactiveHeight
    ) + 80
  }
}

function byte(channel: number): string {
  return Math.round(channel * 255).toString(16).padStart(2, '0').toUpperCase()
}

export function formatColorValue(value: ColorValue): string {
  const hex = `#${byte(value.r)}${byte(value.g)}${byte(value.b)}`
  return value.a === 1 ? hex : `${hex} · ${Math.round(value.a * 100)}%`
}

export function provenanceMark(value: ColorProvenance): '实测' | '声明' | '推断' {
  if (value === 'observed') return '实测'
  if (value === 'declared') return '声明'
  return '推断'
}

function localizeColorDetail(value: string): string {
  return value
    .split(/([/_-])/)
    .map(part => COLOR_DETAIL_LABELS[part.toLowerCase()] ?? part)
    .join('')
}

export function compactColorLabel(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value
  if (maximumLength < 5) return value.slice(0, maximumLength)
  const suffixLength = 4
  const prefixLength = maximumLength - suffixLength - 1
  return `${value.slice(0, prefixLength)}…${value.slice(-suffixLength)}`
}

export function contrastTextColor(value: ColorValue): 'dark' | 'light' {
  const composite = {
    r: value.r * value.a + 1 - value.a,
    g: value.g * value.a + 1 - value.a,
    b: value.b * value.a + 1 - value.a
  }
  const luminance = 0.2126 * composite.r + 0.7152 * composite.g + 0.0722 * composite.b
  return luminance > 0.55 ? 'dark' : 'light'
}

function groupLayout<T extends { id: string }>(
  groups: Array<{ key: string; tokens: T[] }>,
  spec: typeof COLOR_BOARD_SPECS.primitive | typeof COLOR_BOARD_SPECS.semantic | typeof COLOR_BOARD_SPECS.interactive,
  labelFor: (token: T) => string,
  measurements?: ReadonlyMap<string, ColorCellMeasurement>
): ColorBoardLayout {
  const available = spec.width - spec.padding * 2
  let cursorY = spec.contentStartY
  const cells: ColorBoardCell[] = []
  const laidOutGroups: ColorBoardGroup[] = []

  for (const group of groups) {
    const headerHeight = 20
    const cellStartY = cursorY + headerHeight + 12
    let cellX = spec.padding
    let cellY = cellStartY
    let rowHeight = 0
    for (const token of group.tokens) {
      const measurement = measurements?.get(token.id)
      const width = Math.min(
        available,
        Math.max(spec.cellWidth, measurement?.width ?? spec.cellWidth)
      )
      const height = Math.max(spec.cellHeight, measurement?.height ?? spec.cellHeight)
      if (cellX > spec.padding && cellX + width > spec.padding + available) {
        cellX = spec.padding
        cellY += rowHeight + spec.rowGap
        rowHeight = 0
      }
      cells.push({
        tokenId: token.id,
        x: cellX,
        y: cellY,
        width,
        height,
        label: labelFor(token)
      })
      cellX += width + spec.columnGap
      rowHeight = Math.max(rowHeight, height)
    }
    const contentBottom = group.tokens.length > 0
      ? cellY + rowHeight
      : cellStartY + spec.cellHeight
    const groupHeight = contentBottom - cursorY
    laidOutGroups.push({
      key: group.key,
      x: spec.padding,
      y: cursorY,
      width: available,
      height: groupHeight
    })
    cursorY += groupHeight + spec.sectionGap
  }

  const contentBottom = groups.length > 0 ? cursorY - spec.sectionGap : spec.contentStartY + 28
  return {
    width: spec.width,
    height: Math.max(160, contentBottom + spec.padding),
    groups: laidOutGroups,
    cells
  }
}

export function layoutPrimitiveBoard(
  tokens: PrimitiveColorToken[],
  measurements?: ReadonlyMap<string, ColorCellMeasurement>
): ColorBoardLayout {
  const tokenGroups = FAMILY_ORDER.flatMap(key => {
    const matching = tokens
      .filter(token => token.family === key && token.provenance !== 'inferred')
      .sort((left, right) => {
        const leftStep = left.step ?? Math.round((1 - left.value.r) * 1000)
        const rightStep = right.step ?? Math.round((1 - right.value.r) * 1000)
        return leftStep - rightStep || left.name.localeCompare(right.name)
      })
    return matching.length ? [{ key: localizeColorDetail(key), tokens: matching }] : []
  })
  const spec = COLOR_BOARD_SPECS.primitive
  const available = spec.width - spec.padding * 2
  const cells: ColorBoardCell[] = []
  const groups: ColorBoardGroup[] = []
  let cursorX = spec.padding
  let cursorY = spec.contentStartY
  let packedRowHeight = 0

  for (const group of tokenGroups) {
    const sizes = group.tokens.map(token => ({
      token,
      width: Math.min(
        available,
        Math.max(spec.cellWidth, measurements?.get(token.id)?.width ?? spec.cellWidth)
      ),
      height: Math.max(
        spec.cellHeight,
        measurements?.get(token.id)?.height ?? spec.cellHeight
      )
    }))
    const naturalWidth = sizes.reduce(
      (sum, item, index) => sum + item.width + (index > 0 ? spec.columnGap : 0),
      0
    )
    const blockWidth = Math.min(available, naturalWidth)
    const localCells: Array<ColorBoardCell> = []
    let localX = 0
    let localY = 32
    let localRowHeight = 0
    for (const item of sizes) {
      if (localX > 0 && localX + item.width > blockWidth) {
        localX = 0
        localY += localRowHeight + spec.rowGap
        localRowHeight = 0
      }
      localCells.push({
        tokenId: item.token.id,
        x: localX,
        y: localY,
        width: item.width,
        height: item.height,
        label: localizeColorDetail(item.token.name)
      })
      localX += item.width + spec.columnGap
      localRowHeight = Math.max(localRowHeight, item.height)
    }
    const blockHeight = localY + localRowHeight
    if (
      cursorX > spec.padding &&
      cursorX + blockWidth > spec.padding + available
    ) {
      cursorX = spec.padding
      cursorY += packedRowHeight + spec.sectionGap
      packedRowHeight = 0
    }
    groups.push({
      key: group.key,
      x: cursorX,
      y: cursorY,
      width: blockWidth,
      height: blockHeight
    })
    cells.push(...localCells.map(cell => ({
      ...cell,
      x: cursorX + cell.x,
      y: cursorY + cell.y
    })))
    cursorX += blockWidth + spec.sectionGap
    packedRowHeight = Math.max(packedRowHeight, blockHeight)
  }

  const contentBottom = groups.length > 0
    ? cursorY + packedRowHeight
    : spec.contentStartY + 28
  return {
    width: spec.width,
    height: Math.max(160, contentBottom + spec.padding),
    groups,
    cells
  }
}

export function layoutSemanticBoard(
  tokens: SemanticColorToken[],
  measurements?: ReadonlyMap<string, ColorCellMeasurement>
): ColorBoardLayout {
  const groups = SEMANTIC_ORDER.flatMap(key => {
    const matching = tokens.filter(token => token.group === key)
      .sort((left, right) => left.name.localeCompare(right.name))
    return matching.length ? [{ key: localizeColorDetail(key), tokens: matching }] : []
  })
  return groupLayout(
    groups,
    COLOR_BOARD_SPECS.semantic,
    token => localizeColorDetail(token.name),
    measurements
  )
}

export function layoutInteractiveBoard(
  tokens: InteractiveColorToken[],
  measurements?: ReadonlyMap<string, ColorCellMeasurement>
): ColorBoardLayout {
  const tokenGroups: Array<{ key: string; tokens: InteractiveColorToken[] }> = []
  for (const intent of INTENT_ORDER) {
    for (const usage of INTERACTIVE_USAGE_ORDER) {
      const matching = tokens
        .filter(token => token.intent === intent && token.usage === usage)
        .sort((left, right) =>
          STATE_ORDER.indexOf(left.state) - STATE_ORDER.indexOf(right.state) ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id)
        )
      if (matching.length === 0) continue
      tokenGroups.push({
        key: `${localizeColorDetail(intent)} · ${localizeColorDetail(usage)}`,
        tokens: matching
      })
    }
  }
  return groupLayout(
    tokenGroups,
    COLOR_BOARD_SPECS.interactive,
    token => localizeColorDetail(token.state),
    measurements
  )
}
