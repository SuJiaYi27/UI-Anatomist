export type BoardRect = {
  x: number
  y: number
  width: number
  height: number
}

export type BoardSafetyNode = BoardRect & {
  name?: string
  type?: string
  visible?: boolean
  clipsContent?: boolean
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  paddingLeft?: number
  paddingTop?: number
  constraints?: {
    horizontal?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'
    vertical?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'
  }
  children?: readonly BoardSafetyNode[]
  absoluteBoundingBox?: BoardRect | null
  absoluteRenderBounds?: BoardRect | null
  resize?(width: number, height: number): void
}

export type ResizableBoard = BoardSafetyNode & {
  resize(width: number, height: number): void
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'
  paddingLeft?: number
  paddingTop?: number
}

export type BoardContentBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type BoardSafetyArea = {
  left: number
  top: number
  right: number
  bottom: number
}

export type BoardFitOptions = Partial<BoardSafetyArea> & {
  minWidth?: number
  minHeight?: number
  maxPasses?: number
}

export type SettledBoardFitOptions = BoardFitOptions & {
  maxSettlementPasses?: number
  minSettlementPasses?: number
  stablePasses?: number
  settle?: () => Promise<void>
}

export type SettledBoardFitTarget<T extends ResizableBoard = ResizableBoard> = {
  board: T
  options?: SettledBoardFitOptions
}

export type BoardSafetyViolation = {
  edge: keyof BoardSafetyArea
  available: number
  required: number
}

export type BoardSafetyAudit = {
  safe: boolean
  bounds: BoardContentBounds | null
  available: BoardSafetyArea | null
  violations: BoardSafetyViolation[]
}

export type BoardRowItem<T extends BoardSafetyNode> = {
  board: T
  row: number
  order: number
}

const DEFAULT_SAFE_AREA: BoardSafetyArea = {
  left: 40,
  top: 40,
  right: 40,
  bottom: 40
}

const EPSILON = 1
const SAFETY_EPSILON = 0.01

function resolveSafeArea(options: Partial<BoardSafetyArea>): BoardSafetyArea {
  return {
    left: options.left ?? DEFAULT_SAFE_AREA.left,
    top: options.top ?? DEFAULT_SAFE_AREA.top,
    right: options.right ?? DEFAULT_SAFE_AREA.right,
    bottom: options.bottom ?? DEFAULT_SAFE_AREA.bottom
  }
}

type StretchRelation = {
  node: BoardSafetyNode
  parent: BoardSafetyNode
  left: number
  right: number
  top: number
  bottom: number
  stretchX: boolean
  stretchY: boolean
  structural: boolean
}

function geometricBounds(
  node: BoardSafetyNode,
  parentX: number,
  parentY: number
): BoardContentBounds {
  const x = parentX + node.x
  const y = parentY + node.y
  return { left: x, top: y, right: x + node.width, bottom: y + node.height }
}

function renderedBounds(
  node: BoardSafetyNode,
  parentX: number,
  parentY: number,
  rootAbsolute: BoardRect | null
): BoardContentBounds {
  const geometric = geometricBounds(node, parentX, parentY)
  const absolute = node.absoluteRenderBounds
  if (absolute && rootAbsolute) {
    const rendered = {
      left: absolute.x - rootAbsolute.x,
      top: absolute.y - rootAbsolute.y,
      right: absolute.x - rootAbsolute.x + absolute.width,
      bottom: absolute.y - rootAbsolute.y + absolute.height
    }
    // Figma may report render bounds clipped by an ancestor. Never let that
    // smaller visual rectangle erase the node's real geometry. Conversely,
    // shadows and outlines may extend beyond geometry, so keep both.
    return {
      left: Math.min(geometric.left, rendered.left),
      top: Math.min(geometric.top, rendered.top),
      right: Math.max(geometric.right, rendered.right),
      bottom: Math.max(geometric.bottom, rendered.bottom)
    }
  }
  return geometric
}

function captureStretchRelations(root: BoardSafetyNode): StretchRelation[] {
  const relations: StretchRelation[] = []
  const visit = (parent: BoardSafetyNode): void => {
    for (const node of parent.children ?? []) {
      const left = node.x
      const top = node.y
      const right = parent.width - (node.x + node.width)
      const bottom = parent.height - (node.y + node.height)
      // Stretch is an explicit layout contract. Geometry alone is not enough:
      // a real control or content row may also happen to span the board width.
      const stretchX = node.constraints?.horizontal === 'STRETCH'
      const stretchY = node.constraints?.vertical === 'STRETCH'
      const structural = stretchX || stretchY
      relations.push({
        node,
        parent,
        left,
        right,
        top,
        bottom,
        stretchX,
        stretchY,
        structural
      })
      visit(node)
    }
  }
  visit(root)
  return relations
}

