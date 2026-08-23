import { describe, expect, it } from 'vitest'

import { designerFacingCompositeIds } from '../../src/figma/composite-presentation'
import type { CompositeToken, ControlToken } from '../../src/shared/schema'

const id = (character: string) => `sha256:${character.repeat(64)}`

function control(
  character: string,
  kind: 'text' | 'anonymous-icon' | 'icon-only'
): ControlToken {
  return {
    id: id(character),
    groupId: id(character),
    templateId: id(character),
    logicalControlId: id(character),
    instanceId: id(character),
    name: 'button-tertiary-sm',
    family: 'button',
    state: 'default',
    intent: 'tertiary',
    size: 'sm',
    geometry: {
      height: 32,
      minWidth: kind === 'text' ? 220 : null,
      padding: { top: 6, right: 8, bottom: 6, left: 8 },
      gap: 8,
      radius: 6,
      borderWidth: 0
    },
    appearance: {
      background: { r: 0, g: 0, b: 0, a: 0 },
      foreground: { r: 0, g: 0, b: 0, a: 1 },
      border: { r: 0, g: 0, b: 0, a: 0 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    typography: {
      fontFamilyStack: ['Arial'], fontStyle: 'normal', fontSizePx: 14,
      fontWeight: 400, lineHeightPx: 20, letterSpacingPx: 0
    },
    slots: kind === 'text'
      ? { leading: null, trailing: null }
      : { leading: { width: 16, height: 16, assetType: 'ui-icon' }, trailing: null },
    content: {
      kind: kind === 'anonymous-icon'
        ? 'icon-leading'
        : kind === 'icon-only' ? 'icon-only' : 'text-only'
    },
    ...(kind === 'text'
      ? { sampleText: { value: 'Safe action', source: 'visible-text' as const } }
      : {}),
    layout: { widthBehavior: 'hug' },
    occurrences: 1,
    stateOccurrences: 1
  }
}

function composite(
  character: string,
  controls: ControlToken[],
  patch: Partial<CompositeToken> = {}
): CompositeToken {
  return {
    id: id(character),
    templateId: id(character),
    logicalCompositeId: id(character),
    name: 'menu-vertical',
    kind: 'menu',
    state: 'default',
    geometry: {
      width: 240,
      height: 16 + controls.length * 32,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 0,
      radius: 8,
      borderWidth: 1
    },
    appearance: {
      background: { r: 1, g: 1, b: 1, a: 1 },
      foreground: { r: 0, g: 0, b: 0, a: 1 },
      border: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    layout: {
      direction: 'vertical', align: 'stretch', justify: 'start',
      wrap: false, widthBehavior: 'hug'
    },
    children: controls.map((source, index) => ({
      kind: 'control' as const,
      controlId: source.id,
      instanceId: source.instanceId!,
      state: source.state,
      placement: { x: 8, y: 8 + index * 32, width: 224, height: 32 }
    })),
    occurrences: 1,
    stateOccurrences: 1,
    ...patch
  }
}

describe('designerFacingCompositeIds', () => {
  it('keeps a measured single-control footer with real shell and matching padding', () => {
    const search = control('1', 'text')
    const footer = composite('2', [search], {
      kind: 'control-group',
      geometry: {
        width: 256, height: 64,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        gap: 0, radius: 0, borderWidth: 1,
        borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
      },
      children: [{
        kind: 'control', controlId: search.id, instanceId: search.instanceId!,
        state: 'default', placement: { x: 16, y: 16, width: 224, height: 32 }
      }]
    })

    expect(designerFacingCompositeIds([footer], [search])).toEqual(new Set([footer.id]))
  })

  it('keeps a default-only singleton safety shell structural when its parent already presents it', () => {
    const search = control('1', 'text')
    const firstRow = control('3', 'text')
    const secondRow = control('4', 'text')
    const shell = composite('2', [search], {
      kind: 'control-group',
      geometry: {
        width: 256, height: 64,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        gap: 0, radius: 0, borderWidth: 1,
        borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
      },
      children: [{
        kind: 'control', controlId: search.id, instanceId: search.instanceId!,
        state: 'default', placement: { x: 16, y: 16, width: 224, height: 32 }
      }]
    })
    const menu = composite('5', [search, firstRow, secondRow], {
      kind: 'popover',
      geometry: {
        width: 256, height: 144,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0, radius: 12, borderWidth: 0
      },
      layout: {
        direction: 'vertical', align: 'stretch', justify: 'start',
        wrap: false, widthBehavior: 'fill', clipsContent: true
      },
      children: [
        { kind: 'control', controlId: firstRow.id, instanceId: firstRow.instanceId!, state: 'default', placement: { x: 16, y: 8, width: 224, height: 32 } },
        { kind: 'control', controlId: secondRow.id, instanceId: secondRow.instanceId!, state: 'default', placement: { x: 16, y: 40, width: 224, height: 32 } },
        { kind: 'composite', compositeId: shell.id, placement: { x: 0, y: 80, width: 256, height: 64 } }
      ]
    })

    expect(designerFacingCompositeIds(
      [shell, menu],
      [search, firstRow, secondRow]
    )).toEqual(new Set([menu.id]))
  })

  it('keeps a passive singleton shell internal across every state and sample reference of one parent family', () => {
    const search = control('1', 'text')
    const firstRow = control('3', 'text')
    const secondRow = control('4', 'text')
    const shell = composite('2', [search], {
      kind: 'control-group',
      geometry: {
        width: 256, height: 64,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        gap: 0, radius: 0, borderWidth: 1,
        borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
      },
      children: [{
        kind: 'control', controlId: search.id, instanceId: search.instanceId!,
        state: 'default', placement: { x: 16, y: 16, width: 224, height: 32 }
      }]
    })
    const parentLogicalId = id('f')
    const parents = ['5', '6', '7', '8'].map((character, index) => composite(
      character,
      [search, firstRow, secondRow],
      {
        logicalCompositeId: parentLogicalId,
        state: index % 2 === 0 ? 'default' : 'hover',
        kind: 'popover',
        geometry: {
          width: 256, height: 144,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          gap: 0, radius: 12, borderWidth: 0
        },
        layout: {
          direction: 'vertical', align: 'stretch', justify: 'start',
          wrap: false, widthBehavior: 'fill', clipsContent: true
        },
        children: [
          { kind: 'control', controlId: firstRow.id, instanceId: firstRow.instanceId!, state: 'default', placement: { x: 16, y: 8, width: 224, height: 32 } },
          { kind: 'control', controlId: secondRow.id, instanceId: secondRow.instanceId!, state: 'default', placement: { x: 16, y: 40, width: 224, height: 32 } },
          { kind: 'composite', compositeId: shell.id, placement: { x: 0, y: 80, width: 256, height: 64 } }
        ]
      }
    ))

    expect(designerFacingCompositeIds(
      [shell, ...parents],
      [search, firstRow, secondRow]
    )).toEqual(new Set(parents.map(parent => parent.id)))
  })

  it('keeps a nested singleton shell publishable when its own state family contributes reuse evidence', () => {
    const search = control('1', 'text')
    const firstRow = control('7', 'text')
    const secondRow = control('8', 'text')
    const logicalShellId = id('2')
    const defaultShell = composite('3', [search], {
      logicalCompositeId: logicalShellId,
      kind: 'control-group',
      geometry: {
        width: 256, height: 64,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        gap: 0, radius: 0, borderWidth: 1,
        borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
      },
      children: [{
        kind: 'control', controlId: search.id, instanceId: search.instanceId!,
        state: 'default', placement: { x: 16, y: 16, width: 224, height: 32 }
      }]
    })
    const hoverShell = {
      ...defaultShell,
      id: id('4'),
      templateId: id('4'),
      state: 'hover' as const
    }
    const defaultMenu = composite('5', [search, firstRow, secondRow], {
      geometry: {
        width: 256, height: 144,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0, radius: 12, borderWidth: 0
      },
      layout: {
        direction: 'vertical', align: 'stretch', justify: 'start',
        wrap: false, widthBehavior: 'fill', clipsContent: true
      },
      children: [
        { kind: 'control', controlId: firstRow.id, instanceId: firstRow.instanceId!, state: 'default', placement: { x: 16, y: 8, width: 224, height: 32 } },
        { kind: 'control', controlId: secondRow.id, instanceId: secondRow.instanceId!, state: 'default', placement: { x: 16, y: 40, width: 224, height: 32 } },
        { kind: 'composite', compositeId: defaultShell.id, placement: { x: 0, y: 80, width: 256, height: 64 } }
      ]
    })
    const hoverMenu = composite('6', [search, firstRow, secondRow], {
      ...defaultMenu,
      id: id('6'),
      templateId: id('6'),
      state: 'hover',
      children: [
        { kind: 'control', controlId: firstRow.id, instanceId: firstRow.instanceId!, state: 'default', placement: { x: 16, y: 8, width: 224, height: 32 } },
        { kind: 'control', controlId: secondRow.id, instanceId: secondRow.instanceId!, state: 'default', placement: { x: 16, y: 40, width: 224, height: 32 } },
        { kind: 'composite', compositeId: hoverShell.id, placement: { x: 0, y: 80, width: 256, height: 64 } }
      ]
    })

    expect(designerFacingCompositeIds(
      [defaultShell, hoverShell, defaultMenu, hoverMenu],
      [search, firstRow, secondRow]
    )).toEqual(new Set([
      defaultShell.id,
      hoverShell.id,
      defaultMenu.id,
      hoverMenu.id
    ]))
  })

  it('rejects a mostly anonymous icon-leading list but keeps a normal menu', () => {
    const safe = [control('1', 'text'), control('2', 'text')]
    const anonymous = Array.from({ length: 13 }, (_, index) =>
      control((index + 3).toString(16), 'anonymous-icon')
    )
    const noisy = composite('f', [...safe.slice(0, 1), ...anonymous])
    const menu = composite('e', [
      ...safe,
      control('c', 'text'),
      control('d', 'text')
    ])

    expect(designerFacingCompositeIds([noisy, menu], [...safe, ...anonymous,
      control('c', 'text'), control('d', 'text')]))
      .toEqual(new Set([menu.id]))
  })

  it('keeps a complete painted shell whose anonymous rows retain confirmed UI graphics', () => {
    const rows = ['1', '2', '3', '4'].map(character => {
      const row = control(character, 'anonymous-icon')
      row.slots.leading = {
        width: 16,
        height: 16,
        assetType: 'ui-icon',
        vectorSvg: '<svg viewBox="0 0 16 16"><path d="M2 8h12"/></svg>'
      }
      return row
    })
    const shell = composite('5', rows, { kind: 'popover' })
    const shellless = composite('6', rows, {
      appearance: {
        background: { r: 0, g: 0, b: 0, a: 0 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: []
      },
      geometry: {
        width: 240,
        height: 144,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0,
        radius: 0,
        borderWidth: 0
      }
    })

    expect(designerFacingCompositeIds([shell, shellless], rows))
      .toEqual(new Set([shell.id]))
  })

  it('keeps a densely placed painted shell while rejecting sparse and separator-only slices', () => {
    const safeControls = ['1', '2', '3'].map(character =>
      control(character, 'text')
    )
    const safeInput = safeControls[0]!
    const anonymousRows = ['4', '5', '6'].map(character =>
      control(character, 'anonymous-icon')
    )
    const shellChildren = [...safeControls, ...anonymousRows]
    const placedChildren = shellChildren.map((source, index) => ({
      kind: 'control' as const,
      controlId: source.id,
      instanceId: source.instanceId!,
      state: source.state,
      placement: { x: 8, y: 8 + index * 32, width: 224, height: 32 }
    }))
    const completePopover = composite('7', shellChildren, {
      kind: 'popover',
      geometry: {
        width: 240, height: 208,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 12, borderWidth: 0
      },
      appearance: {
        background: { r: 1, g: 1, b: 1, a: 1 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: [{
          kind: 'outer', offsetX: 0, offsetY: 8, blur: 18, spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.12 }
        }]
      },
      children: placedChildren
    })
    const sparsePopover = composite('8', shellChildren, {
      ...completePopover,
      id: id('8'),
      templateId: id('8'),
      logicalCompositeId: id('8'),
      children: placedChildren.map((child, index) =>
        index < 2 ? child : { ...child, placement: undefined }
      )
    })
    const safeAction = control('9', 'text')
    const separatorPanel = composite('a', [safeInput, safeAction, anonymousRows[0]!], {
      kind: 'panel',
      geometry: {
        width: 240, height: 112,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 0, borderWidth: 0
      },
      appearance: {
        background: { r: 0, g: 0, b: 0, a: 0 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: [{
          kind: 'inner', offsetX: 0, offsetY: -1, blur: 0, spread: 0,
          color: { r: 0.8, g: 0.8, b: 0.8, a: 0.7 }
        }]
      }
    })

    expect(designerFacingCompositeIds(
      [completePopover, sparsePopover, separatorPanel],
      [...safeControls, safeAction, ...anonymousRows]
    )).toEqual(new Set([completePopover.id]))
  })

  it('rejects a large shell with one meaningful leaf and an unexplained gap', () => {
    const first = control('1', 'text')
    const second = control('2', 'text')
    const gapped = composite('3', [first, second], {
      geometry: {
        width: 240, height: 272,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [
        {
          kind: 'control', controlId: first.id, instanceId: first.instanceId!,
          state: 'default', placement: { x: 8, y: 8, width: 224, height: 32 }
        },
        {
          kind: 'control', controlId: second.id, instanceId: second.instanceId!,
          state: 'default', placement: { x: 8, y: 232, width: 224, height: 32 }
        }
      ]
    })
    const anonymous = Array.from({ length: 4 }, (_, index) =>
      control((index + 4).toString(16), 'anonymous-icon')
    )
    const shell = composite('9', [first, ...anonymous], {
      geometry: {
        width: 1000, height: 600,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        gap: 0, radius: 12, borderWidth: 1
      }
    })

    expect(designerFacingCompositeIds([gapped, shell], [
      first, second, ...anonymous
    ])).toEqual(new Set())
  })

  it('rejects a list with one unexplained row of leading or trailing space', () => {
    const first = control('1', 'text')
    const second = control('2', 'text')
    const placed = (y: number) => [first, second].map((source, index) => ({
      kind: 'control' as const,
      controlId: source.id,
      instanceId: source.instanceId!,
      state: source.state,
      placement: { x: 8, y: y + index * 32, width: 384, height: 32 }
    }))
    const trailing = composite('3', [first, second], {
      kind: 'list',
      geometry: {
        width: 400, height: 113,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1,
        borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
      },
      children: placed(9)
    })
    const leading = composite('4', [first, second], {
      kind: 'menu',
      geometry: {
        width: 400, height: 113,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: placed(40)
    })

    expect(designerFacingCompositeIds(
      [trailing, leading],
      [first, second]
    )).toEqual(new Set())
  })

  it('rejects unexplained edge space for painted panels and horizontal popovers', () => {
    const first = control('1', 'text')
    const second = control('2', 'text')
    const panel = composite('3', [first, second], {
      kind: 'panel',
      geometry: {
        width: 240, height: 176,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      }
    })
    const popover = composite('4', [first, second], {
      kind: 'popover',
      geometry: {
        width: 400, height: 48,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      layout: {
        direction: 'horizontal', align: 'center', justify: 'start',
        wrap: false, widthBehavior: 'hug'
      },
      children: [first, second].map((source, index) => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state,
        placement: { x: 8 + index * 40, y: 8, width: 32, height: 32 }
      }))
    })

    expect(designerFacingCompositeIds([panel, popover], [first, second]))
      .toEqual(new Set())
  })

  it('validates clipped internal gaps while preserving explained space-between', () => {
    const first = control('1', 'text')
    const second = control('2', 'text')
    const clippedGap = composite('3', [first, second], {
      layout: {
        direction: 'vertical', align: 'stretch', justify: 'start',
        wrap: false, widthBehavior: 'hug', clipsContent: true
      },
      geometry: {
        width: 240, height: 176,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [first, second].map((source, index) => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state,
        placement: { x: 8, y: index === 0 ? 8 : 136, width: 224, height: 32 }
      }))
    })
    const distributed = composite('4', [first, second], {
      layout: {
        direction: 'vertical', align: 'stretch', justify: 'space-between',
        wrap: false, widthBehavior: 'hug'
      },
      geometry: {
        width: 240, height: 112,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [first, second].map((source, index) => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state,
        placement: { x: 8, y: index === 0 ? 8 : 72, width: 224, height: 32 }
      }))
    })

    expect(designerFacingCompositeIds(
      [clippedGap, distributed],
      [first, second]
    )).toEqual(new Set([distributed.id]))
  })

  it('validates the anchored leading edge of a clipped start layout', () => {
    const first = control('1', 'text')
    const second = control('2', 'text')
    const clipped = (character: string, start: number) => composite(
      character,
      [first, second],
      {
        layout: {
          direction: 'vertical', align: 'stretch', justify: 'start',
          wrap: false, widthBehavior: 'hug', clipsContent: true
        },
        geometry: {
          width: 240, height: 176,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          gap: 0, radius: 8, borderWidth: 1
        },
        children: [first, second].map((source, index) => ({
          kind: 'control' as const,
          controlId: source.id,
          instanceId: source.instanceId!,
          state: source.state,
          placement: { x: 8, y: start + index * 32, width: 224, height: 32 }
        }))
      }
    )
    const anchored = clipped('3', 8)
    const shifted = clipped('4', 40)

    expect(designerFacingCompositeIds([anchored, shifted], [first, second]))
      .toEqual(new Set([anchored.id]))
  })

  it('validates packed rows in a wrapped layout', () => {
    const controls = [
      control('1', 'text'), control('2', 'text'),
      control('3', 'text'), control('4', 'text')
    ]
    const wrapped = (character: string, secondRowY: number, height: number) => composite(
      character,
      controls,
      {
        layout: {
          direction: 'horizontal', align: 'start', justify: 'start',
          wrap: true, widthBehavior: 'hug'
        },
        geometry: {
          width: 232, height,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          gap: 8, radius: 8, borderWidth: 1
        },
        children: controls.map((source, index) => ({
          kind: 'control' as const,
          controlId: source.id,
          instanceId: source.instanceId!,
          state: source.state,
          placement: {
            x: index % 2 === 0 ? 8 : 120,
            y: index < 2 ? 8 : secondRowY,
            width: 104,
            height: 32
          }
        }))
      }
    )
    const packed = wrapped('5', 48, 88)
    const missingRow = wrapped('6', 80, 120)
    const firstRowMissingCellControls = controls.slice(0, 3)
    const firstRowMissingCell = composite(
      '7',
      firstRowMissingCellControls,
      {
        layout: {
          direction: 'horizontal', align: 'start', justify: 'start',
          wrap: true, widthBehavior: 'hug'
        },
        geometry: {
          width: 232, height: 88,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          gap: 8, radius: 8, borderWidth: 1
        },
        children: firstRowMissingCellControls.map((source, index) => ({
          kind: 'control' as const,
          controlId: source.id,
          instanceId: source.instanceId!,
          state: source.state,
          placement: {
            x: index === 2 ? 120 : 8,
            y: index === 0 ? 8 : 48,
            width: 104,
            height: 32
          }
        }))
      }
    )

    expect(designerFacingCompositeIds(
      [packed, missingRow, firstRowMissingCell],
      controls
    ))
      .toEqual(new Set([packed.id]))
  })

  it('retains compact icon-only controls as designer-facing leaves', () => {
    const icons = [control('1', 'icon-only'), control('2', 'icon-only')]
    const group = composite('3', icons)
    expect(designerFacingCompositeIds([group], icons)).toEqual(new Set([group.id]))
  })

  it('does not present a shellless menu fragment as a complete component', () => {
    const rows = [control('1', 'text'), control('2', 'text')]
    const shellless = composite('3', rows, {
      geometry: {
        width: 240, height: 80,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 0, borderWidth: 0
      },
      appearance: {
        background: { r: 0, g: 0, b: 0, a: 0 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: []
      }
    })

    expect(designerFacingCompositeIds([shellless], rows)).toEqual(new Set())
  })

  it('rejects legacy composites whose missing placement evidence cannot explain the shell geometry', () => {
    const first = control('1', 'text')
    const second = control('2', 'text')
    const normal = composite('3', [first, second], {
      geometry: {
        width: 240, height: 80,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [first, second].map(source => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state
      }))
    })
    const stretched = composite('4', [first, second], {
      geometry: {
        width: 320, height: 510,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [first, second].map(source => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state
      }))
    })
    const tooNarrow = composite('5', [first, second], {
      geometry: {
        width: 192, height: 80,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [first, second].map(source => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state
      }))
    })

    expect(designerFacingCompositeIds(
      [normal, stretched, tooNarrow],
      [first, second]
    )).toEqual(new Set([normal.id]))
  })

  it('rejects a transparent legacy icon toolbar that expands far beyond its content', () => {
    const icons = [control('1', 'icon-only'), control('2', 'icon-only')]
    const toolbar = composite('3', icons, {
      geometry: {
        width: 902, height: 48,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 0, borderWidth: 1,
        borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
      },
      appearance: {
        background: { r: 1, g: 1, b: 1, a: 1 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: []
      },
      layout: {
        direction: 'horizontal', align: 'center', justify: 'start',
        wrap: false, widthBehavior: 'fill'
      },
      children: icons.map(source => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state
      }))
    })

    expect(designerFacingCompositeIds([toolbar], icons)).toEqual(new Set())
  })

  it('rejects a legacy menu whose safe labels cannot fit its observed width', () => {
    const short = control('1', 'text')
    const long = control('2', 'text')
    short.geometry.minWidth = null
    short.sampleText = { value: 'Open', source: 'visible-text' }
    long.geometry.minWidth = null
    long.sampleText = {
      value: 'Visual Studio (opens in new tab)',
      source: 'visible-text'
    }
    long.slots.leading = {
      width: 20,
      height: 20,
      assetType: 'brand-logo'
    }
    long.content = { kind: 'icon-leading' }
    const fitting = composite('3', [short, short], {
      geometry: {
        width: 240, height: 80,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [short, short].map((source, index) => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: `${source.instanceId}-${index}`,
        state: source.state
      }))
    })
    const clipped = composite('4', [short, long], {
      geometry: {
        width: 192, height: 80,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 0, borderWidth: 0
      },
      appearance: {
        background: { r: 0, g: 0, b: 0, a: 0 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        outlineWidth: 0,
        outlineOffset: 0,
        shadows: []
      },
      children: [short, long].map(source => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state
      }))
    })

    expect(designerFacingCompositeIds([fitting, clipped], [short, long]))
      .toEqual(new Set([fitting.id]))
  })

  it('does not let an inflated legacy child shell justify an inflated parent shell', () => {
    const first = control('1', 'text')
    const second = control('2', 'text')
    const nested = composite('3', [first, second], {
      geometry: {
        width: 272, height: 297,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      children: [first, second].map(source => ({
        kind: 'control' as const,
        controlId: source.id,
        instanceId: source.instanceId!,
        state: source.state
      }))
    })
    const parent = composite('4', [first], {
      kind: 'popover',
      geometry: {
        width: 320, height: 510,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 0, radius: 8, borderWidth: 1
      },
      layout: {
        direction: 'vertical', align: 'start', justify: 'start',
        wrap: false, widthBehavior: 'hug', clipsContent: true
      },
      children: [
        { kind: 'composite' as const, compositeId: nested.id },
        {
          kind: 'control' as const,
          controlId: first.id,
          instanceId: first.instanceId!,
          state: first.state
        }
      ]
    })

    expect(designerFacingCompositeIds([nested, parent], [first, second]))
      .toEqual(new Set())
  })
})
