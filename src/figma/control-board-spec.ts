import type {
  CompositeState,
  ControlFamily,
  ControlState
} from '../shared/schema'

export const orderedControlFamilies: ControlFamily[] = [
  'button', 'input', 'textarea', 'select', 'toggle', 'checkbox', 'radio'
]
export type ControlCatalogSection = 'composites' | ControlFamily
export const orderedCatalogSections: ControlCatalogSection[] = [
  'composites', ...orderedControlFamilies
]
export const orderedControlStates: ControlState[] = [
  'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
]

export const CONTROL_BOARD_SPEC = {
  width: 1513,
  emptyHeight: 177,
  padding: 40,
  columns: 3,
  titleFontSize: 24,
  titleLineHeight: 29,
  contentStartY: 117,
  cornerRadius: 8,
  sectionGap: 32,
  sectionHeaderHeight: 20,
  sectionContentGap: 16,
  itemGap: 24,
  rowGap: 24,
  stateLabelGap: 8,
  stateLabelHeight: 14,
  familyFontSize: 14,
  familyLineHeight: 20,
  stateFontSize: 10,
  stateLineHeight: 14,
  specimenMinWidth: 445,
  specimenPadding: 16,
  assetNameFontSize: 11,
  assetNameLineHeight: 16,
  assetNameGap: 12,
  previewMinHeight: 112,
  previewVerticalPadding: 16,
  specimenCaptionGap: 12
} as const

export function atomicSpecimenWidth(observedWidth: number): number {
  return Math.max(216, Math.min(445, observedWidth + 96))
}

export function atomicPreviewHeight(observedHeight: number): number {
  return Math.max(48, Math.min(96, observedHeight + 16))
}

export type ControlBoardInput = {
  id: string
  family: ControlCatalogSection
  state: ControlState | CompositeState
  width: number
  height: number
}

export type ControlBoardItemLayout = ControlBoardInput & {
  x: number
  y: number
}

export type ControlBoardSectionLayout = {
  family: ControlCatalogSection
  y: number
  height: number
  count: number
}

export type ControlBoardLayout = {
  boardWidth: number
  boardHeight: number
  sections: ControlBoardSectionLayout[]
  items: ControlBoardItemLayout[]
}

function compareInputs(left: ControlBoardInput, right: ControlBoardInput): number {
  const stateOrder: Array<ControlState | CompositeState> = [
    'default', 'hover', 'focus', 'pressed', 'selected', 'expanded', 'disabled'
  ]
  return orderedCatalogSections.indexOf(left.family) -
      orderedCatalogSections.indexOf(right.family) ||
    stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state) ||
    left.id.localeCompare(right.id)
}

export function layoutControlBoard(inputs: ControlBoardInput[]): ControlBoardLayout {
  if (inputs.length === 0) {
    return {
      boardWidth: CONTROL_BOARD_SPEC.width,
      boardHeight: CONTROL_BOARD_SPEC.emptyHeight,
      sections: [],
      items: []
    }
  }

  const sorted = [...inputs].sort(compareInputs)
  const sections: ControlBoardSectionLayout[] = []
  const items: ControlBoardItemLayout[] = []
  const boardWidth = Math.max(
    CONTROL_BOARD_SPEC.width,
    ...sorted.map(input =>
      Math.max(input.width, 80) + CONTROL_BOARD_SPEC.padding * 2
    )
  )
  const contentRight = boardWidth - CONTROL_BOARD_SPEC.padding
  let cursorY = CONTROL_BOARD_SPEC.contentStartY

  for (const family of orderedCatalogSections) {
    const familyItems = sorted.filter(item => item.family === family)
    if (familyItems.length === 0) continue
    const sectionY = cursorY
    let x = CONTROL_BOARD_SPEC.padding
    let y = sectionY +
      CONTROL_BOARD_SPEC.sectionHeaderHeight +
      CONTROL_BOARD_SPEC.sectionContentGap
    let rowHeight = 0

    for (const input of familyItems) {
      const width = Math.max(input.width, 80)
      const height = input.height
      if (x > CONTROL_BOARD_SPEC.padding && x + width > contentRight) {
        x = CONTROL_BOARD_SPEC.padding
        y += rowHeight + CONTROL_BOARD_SPEC.rowGap
        rowHeight = 0
      }
      items.push({ ...input, width, height, x, y })
      x += width + CONTROL_BOARD_SPEC.itemGap
      rowHeight = Math.max(rowHeight, height)
    }

    const sectionBottom = y + rowHeight
    const height = sectionBottom - sectionY
    sections.push({ family, y: sectionY, height, count: familyItems.length })
    cursorY = sectionBottom + CONTROL_BOARD_SPEC.sectionGap
  }

  return {
    boardWidth,
    boardHeight: cursorY - CONTROL_BOARD_SPEC.sectionGap + CONTROL_BOARD_SPEC.padding,
    sections,
    items
  }
}