function includeNode(
  bounds: BoardContentBounds,
  measured: { count: number },
  node: BoardSafetyNode,
  parentX: number,
  parentY: number,
  rootAbsolute: BoardRect | null,
  structuralNodes: ReadonlySet<BoardSafetyNode>
): void {
  if (node.visible === false) return
  const geometric = geometricBounds(node, parentX, parentY)
  const rendered = renderedBounds(node, parentX, parentY, rootAbsolute)
  if (!structuralNodes.has(node)) {
    bounds.left = Math.min(bounds.left, rendered.left)
    bounds.top = Math.min(bounds.top, rendered.top)
    bounds.right = Math.max(bounds.right, rendered.right)
    bounds.bottom = Math.max(bounds.bottom, rendered.bottom)
    measured.count += 1
  }
  const intentionalComponentClip = node.clipsContent === true &&
    (node.type === 'INSTANCE' ||
      node.type === 'COMPONENT' ||
      node.type === 'COMPONENT_SET')
  if (intentionalComponentClip) return
  // This is a layout audit, not a screenshot crop. A stale nested
  // `clipsContent=true` must not hide overflowing labels from the final fit.
  for (const child of node.children ?? []) {
    includeNode(
      bounds,
      measured,
      child,
      geometric.left,
      geometric.top,
      rootAbsolute,
      structuralNodes
    )
  }
}

export function measureBoardContent(
  children: readonly BoardSafetyNode[],
  root?: BoardSafetyNode
): BoardContentBounds | null {
  if (children.length === 0) return null
  const bounds: BoardContentBounds = {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY
  }
  const measured = { count: 0 }
  const relations = root ? captureStretchRelations(root) : []
  const structuralNodes = new Set(
    relations.filter(item => item.structural).map(item => item.node)
  )
  const rootAbsolute = root?.absoluteBoundingBox ??
    (root ? { x: root.x, y: root.y, width: root.width, height: root.height } : null)
  for (const child of children) {
    includeNode(
      bounds,
      measured,
      child,
      0,
      0,
      rootAbsolute,
      structuralNodes
    )
  }
  return measured.count > 0 ? bounds : null
}

export function auditBoardSafeArea(
  board: BoardSafetyNode,
  options: Partial<BoardSafetyArea> = {}
): BoardSafetyAudit {
  const safeArea = resolveSafeArea(options)
  const bounds = measureBoardContent(board.children ?? [], board)
  if (!bounds) {
    return {
      safe: true,
      bounds: null,
      available: null,
      violations: []
    }
  }
  const available: BoardSafetyArea = {
    left: bounds.left,
    top: bounds.top,
    right: board.width - bounds.right,
    bottom: board.height - bounds.bottom
  }
  const violations = (Object.keys(safeArea) as (keyof BoardSafetyArea)[])
    .flatMap(edge =>
      available[edge] + SAFETY_EPSILON < safeArea[edge]
        ? [{ edge, available: available[edge], required: safeArea[edge] }]
        : []
    )
  return {
    safe: violations.length === 0,
    bounds,
    available,
    violations
  }
}

function assertBoardSafeArea(
  board: BoardSafetyNode,
  options: Partial<BoardSafetyArea>
): BoardSafetyAudit {
  const audit = auditBoardSafeArea(board, options)
  if (audit.safe) return audit
  const boardName = board.name ? ` "${board.name}"` : ''
  const details = audit.violations.map(violation =>
    `${violation.edge} ${violation.required}px required ` +
    `(available ${Math.round(violation.available * 100) / 100}px)`
  ).join('; ')
  throw new Error(`Board${boardName} failed geometry safety: ${details}`)
}

function resizeNode(node: BoardSafetyNode, width: number, height: number): void {
  if (node.resize) node.resize(Math.max(0.01, width), Math.max(0.01, height))
  else {
    node.width = Math.max(0.01, width)
    node.height = Math.max(0.01, height)
  }
}

function syncStretchRelations(relations: readonly StretchRelation[]): void {
  for (const relation of relations) {
    if (!relation.structural) continue
    const width = relation.stretchX
      ? relation.parent.width - relation.left - relation.right
      : relation.node.width
    const height = relation.stretchY
      ? relation.parent.height - relation.top - relation.bottom
      : relation.node.height
    if (
      Math.abs(width - relation.node.width) > EPSILON ||
      Math.abs(height - relation.node.height) > EPSILON
    ) {
      resizeNode(relation.node, width, height)
    }
  }
}

function shiftContentWithin(
  parent: BoardSafetyNode,
  structuralNodes: ReadonlySet<BoardSafetyNode>,
  dx: number,
  dy: number
): void {
  if (parent.layoutMode && parent.layoutMode !== 'NONE') {
    if (dx > 0) parent.paddingLeft = (parent.paddingLeft ?? 0) + dx
    if (dy > 0) parent.paddingTop = (parent.paddingTop ?? 0) + dy
    return
  }
  for (const node of parent.children ?? []) {
    if (node.visible === false) continue
    if (structuralNodes.has(node)) {
      shiftContentWithin(node, structuralNodes, dx, dy)
      continue
    }
    node.x += dx
    node.y += dy
  }
}

