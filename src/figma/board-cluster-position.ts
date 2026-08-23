export type BoardClusterItem = {
  width: number
  height: number
  row: number
  order: number
}

export type BoardClusterRect = {
  x: number
  y: number
  width: number
  height: number
}

export type BoardClusterAnchor = {
  x: number
  y: number
}

type BoardClusterOptions = {
  startX?: number
  startY?: number
  gap?: number
}

function clusterSize(
  items: readonly BoardClusterItem[],
  gap: number
): { width: number; height: number } {
  const rows = new Map<number, BoardClusterItem[]>()
  for (const item of items) {
    const row = rows.get(item.row) ?? []
    row.push(item)
    rows.set(item.row, row)
  }

  let width = 0
  let height = 0
  const rowIndices = [...rows.keys()].sort((left, right) => left - right)
  for (const rowIndex of rowIndices) {
    const row = rows.get(rowIndex) ?? []
    const rowWidth = row.reduce((sum, item, index) =>
      sum + item.width + (index > 0 ? gap : 0), 0)
    const rowHeight = Math.max(0, ...row.map(item => item.height))
    width = Math.max(width, rowWidth)
    height += rowHeight
  }
  if (rowIndices.length > 1) height += gap * (rowIndices.length - 1)
  return { width, height }
}

function collidesWithClearance(
  candidate: BoardClusterRect,
  obstacle: BoardClusterRect,
  gap: number
): boolean {
  return candidate.x < obstacle.x + obstacle.width + gap &&
    candidate.x + candidate.width + gap > obstacle.x &&
    candidate.y < obstacle.y + obstacle.height + gap &&
    candidate.y + candidate.height + gap > obstacle.y
}

function candidateRect(
  anchor: BoardClusterAnchor,
  size: { width: number; height: number }
): BoardClusterRect {
  return { ...anchor, ...size }
}

export function planBoardClusterAnchor(
  items: readonly BoardClusterItem[],
  obstacles: readonly BoardClusterRect[],
  preferredAnchor: BoardClusterAnchor | null,
  options: BoardClusterOptions = {}
): BoardClusterAnchor {
  const startX = options.startX ?? 100
  const startY = options.startY ?? 100
  const gap = options.gap ?? 80
  const size = clusterSize(items, gap)

  if (preferredAnchor) {
    const preferred = candidateRect(preferredAnchor, size)
    if (!obstacles.some(obstacle =>
      collidesWithClearance(preferred, obstacle, gap)
    )) {
      return preferredAnchor
    }
  }

  let candidate = { x: startX, y: startY }
  for (;;) {
    const rect = candidateRect(candidate, size)
    const collisions = obstacles.filter(obstacle =>
      collidesWithClearance(rect, obstacle, gap)
    )
    if (collisions.length === 0) return candidate
    candidate = {
      x: startX,
      y: Math.max(...collisions.map(obstacle =>
        obstacle.y + obstacle.height + gap
      ))
    }
  }
}
