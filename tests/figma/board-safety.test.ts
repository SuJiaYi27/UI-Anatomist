import { describe, expect, it } from 'vitest'
import {
  auditBoardSafeArea,
  finalizeBoardsSafeAreaSettled,
  fitBoardToContent,
  fitBoardToContentSettled,
  layoutBoardRows,
  measureBoardContent,
  reflowBoards
} from '../../src/figma/board-safety'

describe('board safety', () => {
  it('audits every generated board family with the same four-edge geometry gate', () => {
    const boardNames = [
      'UI-Anatomist / Typography',
      'UI-Anatomist / Border Radii',
      'UI-Anatomist / Shadows',
      'UI-Anatomist / Color Primitives',
      'UI-Anatomist / Semantic Colors',
      'UI-Anatomist / Interactive Colors',
      'UI-Anatomist / Spacing',
      'UI-Anatomist / Interactive Controls',
      'UI-Anatomist / Control Masters',
      'UI-Anatomist / Icons'
    ]

    for (const name of boardNames) {
      const content = {
        x: -12,
        y: 18,
        width: 260,
        height: 160,
        children: [{
          x: 230,
          y: 140,
          width: 120,
          height: 80
        }]
      }
      const structuralBackground = {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        constraints: {
          horizontal: 'STRETCH' as const,
          vertical: 'STRETCH' as const
        },
        resize(width: number, height: number) {
          structuralBackground.width = width
          structuralBackground.height = height
        }
      }
      const board = {
        name,
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        children: [structuralBackground, content],
        resize(width: number, height: number) {
          board.width = width
          board.height = height
        }
      }

      fitBoardToContent(board, {
        minWidth: 1,
        minHeight: 1,
        left: 40,
        top: 40,
        right: 40,
        bottom: 40
      })

      expect(auditBoardSafeArea(board), name).toMatchObject({
        safe: true,
        available: {
          left: 40,
          top: 40,
          right: 40,
          bottom: 40
        },
        violations: []
      })
    }
  })

  it('reports the precise unsafe edges before a board is fitted', () => {
    const board = {
      x: 0,
      y: 0,
      width: 200,
      height: 160,
      children: [{
        x: 20,
        y: 50,
        width: 170,
        height: 90
      }],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
      }
    }

    expect(auditBoardSafeArea(board)).toEqual({
      safe: false,
      bounds: {
        left: 20,
        top: 50,
        right: 190,
        bottom: 140
      },
      available: {
        left: 20,
        top: 50,
        right: 10,
        bottom: 20
      },
      violations: [
        { edge: 'left', available: 20, required: 40 },
        { edge: 'right', available: 10, required: 40 },
        { edge: 'bottom', available: 20, required: 40 }
      ]
    })
  })

  it('does not round a 39px edge up to the required 40px safe area', () => {
    const board = {
      x: 0,
      y: 0,
      width: 178,
      height: 120,
      children: [{
        x: 39,
        y: 40,
        width: 99,
        height: 40
      }]
    }

    expect(auditBoardSafeArea(board)).toMatchObject({
      safe: false,
      violations: [
        { edge: 'left', available: 39, required: 40 }
      ]
    })
  })

  it('fails the final geometry gate when a board refuses the required resize', () => {
    const board = {
      name: 'UI-Anatomist / Typography',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [{
        x: 40,
        y: 40,
        width: 100,
        height: 100
      }],
      resize() {
        // Simulates a stale auto-layout frame that ignores a requested resize.
      }
    }

    expect(() => fitBoardToContent(board, {
      minWidth: 1,
      minHeight: 1
    })).toThrow(/right 40px.*bottom 40px/)
  })

  it('waits for delayed auto-layout rows and refits after resize-triggered reflow', async () => {
    const firstRow = {
      x: 40,
      y: 40,
      width: 120,
      height: 40
    }
    const delayedRow = {
      x: 40,
      y: 120,
      width: 180,
      height: 40,
      visible: false
    }
    const board = {
      name: 'UI-Anatomist / Typography',
      x: 0,
      y: 0,
      width: 260,
      height: 120,
      children: [firstRow, delayedRow],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
      }
    }
    let settleCalls = 0

    await fitBoardToContentSettled(board, {
      minWidth: 1,
      minHeight: 1,
      settle: async () => {
        settleCalls += 1
        if (settleCalls === 1) delayedRow.visible = true
        // The first board resize causes a later text/auto-layout reflow.
        if (settleCalls === 2) delayedRow.y = 220
      }
    })

    expect(settleCalls).toBeGreaterThanOrEqual(4)
    expect(board.height).toBe(300)
    expect(auditBoardSafeArea(board)).toMatchObject({
      safe: true,
      available: {
        left: 40,
        top: 40,
        right: 40,
        bottom: 40
      }
    })
  })

  it('does not accept three quiet observations before a fourth-pass text reflow', async () => {
    const text = {
      x: 40,
      y: 40,
      width: 100,
      height: 20
    }
    const board = {
      name: 'UI-Anatomist / Typography',
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      children: [text],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
      }
    }
    let settleCalls = 0

    await fitBoardToContentSettled(board, {
      minWidth: 1,
      minHeight: 1,
      settle: async () => {
        settleCalls += 1
        if (settleCalls === 4) text.height = 220
      }
    })

    expect(settleCalls).toBeGreaterThanOrEqual(6)
    expect(board.height).toBe(300)
    expect(auditBoardSafeArea(board)).toMatchObject({
      safe: true,
      available: {
        left: 40,
        top: 40,
        right: 40,
        bottom: 40
      },
      violations: []
    })
  })

  it('globally settles every board, refits late overflow and re-audits all four edges', async () => {
    const stableText = {
      x: 40,
      y: 40,
      width: 100,
      height: 20
    }
    const delayedText = {
      x: 40,
      y: 40,
      width: 100,
      height: 20
    }
    const stableBoard = {
      name: 'UI-Anatomist / Border Radii',
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      children: [stableText],
      resize(width: number, height: number) {
        stableBoard.width = width
        stableBoard.height = height
      }
    }
    const delayedBoard = {
      name: 'UI-Anatomist / Typography',
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      children: [delayedText],
      resize(width: number, height: number) {
        delayedBoard.width = width
        delayedBoard.height = height
      }
    }
    let globalSettleCalls = 0

    await finalizeBoardsSafeAreaSettled([
      {
        board: stableBoard,
        options: {
          minWidth: 1,
          minHeight: 1,
          settle: async () => {}
        }
      },
      {
        board: delayedBoard,
        options: {
          minWidth: 1,
          minHeight: 1,
          settle: async () => {}
        }
      }
    ], {
      settle: async () => {
        globalSettleCalls += 1
        if (globalSettleCalls === 1) delayedText.height = 220
      }
    })

    expect(globalSettleCalls).toBe(2)
    expect(delayedBoard.height).toBe(300)
    for (const board of [stableBoard, delayedBoard]) {
      expect(auditBoardSafeArea(board), board.name).toMatchObject({
        safe: true,
        available: {
          left: 40,
          top: 40,
          right: 40,
          bottom: 40
        },
        violations: []
      })
    }
  })

  it('fails closed when a board becomes unsafe again after the final refit', async () => {
    const text = {
      x: 40,
      y: 40,
      width: 100,
      height: 20
    }
    const board = {
      name: 'UI-Anatomist / Typography',
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      children: [text],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
      }
    }
    let globalSettleCalls = 0

    await expect(finalizeBoardsSafeAreaSettled([
      {
        board,
        options: {
          minWidth: 1,
          minHeight: 1,
          settle: async () => {}
        }
      }
    ], {
      settle: async () => {
        globalSettleCalls += 1
        text.height = globalSettleCalls === 1 ? 220 : 420
      }
    })).rejects.toThrow(/bottom 40px/)
  })

  it('converges after delayed text wrapping reflows every generated board family', async () => {
    const boardNames = [
      'UI-Anatomist / Typography',
      'UI-Anatomist / Border Radii',
      'UI-Anatomist / Shadows',
      'UI-Anatomist / Color Primitives',
      'UI-Anatomist / Semantic Colors',
      'UI-Anatomist / Interactive Colors',
      'UI-Anatomist / Spacing',
      'UI-Anatomist / Interactive Controls',
      'UI-Anatomist / Control Masters',
      'UI-Anatomist / Icons'
    ]

    for (const name of boardNames) {
      const wrappedText = {
        x: 0,
        y: 0,
        width: 140,
        height: 20
      }
      const followingRow = {
        x: 0,
        y: 44,
        width: 140,
        height: 40
      }
      const stack = {
        x: 20,
        y: 20,
        width: 140,
        height: 84,
        children: [wrappedText, followingRow]
      }
      let resizeCalls = 0
      const board = {
        name,
        x: 0,
        y: 0,
        width: 200,
        height: 124,
        children: [stack],
        resize(width: number, height: number) {
          resizeCalls += 1
          board.width = width
          board.height = height
        }
      }
      let settleCalls = 0

      await fitBoardToContentSettled(board, {
        minWidth: 1,
        minHeight: 1,
        maxSettlementPasses: 8,
        stablePasses: 2,
        settle: async () => {
          settleCalls += 1
          const layoutStage = Math.min(3, Math.max(0, settleCalls - 1))
          wrappedText.height = 20 + layoutStage * 40
          followingRow.y = wrappedText.y + wrappedText.height + 24
          stack.height = followingRow.y + followingRow.height
        }
      })

      expect(resizeCalls, name).toBeGreaterThanOrEqual(4)
      expect(settleCalls, name).toBeGreaterThanOrEqual(6)
      expect(auditBoardSafeArea(board), name).toMatchObject({
        safe: true,
        available: {
          left: 40,
          top: 40,
          right: 40,
          bottom: 40
        }
      })
    }
  })

  it('remeasures current absolute bounds after asynchronous Figma geometry updates', async () => {
    const child = {
      x: 40,
      y: 40,
      width: 100,
      height: 20,
      absoluteRenderBounds: { x: 140, y: 140, width: 100, height: 20 }
    }
    const board = {
      x: 100,
      y: 100,
      width: 180,
      height: 100,
      absoluteBoundingBox: { x: 100, y: 100, width: 180, height: 100 },
      children: [child],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
        board.absoluteBoundingBox.width = width
        board.absoluteBoundingBox.height = height
      }
    }
    let settleCalls = 0

    await fitBoardToContentSettled(board, {
      minWidth: 1,
      minHeight: 1,
      settle: async () => {
        settleCalls += 1
        if (settleCalls === 2) {
          // Simulates Figma moving the board on canvas while updating a
          // delayed render bound. Relative geometry must stay board-local.
          board.absoluteBoundingBox.x = 500
          board.absoluteBoundingBox.y = 700
          child.absoluteRenderBounds = {
            x: 540,
            y: 740,
            width: 100,
            height: 220
          }
        }
      }
    })

    expect(board.height).toBe(300)
    expect(board.width).toBe(180)
    expect(auditBoardSafeArea(board)).toMatchObject({ safe: true })
  })

  it('measures the deepest rendered descendant rather than trusting its parent frame', () => {
    expect(measureBoardContent([{
      x: 40,
      y: 80,
      width: 400,
      height: 40,
      children: [{
        x: 180,
        y: 24,
        width: 320,
        height: 32
      }]
    }])).toEqual({
      left: 40,
      top: 80,
      right: 540,
      bottom: 136
    })
  })

  it('ignores hidden descendants when calculating the rendered safe area', () => {
    expect(measureBoardContent([{
      x: 40,
      y: 40,
      width: 100,
      height: 40,
      children: [{
        x: 0,
        y: 1000,
        width: 100,
        height: 100,
        visible: false
      }]
    }])?.bottom).toBe(80)
  })

  it('returns null when every descendant is hidden', () => {
    expect(measureBoardContent([{
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      visible: false
    }])).toBeNull()
  })

  it('prefers rendered bounds and still discovers descendants hidden by stale layout clipping', () => {
    const root = {
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      absoluteBoundingBox: { x: 100, y: 100, width: 400, height: 300 },
      children: [{
        x: 40,
        y: 40,
        width: 200,
        height: 100,
        clipsContent: true,
        children: [{
          x: 180,
          y: 80,
          width: 80,
          height: 80,
          absoluteRenderBounds: { x: 310, y: 210, width: 120, height: 120 }
        }]
      }]
    }

    expect(measureBoardContent(root.children, root)).toEqual({
      left: 40,
      top: 40,
      right: 330,
      bottom: 230
    })
  })

  it('does not expand a board past an intentionally clipped component instance', () => {
    expect(measureBoardContent([{
      type: 'INSTANCE',
      x: 40,
      y: 40,
      width: 100,
      height: 60,
      clipsContent: true,
      children: [{
        x: 0,
        y: 1000,
        width: 100,
        height: 100
      }]
    }])).toEqual({
      left: 40,
      top: 40,
      right: 140,
      bottom: 100
    })
  })

  it('unions geometric and rendered bounds so clipping cannot hide real overflow', () => {
    const root = {
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      absoluteBoundingBox: { x: 100, y: 100, width: 400, height: 300 },
      children: [{
        x: 40,
        y: 40,
        width: 200,
        height: 100,
        children: [{
          x: 180,
          y: 80,
          width: 160,
          height: 80,
          // Simulates Figma reporting only the clipped rendered portion even
          // though the actual node geometry continues farther to the right.
          absoluteRenderBounds: { x: 320, y: 220, width: 40, height: 40 }
        }]
      }]
    }

    expect(measureBoardContent(root.children, root)).toEqual({
      left: 40,
      top: 40,
      right: 380,
      bottom: 200
    })
  })

  it('never treats an ordinary full-width content row as a stretchable background', () => {
    const leaf = {
      name: 'Visible content',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      resize(width: number, height: number) {
        leaf.width = width
        leaf.height = height
      }
    }
    const row = {
      name: 'Content row',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      children: [leaf],
      resize(width: number, height: number) {
        row.width = width
        row.height = height
      }
    }
    const board = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [row],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
      }
    }

    fitBoardToContent(board, {
      left: 0,
      top: 0,
      right: 40,
      bottom: 40,
      minWidth: 1,
      minHeight: 1
    })
    const first = { width: board.width, row: row.width, leaf: leaf.width }
    fitBoardToContent(board, {
      left: 0,
      top: 0,
      right: 40,
      bottom: 40,
      minWidth: 1,
      minHeight: 1
    })

    expect(first).toEqual({ width: 140, row: 100, leaf: 100 })
    expect(board.width).toBe(140)
    expect(row.width).toBe(100)
    expect(leaf.width).toBe(100)
  })

  it('uses auto-layout padding instead of writing child coordinates inside a stretch section', () => {
    let childX = 0
    let childY = 0
    const child = {
      name: 'Visible content',
      get x() { return childX },
      set x(_value: number) {
        throw new Error('Auto-layout child x must not be written')
      },
      get y() { return childY },
      set y(_value: number) {
        throw new Error('Auto-layout child y must not be written')
      },
      width: 60,
      height: 20
    }
    let paddingLeft = 0
    let paddingTop = 0
    const section = {
      name: 'Theme section',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      layoutMode: 'VERTICAL' as const,
      constraints: { horizontal: 'STRETCH' as const, vertical: 'MIN' as const },
      get paddingLeft() { return paddingLeft },
      set paddingLeft(value: number) {
        childX += value - paddingLeft
        paddingLeft = value
      },
      get paddingTop() { return paddingTop },
      set paddingTop(value: number) {
        childY += value - paddingTop
        paddingTop = value
      },
      children: [child],
      resize(width: number, height: number) {
        section.width = width
        section.height = height
      }
    }
    const board = {
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      children: [section],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
      }
    }

    const result = fitBoardToContent(board, {
      left: 40,
      top: 40,
      right: 40,
      bottom: 40,
      minWidth: 1,
      minHeight: 1
    })

    expect(section.paddingLeft).toBe(40)
    expect(section.paddingTop).toBe(40)
    expect(childX).toBe(40)
    expect(childY).toBe(40)
    expect(result.bounds).toMatchObject({ left: 40, top: 40 })
  })

  it('fits all four safe edges, freezes both auto-layout axes and can repair an oversized board', () => {
    let sizingModesWhenResized = ''
    const content = {
      x: 8,
      y: 12,
      width: 500,
      height: 700
    }
    let paddingLeft = 0
    let paddingTop = 0
    const board = {
      x: 100,
      y: 100,
      width: 900,
      height: 900,
      layoutMode: 'VERTICAL' as const,
      primaryAxisSizingMode: 'AUTO' as const,
      counterAxisSizingMode: 'AUTO' as const,
      get paddingLeft() { return paddingLeft },
      set paddingLeft(value: number) {
        content.x += value - paddingLeft
        paddingLeft = value
      },
      get paddingTop() { return paddingTop },
      set paddingTop(value: number) {
        content.y += value - paddingTop
        paddingTop = value
      },
      children: [content],
      resize(width: number, height: number) {
        sizingModesWhenResized =
          `${board.primaryAxisSizingMode}/${board.counterAxisSizingMode}`
        board.width = width
        board.height = height
      }
    }

    expect(fitBoardToContent(board, {
      left: 40,
      top: 40,
      right: 40,
      bottom: 40,
      minWidth: 543,
      minHeight: 646
    })).toMatchObject({
      width: 580,
      height: 780
    })
    expect(board.primaryAxisSizingMode).toBe('FIXED')
    expect(board.counterAxisSizingMode).toBe('FIXED')
    expect(sizingModesWhenResized).toBe('FIXED/FIXED')
    expect(board.paddingLeft).toBe(32)
    expect(board.paddingTop).toBe(28)
  })

  it('does not count a full-width structural container as content and resizes it with the board', () => {
    const section = {
      name: 'Dark',
      type: 'FRAME',
      x: 0,
      y: 100,
      width: 400,
      height: 200,
      constraints: {
        horizontal: 'STRETCH' as const,
        vertical: 'STRETCH' as const
      },
      children: [{
        x: 40,
        y: 40,
        width: 300,
        height: 180
      }],
      resize(width: number, height: number) {
        section.width = width
        section.height = height
      }
    }
    const board = {
      name: 'UI-Anatomist / Icons',
      type: 'FRAME',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      layoutMode: 'NONE' as const,
      children: [section],
      resize(width: number, height: number) {
        board.width = width
        board.height = height
      }
    }

    expect(fitBoardToContent(board, {
      left: 40,
      top: 40,
      right: 40,
      bottom: 40,
      minWidth: 400,
      minHeight: 200
    })).toMatchObject({
      width: 400,
      height: 360
    })
    expect(section.width).toBe(400)
    expect(section.height).toBe(260)
  })

  it('reflows rows after preceding boards grow while preserving intended rows', () => {
    const typography = { x: 100, y: 100, width: 543, height: 1200 }
    const radii = { x: 723, y: 100, width: 640, height: 209 }
    const shadows = { x: 100, y: 830, width: 1513, height: 227 }
    const controls = { x: 100, y: 1200, width: 1513, height: 900 }
    const masters = { x: 1693, y: 1200, width: 1300, height: 1000 }

    reflowBoards([typography, radii, shadows, controls, masters])

    expect(radii.y).toBe(100)
    expect(shadows.y).toBe(1380)
    expect(controls.y).toBe(1687)
    expect(masters.y).toBe(1687)
    expect(masters.x).toBeGreaterThanOrEqual(controls.x + controls.width + 80)
  })

  it('lays out semantic board rows without guessing from stale y coordinates', () => {
    const typography = { x: 900, y: 800, width: 543, height: 1200 }
    const radii = { x: 100, y: 5100, width: 640, height: 209 }
    const shadows = { x: 200, y: 10, width: 1513, height: 227 }
    const controls = { x: 99, y: 99, width: 1513, height: 900 }
    const masters = { x: 9999, y: -100, width: 1300, height: 1000 }

    layoutBoardRows([
      { board: typography, row: 0, order: 0 },
      { board: radii, row: 0, order: 1 },
      { board: shadows, row: 1, order: 0 },
      { board: controls, row: 2, order: 0 },
      { board: masters, row: 2, order: 1 }
    ], { startX: 100, startY: 100, gap: 80 })

    expect(typography).toMatchObject({ x: 100, y: 100 })
    expect(radii).toMatchObject({ x: 723, y: 100 })
    expect(shadows).toMatchObject({ x: 100, y: 1380 })
    expect(controls).toMatchObject({ x: 100, y: 1687 })
    expect(masters).toMatchObject({ x: 1693, y: 1687 })
  })
})