export function fitBoardToContent(
  board: ResizableBoard,
  options: BoardFitOptions = {}
): { width: number; height: number; bounds: BoardContentBounds | null } {
  const safeArea = resolveSafeArea(options)
  const minWidth = options.minWidth ?? board.width
  const minHeight = options.minHeight ?? board.height
  const maxPasses = Math.max(1, Math.min(3, options.maxPasses ?? 3))
  const relations = captureStretchRelations(board)
  const structuralNodes = new Set(
    relations.filter(item => item.structural).map(item => item.node)
  )

  if (board.layoutMode && board.layoutMode !== 'NONE') {
    board.primaryAxisSizingMode = 'FIXED'
    board.counterAxisSizingMode = 'FIXED'
  }

  let bounds = measureBoardContent(board.children ?? [], board)
  if (!bounds) {
    board.resize(minWidth, minHeight)
    syncStretchRelations(relations)
    return { width: minWidth, height: minHeight, bounds: null }
  }

  let targetWidth = board.width
  let targetHeight = board.height
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const dx = Math.max(0, safeArea.left - bounds.left)
    const dy = Math.max(0, safeArea.top - bounds.top)
    if (dx > 0 || dy > 0) {
      shiftContentWithin(board, structuralNodes, dx, dy)
      const shiftedBounds = measureBoardContent(board.children ?? [], board)
      if (shiftedBounds) bounds = shiftedBounds
    }
    targetWidth = Math.max(
      minWidth,
      Math.ceil(bounds.right + safeArea.right)
    )
    targetHeight = Math.max(
      minHeight,
      Math.ceil(bounds.bottom + safeArea.bottom)
    )
    board.resize(targetWidth, targetHeight)
    syncStretchRelations(relations)
    const nextBounds = measureBoardContent(board.children ?? [], board)
    if (!nextBounds) break
    const stable = Math.max(0, safeArea.left - nextBounds.left) <= EPSILON &&
      Math.max(0, safeArea.top - nextBounds.top) <= EPSILON &&
      Math.abs(
        Math.max(minWidth, Math.ceil(nextBounds.right + safeArea.right)) -
        targetWidth
      ) <= EPSILON &&
      Math.abs(
        Math.max(minHeight, Math.ceil(nextBounds.bottom + safeArea.bottom)) -
        targetHeight
      ) <= EPSILON
    bounds = nextBounds
    if (stable) break
  }
  const audit = assertBoardSafeArea(board, safeArea)
  return { width: board.width, height: board.height, bounds: audit.bounds }
}

function geometrySignature(
  board: BoardSafetyNode,
  bounds: BoardContentBounds | null
): string {
  const stableNumber = (value: number): number =>
    Math.round(value / SAFETY_EPSILON) * SAFETY_EPSILON
  return JSON.stringify({
    width: stableNumber(board.width),
    height: stableNumber(board.height),
    bounds: bounds
      ? {
          left: stableNumber(bounds.left),
          top: stableNumber(bounds.top),
          right: stableNumber(bounds.right),
          bottom: stableNumber(bounds.bottom)
        }
      : null
  })
}

