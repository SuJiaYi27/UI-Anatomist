import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Figma control transaction wiring', () => {
  it('plans, applies, builds, reports and cleans controls in the unified import', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('createControlImportPlan')
    expect(source).toContain('applyControlImportPlan')
    expect(source).toContain('buildControlBoard')
    expect(source).toContain('controlCreated:')
    expect(source).toContain('controlRemoved:')
    expect(source).toContain('interactiveControls: controlBoard')
    expect(source).toMatch(
      /supportsFigmaBoardCapability\(\s*data\.schemaVersion,\s*'controls'\s*\)/
    )
  })

  it('creates Icons before Controls and wires matching SVGs as component instances', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source.indexOf('const iconApplied = await applyIconImportPlan'))
      .toBeLessThan(source.indexOf('const controlApplied = await applyControlImportPlan'))
    expect(source).toContain('createIconInstance:')
    expect(source).toContain('.createInstance()')
    expect(source).toContain('canReuseIconComponentInControl(match.source)')
  })

  it('cleans factory-created rollback Frames and Icon instances when setup fails', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain(
      'try {\n    backup.name = name\n    backup.visible = false'
    )
    expect(source).toMatch(
      /const instance = match\.component\.createInstance\(\)[\s\S]{0,240}try \{[\s\S]{0,240}setExplicitVariableModeForCollection[\s\S]{0,240}catch \(error\) \{[\s\S]{0,120}instance\.remove\(\)/
    )
  })

  it('creates bounded composite components after atomic controls and before stale cleanup', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('createCompositeImportPlan')
    expect(source).toContain('applyCompositeImportPlan')
    expect(source).toContain('createInstance: component =>')
    const controlIndex = source.indexOf(
      'const controlApplied = await applyControlImportPlan'
    )
    const compositeIndex = source.indexOf(
      'const compositeApplied = await applyCompositeImportPlan'
    )
    const cleanupIndex = source.indexOf(
      'const removed = await removeStaleAssets'
    )
    expect(controlIndex).toBeGreaterThan(-1)
    expect(compositeIndex).toBeGreaterThan(controlIndex)
    expect(cleanupIndex).toBeGreaterThan(compositeIndex)
    expect(source).toContain(
      'data.controls.length,\n          compositeApplied.applied'
    )
    expect(source).toContain(
      'controlBoard,\n        compositeApplied.applied'
    )
  })

  it('normalizes Figma mixed paints before binding Icon color variables', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('Array.isArray(node.fills)')
    expect(source).toContain('Array.isArray(node.strokes)')
    expect(source).not.toContain('(node.fills as Paint[]).map')
    expect(source).not.toContain('(node.strokes as Paint[]).map')
  })

  it('skips an empty Icons board and removes only the owned board for that origin', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('iconApplied.applied.length > 0')
    expect(source).toContain('removeOwnedIconBoard(data.source.origin)')
  })

  it('waits for every generated board to settle with four-edge safety before semantic row layout', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('fitBoardToContentSettled')
    expect(source).toContain('finalizeBoardsSafeAreaSettled')
    expect(source).toContain('layoutBoardRows')
    expect(source).toContain('const generatedBoards =')
    expect(source).toContain('const boardFitTargets =')
    expect(source).toContain('for (const target of boardFitTargets)')
    expect(source).toContain('await fitBoardToContentSettled(target.board, target.options)')
    expect(source).toContain('await finalizeBoardsSafeAreaSettled(boardFitTargets)')
    expect(source).toContain('left: 40')
    expect(source).toContain('top: 40')
    expect(source).toContain('right: 40')
    expect(source).toContain('bottom: 40')
    const firstGateIndex = source.indexOf('for (const target of boardFitTargets)')
    const finalGateIndex = source.indexOf(
      'await finalizeBoardsSafeAreaSettled(boardFitTargets)'
    )
    const layoutIndex = source.indexOf('layoutBoardRows(boardLayoutItems')
    expect(firstGateIndex).toBeLessThan(finalGateIndex)
    expect(finalGateIndex).toBeLessThan(layoutIndex)
  })

  it('anchors each source cluster before builders mutate existing board positions', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('planBoardClusterAnchor')
    expect(source).toContain('const existingBoardClusterAnchor')
    expect(source.indexOf('const existingBoardClusterAnchor'))
      .toBeLessThan(source.indexOf('const typographyBoard'))
    expect(source).toContain('const otherSourceBoardObstacles')
    expect(source).toContain('startX: clusterAnchor.x')
    expect(source).toContain('startY: clusterAnchor.y')
    expect(source).not.toContain('const clusterStartY')
  })

  it('cleans stale variants and reflows surviving sets before building control boards', () => {
    const source = readFileSync(
      new URL('../../src/figma/code.ts', import.meta.url),
      'utf8'
    )
    const cleanupIndex = source.indexOf(
      'const removed = await removeStaleAssets'
    )
    const reflowIndex = source.indexOf(
      'reflowAppliedControlComponentSets(controlApplied.applied)'
    )
    const controlBoardIndex = source.indexOf('const controlBoard =')

    expect(cleanupIndex).toBeGreaterThan(-1)
    expect(reflowIndex).toBeGreaterThan(cleanupIndex)
    expect(controlBoardIndex).toBeGreaterThan(reflowIndex)
  })
})
