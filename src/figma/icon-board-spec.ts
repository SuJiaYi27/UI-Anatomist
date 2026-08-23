import type { IconCategory } from '../shared/schema'

export const ICON_BOARD_SPEC = {
  width: 1176,
  minimumHeight: 1344,
  padding: 40,
  titleHeight: 32,
  themeGap: 48,
  sectionGap: 28,
  categoryHeadingHeight: 24,
  cardWidth: 120,
  cardHeight: 96,
  labelInset: 8,
  previewTopPadding: 16,
  previewInset: 8,
  previewToLabelGap: 8,
  indicatorGap: 8,
  indicatorSize: 6,
  cardBottomPadding: 10,
  columnGap: 12,
  rowGap: 16,
  columns: 8,
  cornerRadius: 8
} as const

export type IconBoardItem = {
  id: string
  category: IconCategory
  labelHeight?: number
  footprint?: { width: number; height: number }
}

export type IconCardLayout = IconBoardItem & {
  theme: 'light' | 'dark'
  x: number
  y: number
  width: number
  height: number
  preview: { x: number; y: number; width: number; height: number }
  label: { x: number; y: number; width: number; height: number }
  indicator: { x: number; y: number; width: number; height: number }
}

export type IconThemeLayout = {
  theme: 'light' | 'dark'
  y: number
  height: number
  cards: IconCardLayout[]
  categories: Array<{ category: IconCategory; y: number; height: number }>
}

const categoryOrder: IconCategory[] = [
  'navigation', 'action', 'composer', 'status-system', 'misc'
]

function footprintFor(item: IconBoardItem): { width: number; height: number } {
  return {
    width: Math.max(1, item.footprint?.width ?? 24),
    height: Math.max(1, item.footprint?.height ?? 24)
  }
}

export function iconCardWidth(item: IconBoardItem): number {
  const footprint = footprintFor(item)
  return Math.max(
    ICON_BOARD_SPEC.cardWidth,
    footprint.width + ICON_BOARD_SPEC.previewInset * 2
  )
}

function cardRegions(item: IconBoardItem, width: number) {
  const footprint = footprintFor(item)
  const preview = {
    x: 0,
    y: ICON_BOARD_SPEC.previewTopPadding,
    width,
    height: footprint.height + ICON_BOARD_SPEC.previewInset * 2
  }
  const label = {
    x: ICON_BOARD_SPEC.labelInset,
    y: preview.y + preview.height + ICON_BOARD_SPEC.previewToLabelGap,
    width: width - ICON_BOARD_SPEC.labelInset * 2,
    height: Math.max(15, item.labelHeight ?? 15)
  }
  const indicator = {
    x: (width - ICON_BOARD_SPEC.indicatorSize) / 2,
    y: label.y + label.height + ICON_BOARD_SPEC.indicatorGap,
    width: ICON_BOARD_SPEC.indicatorSize,
    height: ICON_BOARD_SPEC.indicatorSize
  }
  return {
    preview,
    label,
    indicator,
    height: Math.max(
      ICON_BOARD_SPEC.cardHeight,
      indicator.y + indicator.height + ICON_BOARD_SPEC.cardBottomPadding
    )
  }
}

export function layoutIconBoard(items: IconBoardItem[]) {
  if (items.length === 0) return { boardHeight: 0, themes: [] }
  const themes: IconThemeLayout[] = []
  let cursorY = ICON_BOARD_SPEC.padding + ICON_BOARD_SPEC.titleHeight + 32
  for (const theme of ['light', 'dark'] as const) {
    const themeStart = cursorY
    const cards: IconCardLayout[] = []
    const categories: IconThemeLayout['categories'] = []
    cursorY += 40
    for (const category of categoryOrder) {
      const group = items.filter(item => item.category === category)
      if (group.length === 0) continue
      const categoryY = cursorY
      cursorY += ICON_BOARD_SPEC.categoryHeadingHeight + 12
      let row: IconBoardItem[] = []
      const flushRow = () => {
        if (row.length === 0) return
        const regions = row.map(item => {
          const width = iconCardWidth(item)
          return { item, width, ...cardRegions(item, width) }
        })
        const rowHeight = Math.max(...regions.map(item => item.height))
        let x = ICON_BOARD_SPEC.padding
        for (const item of regions) {
          cards.push({
            ...item.item,
            theme,
            x,
            y: cursorY,
            width: item.width,
            height: rowHeight,
            preview: item.preview,
            label: item.label,
            indicator: item.indicator
          })
          x += item.width + ICON_BOARD_SPEC.columnGap
        }
        cursorY += rowHeight
        row = []
      }
      const availableWidth = ICON_BOARD_SPEC.width - ICON_BOARD_SPEC.padding * 2
      for (const item of group) {
        const rowWidth = row.reduce((sum, current) => sum + iconCardWidth(current), 0) +
          Math.max(0, row.length - 1) * ICON_BOARD_SPEC.columnGap
        const candidateWidth = rowWidth + (row.length > 0 ? ICON_BOARD_SPEC.columnGap : 0) +
          iconCardWidth(item)
        if (
          row.length >= ICON_BOARD_SPEC.columns ||
          (row.length > 0 && candidateWidth > availableWidth)
        ) {
          flushRow()
          cursorY += ICON_BOARD_SPEC.rowGap
        }
        row.push(item)
      }
      flushRow()
      cursorY += ICON_BOARD_SPEC.sectionGap
      categories.push({ category, y: categoryY, height: cursorY - categoryY })
    }
    const height = cursorY - themeStart
    themes.push({ theme, y: themeStart, height, cards, categories })
    cursorY += ICON_BOARD_SPEC.themeGap
  }
  const boardHeight = Math.max(
    ICON_BOARD_SPEC.minimumHeight,
    cursorY - ICON_BOARD_SPEC.themeGap + ICON_BOARD_SPEC.padding
  )
  const finalTheme = themes.at(-1)
  if (finalTheme) {
    finalTheme.height = boardHeight - finalTheme.y
  }
  return { boardHeight, themes }
}
