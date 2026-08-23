import type { IconCategory } from '../shared/schema'

export const ICON_MASTER_BOARD_SPEC = {
  width: 1176,
  minimumHeight: 520,
  padding: 40,
  contentStartY: 112,
  categoryHeadingHeight: 20,
  categoryHeadingGap: 12,
  sectionGap: 28,
  cardWidth: 120,
  cardMinimumHeight: 104,
  previewY: 18,
  labelY: 60,
  labelBottomPadding: 14,
  columnGap: 12,
  rowGap: 16,
  columns: 8
} as const

export type IconMasterBoardItem = {
  id: string
  category: IconCategory
  labelHeight?: number
}

export type IconMasterCardLayout = IconMasterBoardItem & {
  x: number
  y: number
  width: number
  height: number
}

const categoryOrder: IconCategory[] = [
  'navigation',
  'action',
  'composer',
  'status-system',
  'misc'
]

export function layoutIconMasterBoard(items: IconMasterBoardItem[]) {
  if (items.length === 0) {
    return {
      width: 0,
      height: 0,
      cards: [] as IconMasterCardLayout[],
      categories: [] as Array<{
        category: IconCategory
        y: number
        height: number
      }>
    }
  }

  const cards: IconMasterCardLayout[] = []
  const categories: Array<{
    category: IconCategory
    y: number
    height: number
  }> = []
  let cursorY = ICON_MASTER_BOARD_SPEC.contentStartY

  for (const category of categoryOrder) {
    const group = items.filter(item => item.category === category)
    if (group.length === 0) continue
    const categoryY = cursorY
    cursorY += ICON_MASTER_BOARD_SPEC.categoryHeadingHeight +
      ICON_MASTER_BOARD_SPEC.categoryHeadingGap

    for (
      let rowStart = 0;
      rowStart < group.length;
      rowStart += ICON_MASTER_BOARD_SPEC.columns
    ) {
      const row = group.slice(rowStart, rowStart + ICON_MASTER_BOARD_SPEC.columns)
      const rowHeight = Math.max(
        ICON_MASTER_BOARD_SPEC.cardMinimumHeight,
        ...row.map(item =>
          ICON_MASTER_BOARD_SPEC.labelY +
          Math.max(15, item.labelHeight ?? 15) +
          ICON_MASTER_BOARD_SPEC.labelBottomPadding
        )
      )
      for (const [column, item] of row.entries()) {
        cards.push({
          ...item,
          x: ICON_MASTER_BOARD_SPEC.padding +
            column * (
              ICON_MASTER_BOARD_SPEC.cardWidth +
              ICON_MASTER_BOARD_SPEC.columnGap
            ),
          y: cursorY,
          width: ICON_MASTER_BOARD_SPEC.cardWidth,
          height: rowHeight
        })
      }
      cursorY += rowHeight
      if (rowStart + ICON_MASTER_BOARD_SPEC.columns < group.length) {
        cursorY += ICON_MASTER_BOARD_SPEC.rowGap
      }
    }

    cursorY += ICON_MASTER_BOARD_SPEC.sectionGap
    categories.push({
      category,
      y: categoryY,
      height: cursorY - categoryY
    })
  }

  return {
    width: ICON_MASTER_BOARD_SPEC.width,
    height: Math.max(
      ICON_MASTER_BOARD_SPEC.minimumHeight,
      cursorY - ICON_MASTER_BOARD_SPEC.sectionGap +
        ICON_MASTER_BOARD_SPEC.padding
    ),
    cards,
    categories
  }
}
