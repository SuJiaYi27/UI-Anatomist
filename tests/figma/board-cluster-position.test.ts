import { describe, expect, it } from 'vitest'
import {
  planBoardClusterAnchor,
  type BoardClusterItem,
  type BoardClusterRect
} from '../../src/figma/board-cluster-position'
import { layoutBoardRows } from '../../src/figma/board-safety'

const semanticBoards: BoardClusterItem[] = [
  { width: 540, height: 760, row: 0, order: 0 },
  { width: 640, height: 220, row: 0, order: 1 },
  { width: 1513, height: 260, row: 1, order: 0 }
]

function clusterRect(
  anchor: { x: number; y: number },
  width = 1260,
  height = 1100
): BoardClusterRect {
  return { ...anchor, width, height }
}

describe('stable multi-origin board cluster positioning', () => {
  it('keeps A and B stable through repeated A → B → A → B imports', () => {
    const a1 = planBoardClusterAnchor(semanticBoards, [], null)
    const b1 = planBoardClusterAnchor(
      semanticBoards,
      [clusterRect(a1)],
      null
    )
    const a2 = planBoardClusterAnchor(
      semanticBoards,
      [clusterRect(b1)],
      a1
    )
    const b2 = planBoardClusterAnchor(
      semanticBoards,
      [clusterRect(a2)],
      b1
    )

    expect(a1).toEqual({ x: 100, y: 100 })
    expect(b1.y).toBeGreaterThan(a1.y)
    expect(a2).toEqual(a1)
    expect(b2).toEqual(b1)
  })

  it('preserves the current anchor for an existing source when it is clear', () => {
    expect(planBoardClusterAnchor(
      semanticBoards,
      [{ x: 100, y: 100, width: 600, height: 400 }],
      { x: 240, y: 1600 }
    )).toEqual({ x: 240, y: 1600 })
  })

  it('moves an existing source only when its resized cluster collides', () => {
    const obstacle = { x: 100, y: 900, width: 1513, height: 400 }
    const result = planBoardClusterAnchor(
      semanticBoards,
      [obstacle],
      { x: 100, y: 100 }
    )

    expect(result).not.toEqual({ x: 100, y: 100 })
    expect(result.y).toBeGreaterThanOrEqual(obstacle.y + obstacle.height + 80)
  })

  it('retains the semantic single-source rows when no obstacle exists', () => {
    const boards = [
      { x: 0, y: 0, width: 543, height: 900 },
      { x: 0, y: 0, width: 640, height: 209 },
      { x: 0, y: 0, width: 1513, height: 227 }
    ]
    const items = [
      { board: boards[0], row: 0, order: 0 },
      { board: boards[1], row: 0, order: 1 },
      { board: boards[2], row: 1, order: 0 }
    ]
    const result = planBoardClusterAnchor(items.map(item => ({
      width: item.board.width,
      height: item.board.height,
      row: item.row,
      order: item.order
    })), [], null)
    layoutBoardRows(items, {
      startX: result.x,
      startY: result.y,
      gap: 80
    })

    expect(result).toEqual({ x: 100, y: 100 })
    expect(boards).toEqual([
      { x: 100, y: 100, width: 543, height: 900 },
      { x: 723, y: 100, width: 640, height: 209 },
      { x: 100, y: 1080, width: 1513, height: 227 }
    ])
  })
})