async function waitForFigmaLayout(): Promise<void> {
  // Figma can publish auto-layout coordinates and absolute render bounds on
  // the next plugin event-loop turn, especially after a parent frame resize.
  await Promise.resolve()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

export async function fitBoardToContentSettled(
  board: ResizableBoard,
  options: SettledBoardFitOptions = {}
): Promise<{ width: number; height: number; bounds: BoardContentBounds | null }> {
  const safeArea = resolveSafeArea(options)
  const settle = options.settle ?? waitForFigmaLayout
  const maxSettlementPasses = Math.max(
    2,
    Math.min(12, options.maxSettlementPasses ?? 8)
  )
  const minSettlementPasses = Math.max(
    1,
    Math.min(maxSettlementPasses, options.minSettlementPasses ?? 4)
  )
  const stablePasses = Math.max(
    2,
    Math.min(maxSettlementPasses, options.stablePasses ?? 2)
  )

  // Let builders, font metrics and auto-layout finish publishing their first
  // geometry before freezing and fitting the board.
  await settle()
  let result = fitBoardToContent(board, options)
  let previousSignature: string | null = null
  let consecutiveStablePasses = 0

  for (let pass = 0; pass < maxSettlementPasses; pass += 1) {
    await settle()
    const audit = auditBoardSafeArea(board, safeArea)
    if (!audit.safe) {
      result = fitBoardToContent(board, options)
      previousSignature = null
      consecutiveStablePasses = 0
      continue
    }

    const signature = geometrySignature(board, audit.bounds)
    if (signature === previousSignature) consecutiveStablePasses += 1
    else consecutiveStablePasses = 1
    const observedSettlementPasses = pass + 1
    if (
      consecutiveStablePasses >= stablePasses &&
      observedSettlementPasses >= minSettlementPasses
    ) {
      return {
        width: board.width,
        height: board.height,
        bounds: audit.bounds
      }
    }

    // A safe but changed geometry can still mean that text wrapping or a
    // nested auto-layout row has just settled. Refit it once, then require
    // another stable observation before accepting the board.
    if (previousSignature !== null && signature !== previousSignature) {
      result = fitBoardToContent(board, options)
      consecutiveStablePasses = 0
    }
    previousSignature = signature
  }

  const finalAudit = assertBoardSafeArea(board, safeArea)
  const boardName = board.name ? ` "${board.name}"` : ''
  throw new Error(
    `Board${boardName} geometry did not settle after ` +
    `${maxSettlementPasses} asynchronous layout passes ` +
    `(last size ${result.width}×${result.height}, ` +
    `bounds ${JSON.stringify(finalAudit.bounds)})`
  )
}

export async function finalizeBoardsSafeAreaSettled(
  targets: readonly SettledBoardFitTarget[],
  options: {
    settle?: () => Promise<void>
  } = {}
): Promise<void> {
  const settle = options.settle ?? waitForFigmaLayout

  // All boards share one final event-loop checkpoint so a late font or nested
  // auto-layout update cannot hide behind a board that settled earlier.
  await settle()
  const unsafeTargets = targets.filter(target =>
    !auditBoardSafeArea(target.board, target.options).safe
  )
  for (const target of unsafeTargets) {
    await fitBoardToContentSettled(target.board, target.options)
  }

  // Re-audit every board after the repairs. If any geometry publishes even
  // later, fail the import instead of leaving a visibly clipped half-result.
  await settle()
  for (const target of targets) {
    assertBoardSafeArea(target.board, target.options ?? {})
  }
}

type BoardRow<T extends BoardSafetyNode> = {
  originalY: number
  boards: T[]
}

/**
 * Legacy coordinate-based reflow kept for old tests and old callers. New import
 * code uses layoutBoardRows so stale canvas coordinates never define semantics.
 */
export function reflowBoards<T extends BoardSafetyNode>(
  boards: readonly T[],
  options: {
    gap?: number
    rowTolerance?: number
  } = {}
): T[] {
  const gap = options.gap ?? 80
  const rowTolerance = options.rowTolerance ?? 40
  const ordered = [...boards].sort((left, right) =>
    left.y - right.y || left.x - right.x
  )
  const rows: BoardRow<T>[] = []
  for (const board of ordered) {
    const row = rows.find(candidate =>
      Math.abs(candidate.originalY - board.y) <= rowTolerance
    )
    if (row) row.boards.push(board)
    else rows.push({ originalY: board.y, boards: [board] })
  }
  rows.sort((left, right) => left.originalY - right.originalY)

  let previousBottom = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    const y = Number.isFinite(previousBottom)
      ? Math.max(row.originalY, previousBottom + gap)
      : row.originalY
    const rowBoards = row.boards.sort((left, right) => left.x - right.x)
    let previousRight = Number.NEGATIVE_INFINITY
    for (const board of rowBoards) {
      board.y = y
      board.x = Number.isFinite(previousRight)
        ? Math.max(board.x, previousRight + gap)
        : board.x
      previousRight = board.x + board.width
    }
    previousBottom = Math.max(...rowBoards.map(board => board.y + board.height))
  }
  return ordered
}

export function layoutBoardRows<T extends BoardSafetyNode>(
  items: readonly BoardRowItem<T>[],
  options: {
    startX?: number
    startY?: number
    gap?: number
  } = {}
): T[] {
  const startX = options.startX ?? 100
  const startY = options.startY ?? 100
  const gap = options.gap ?? 80
  const rows = new Map<number, BoardRowItem<T>[]>()
  for (const item of items) {
    const row = rows.get(item.row) ?? []
    row.push(item)
    rows.set(item.row, row)
  }
  let y = startY
  const ordered: T[] = []
  for (const rowIndex of [...rows.keys()].sort((left, right) => left - right)) {
    const row = (rows.get(rowIndex) ?? [])
      .sort((left, right) => left.order - right.order)
    let x = startX
    let rowHeight = 0
    for (const item of row) {
      item.board.x = x
      item.board.y = y
      ordered.push(item.board)
      x += item.board.width + gap
      rowHeight = Math.max(rowHeight, item.board.height)
    }
    y += rowHeight + gap
  }
  return ordered
}
