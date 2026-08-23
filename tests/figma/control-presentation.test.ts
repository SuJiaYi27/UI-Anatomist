import { describe, expect, it } from 'vitest'
import type { ControlToken } from '../../src/shared/schema'
import {
  clusterControlCatalogTokens,
  clusterControlTokens
} from '../../src/figma/control-presentation'

function token(
  id: string,
  patch: Partial<ControlToken> = {}
): ControlToken {
  return {
    id: `sha256:${id.repeat(64)}`,
    groupId: `sha256:${id.repeat(64)}`,
    name: 'button-tertiary-custom',
    family: 'button',
    state: 'default',
    intent: 'tertiary',
    size: 'custom',
    geometry: {
      height: 36,
      minWidth: null,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      radius: 18,
      borderWidth: 0
    },
    appearance: {
      background: { r: 0, g: 0, b: 0, a: 0 },
      foreground: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
      border: { r: 0, g: 0, b: 0, a: 0 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    typography: {
      fontFamilyStack: ['Arial'],
      fontStyle: 'normal',
      fontSizePx: 14,
      fontWeight: 400,
      lineHeightPx: 20,
      letterSpacingPx: 0
    },
    slots: { leading: { width: 20, height: 20 }, trailing: null },
    content: { kind: 'icon-only' },
    occurrences: 1,
    stateOccurrences: 1,
    ...patch
  }
}

describe('clusterControlTokens', () => {
  it('does not promote anonymous text-only evidence without a visible surface', () => {
    const anonymous = token('1', {
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      sampleText: undefined,
      supportingText: undefined,
      geometry: {
        ...token('1').geometry,
        radius: 0,
        borderWidth: 0
      },
      appearance: {
        ...token('1').appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      }
    })

    expect(clusterControlTokens([anonymous])).toEqual([])
  })

  it('does not promote an anonymous compound row without text, graphics, or a visible surface', () => {
    const anonymous = token('1', {
      slots: { leading: null, trailing: null },
      content: {
        kind: 'compound-row',
        trailing: 'none',
        textFlow: 'stacked',
        textGap: 6
      },
      sampleText: undefined,
      supportingText: undefined,
      geometry: {
        ...token('1').geometry,
        radius: 6,
        borderWidth: 0
      },
      appearance: {
        ...token('1').appearance,
        background: { r: 1, g: 1, b: 1, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 }
      }
    })

    expect(clusterControlTokens([anonymous])).toEqual([])
  })

  it('keeps anonymous icon-leading rows structural while retaining compact icon-only controls', () => {
    const anonymousRow = token('1', {
      content: { kind: 'icon-leading' },
      sampleText: undefined,
      supportingText: undefined,
      appearance: {
        ...token('1').appearance,
        background: { r: 0, g: 0, b: 0, a: 0 }
      }
    })
    const compactIcon = token('2', {
      content: { kind: 'icon-only' },
      sampleText: undefined,
      supportingText: undefined
    })

    expect(clusterControlTokens([anonymousRow])).toEqual([])
    expect(clusterControlTokens([compactIcon])).toHaveLength(1)
  })

  it('keeps a surface-only input as a meaningful atomic component', () => {
    const input = token('1', {
      family: 'input',
      intent: 'neutral',
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      sampleText: undefined,
      supportingText: undefined,
      geometry: {
        ...token('1').geometry,
        minWidth: 320,
        borderWidth: 1
      },
      appearance: {
        ...token('1').appearance,
        background: { r: 1, g: 1, b: 1, a: 1 },
        border: { r: 0.8, g: 0.8, b: 0.8, a: 1 }
      }
    })

    expect(clusterControlTokens([input])).toHaveLength(1)
  })

  it('consolidates nearby rendered sizes with the same visual role and structure', () => {
    const groups = clusterControlTokens([
      token('1', { geometry: { ...token('1').geometry, height: 34 } }),
      token('2', { geometry: { ...token('2').geometry, height: 36 } })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.size).toBe('sm')
    expect(groups[0]?.sourceIds).toHaveLength(2)
  })

  it('keeps surfaces, foreground roles, and structures separate', () => {
    const base = token('1')
    const groups = clusterControlTokens([
      base,
      token('2', {
        appearance: {
          ...base.appearance,
          background: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
          foreground: { r: 1, g: 1, b: 1, a: 1 }
        }
      }),
      token('3', {
        appearance: {
          ...base.appearance,
          foreground: { r: 0.56, g: 0.56, b: 0.56, a: 1 }
        }
      }),
      token('4', {
        slots: { leading: null, trailing: null },
        content: { kind: 'text-only' }
      })
    ])

    expect(groups).toHaveLength(3)
  })

  it('keeps linked observed states in one component family', () => {
    const groupId = `sha256:${'a'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', { groupId, state: 'default' }),
      token('2', {
        groupId,
        state: 'pressed',
        appearance: {
          ...token('2').appearance,
          background: { r: 0.95, g: 0.95, b: 0.95, a: 1 }
        }
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.representatives.map(item => item.state)).toEqual([
      'default', 'pressed'
    ])
  })

  it('does not treat different safe content instances as interaction variants when a legacy group id collides', () => {
    const groupId = `sha256:${'d'.repeat(64)}`
    const search = token('1', {
      groupId,
      state: 'default',
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="6"/></svg>'
        },
        trailing: null
      },
      content: { kind: 'icon-leading' },
      sampleText: { value: 'Search the web', source: 'visible-text' }
    })
    const create = token('2', {
      groupId,
      state: 'hover',
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 20 20"><path d="M3 4h14v12H3z"/></svg>'
        },
        trailing: null
      },
      content: { kind: 'icon-leading' },
      sampleText: { value: 'Create an image', source: 'visible-text' },
      appearance: {
        ...token('2').appearance,
        background: { r: 0.95, g: 0.95, b: 0.95, a: 1 }
      }
    })

    const groups = clusterControlTokens([search, create])

    expect(groups).toHaveLength(2)
    expect(groups.every(group => group.representatives.length === 1)).toBe(true)
  })

  it('links modern states only when the logical control identity matches', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const logicalControlId = `sha256:${'e'.repeat(64)}`
    const instanceId = `sha256:${'f'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId,
        state: 'default'
      }),
      token('2', {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId,
        state: 'hover',
        appearance: {
          ...token('2').appearance,
          background: { r: 0.92, g: 0.92, b: 0.92, a: 1 }
        }
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      templateId,
      stateEvidenceId: logicalControlId
    })
    expect(groups[0]?.representatives.map(item => item.state)).toEqual([
      'default', 'hover'
    ])
  })

  it('preserves a second visual for the same state outside the main state family', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const logicalControlId = `sha256:${'e'.repeat(64)}`
    const instanceId = `sha256:${'f'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId,
        state: 'default'
      }),
      token('2', {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId,
        state: 'hover',
        appearance: {
          ...token('2').appearance,
          background: { r: 0.92, g: 0.92, b: 0.92, a: 1 }
        }
      }),
      token('3', {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId,
        state: 'hover',
        appearance: {
          ...token('3').appearance,
          background: { r: 0.72, g: 0.82, b: 0.92, a: 1 }
        }
      })
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.states.map(item => item.state)))
      .toEqual(expect.arrayContaining([['default', 'hover'], ['hover']]))
    expect(groups.flatMap(group => group.instances).map(item => item.id).sort())
      .toEqual([
        `sha256:${'1'.repeat(64)}`,
        `sha256:${'2'.repeat(64)}`,
        `sha256:${'3'.repeat(64)}`
      ].sort())
  })

  it('reuses one modern state family across logical instances with the same template states', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const firstLogicalId = `sha256:${'e'.repeat(64)}`
    const secondLogicalId = `sha256:${'a'.repeat(64)}`
    const hoverAppearance = {
      ...token('2').appearance,
      background: { r: 0.92, g: 0.92, b: 0.92, a: 1 }
    }
    const groups = clusterControlCatalogTokens([
      token('1', {
        groupId: templateId,
        templateId,
        logicalControlId: firstLogicalId,
        instanceId: `sha256:${'1'.repeat(64)}`,
        state: 'default',
        sampleText: { value: 'First command', source: 'visible-text' }
      }),
      token('2', {
        groupId: templateId,
        templateId,
        logicalControlId: firstLogicalId,
        instanceId: `sha256:${'1'.repeat(64)}`,
        state: 'hover',
        sampleText: { value: 'First command', source: 'visible-text' },
        appearance: hoverAppearance
      }),
      token('3', {
        groupId: templateId,
        templateId,
        logicalControlId: secondLogicalId,
        instanceId: `sha256:${'2'.repeat(64)}`,
        state: 'default',
        sampleText: { value: 'Second command', source: 'visible-text' }
      }),
      token('4', {
        groupId: templateId,
        templateId,
        logicalControlId: secondLogicalId,
        instanceId: `sha256:${'2'.repeat(64)}`,
        state: 'hover',
        sampleText: { value: 'Second command', source: 'visible-text' },
        appearance: hoverAppearance
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.stateEvidenceId).toBeNull()
    expect(groups[0]?.sourceIds).toHaveLength(4)
    expect(groups[0]?.instances).toHaveLength(4)
    expect(groups[0]?.states.map(item => item.state)).toEqual(['default', 'hover'])
  })

  it('keeps reusable modern families separate when their observed state sets differ', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const family = (
      id: string,
      logicalControlId: string,
      activeState: 'hover' | 'focus'
    ) => [
      token(id, {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId: `sha256:${id.repeat(64)}`,
        state: 'default'
      }),
      token(String(Number(id) + 1), {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId: `sha256:${id.repeat(64)}`,
        state: activeState,
        appearance: {
          ...token(id).appearance,
          background: { r: 0.92, g: 0.92, b: 0.92, a: 1 }
        }
      })
    ]

    const groups = clusterControlCatalogTokens([
      ...family('1', `sha256:${'e'.repeat(64)}`, 'hover'),
      ...family('3', `sha256:${'a'.repeat(64)}`, 'focus')
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.states.map(item => item.state))).toEqual(
      expect.arrayContaining([['default', 'hover'], ['default', 'focus']])
    )
  })

  it('splits structurally incompatible observations inside one modern logical identity', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const logicalControlId = `sha256:${'e'.repeat(64)}`
    const instanceId = `sha256:${'f'.repeat(64)}`
    const plain = token('1', {
      groupId: templateId,
      templateId,
      logicalControlId,
      instanceId,
      state: 'default',
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      layout: { widthBehavior: 'hug' },
      sampleText: { value: 'Plain action', source: 'visible-text' }
    })
    const row = token('2', {
      groupId: templateId,
      templateId,
      logicalControlId,
      instanceId,
      state: 'hover',
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>'
        },
        trailing: null
      },
      content: { kind: 'compound-row', textFlow: 'stacked', trailing: 'none' },
      layout: { widthBehavior: 'fill' },
      sampleText: { value: 'Row action', source: 'visible-text' },
      supportingText: { value: 'Description', source: 'visible-text' },
      supportingStyle: {
        typography: token('2').typography,
        foreground: token('2').appearance.foreground
      },
      appearance: {
        ...token('2').appearance,
        background: { r: 0.94, g: 0.94, b: 0.94, a: 1 }
      }
    })
    const selected = {
      ...row,
      id: `sha256:${'3'.repeat(64)}`,
      state: 'selected' as const,
      appearance: {
        ...row.appearance,
        background: { r: 0.88, g: 0.9, b: 0.94, a: 1 }
      }
    }

    const groups = clusterControlTokens([plain, row, selected])

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.representatives.map(item => item.state)))
      .toEqual(expect.arrayContaining([['default'], ['hover', 'selected']]))
    expect(groups.every(group =>
      new Set(group.representatives.map(item => item.content?.kind)).size === 1
    )).toBe(true)
  })

  it('does not duplicate a stable default visual outside its evidenced state family', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const defaultId = `sha256:${'1'.repeat(64)}`
    const stateFamilyId = `sha256:${'e'.repeat(64)}`
    const sharedDefault = token('1', {
      id: defaultId,
      groupId: templateId,
      templateId,
      logicalControlId: stateFamilyId,
      instanceId: `sha256:${'f'.repeat(64)}`,
      state: 'default'
    })
    const groups = clusterControlTokens([
      sharedDefault,
      token('2', {
        groupId: templateId,
        templateId,
        logicalControlId: stateFamilyId,
        instanceId: sharedDefault.instanceId,
        state: 'hover',
        appearance: {
          ...token('2').appearance,
          background: { r: 0, g: 0, b: 0, a: 0.05 }
        }
      }),
      {
        ...sharedDefault,
        logicalControlId: `sha256:${'3'.repeat(64)}`,
        instanceId: `sha256:${'4'.repeat(64)}`
      }
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.stateEvidenceId).toBe(stateFamilyId)
    expect(groups[0]?.representatives.map(item => item.state)).toEqual([
      'default', 'hover'
    ])
    expect(groups[0]?.sourceIds).toEqual([
      defaultId,
      `sha256:${'2'.repeat(64)}`
    ])
    expect(groups[0]?.instances.map(item => item.instanceId).sort()).toEqual([
      `sha256:${'f'.repeat(64)}`,
      `sha256:${'4'.repeat(64)}`,
      `sha256:${'f'.repeat(64)}`
    ].sort())
  })

  it('keeps unrelated modern controls out of a false state family', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', {
        groupId: templateId,
        templateId,
        logicalControlId: `sha256:${'1'.repeat(64)}`,
        instanceId: `sha256:${'2'.repeat(64)}`,
        state: 'default'
      }),
      token('2', {
        groupId: templateId,
        templateId,
        logicalControlId: `sha256:${'3'.repeat(64)}`,
        instanceId: `sha256:${'4'.repeat(64)}`,
        state: 'hover',
        appearance: {
          ...token('2').appearance,
          background: { r: 0.92, g: 0.92, b: 0.92, a: 1 }
        }
      })
    ])

    expect(groups).toHaveLength(2)
    expect(groups.every(group => group.stateEvidenceId === null)).toBe(true)
  })

  it('collapses visually identical modern state evidence to one component form', () => {
    const templateId = `sha256:${'d'.repeat(64)}`
    const logicalControlId = `sha256:${'e'.repeat(64)}`
    const instanceId = `sha256:${'f'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId,
        state: 'default'
      }),
      token('2', {
        groupId: templateId,
        templateId,
        logicalControlId,
        instanceId,
        state: 'hover'
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.states.map(item => item.state)).toEqual(['default', 'hover'])
    expect(groups[0]?.representatives).toHaveLength(1)
  })

  it('does not promote a structurally incompatible icon-leading state without copy or surface', () => {
    const groupId = `sha256:${'a'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', {
        groupId,
        state: 'default',
        slots: { leading: null, trailing: null },
        content: { kind: 'text-only' },
        layout: { widthBehavior: 'hug' },
        sampleText: { value: 'Plain', source: 'visible-text' }
      }),
      token('2', {
        groupId,
        state: 'pressed',
        slots: {
          leading: { width: 20, height: 20, assetType: 'ui-icon' },
          trailing: null
        },
        content: { kind: 'icon-and-text' },
        layout: { widthBehavior: 'fill' }
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.representatives.map(item => item.state)).toEqual(['default'])
  })

  it('gives split width-behavior structures distinct component names', () => {
    const groupId = `sha256:${'b'.repeat(64)}`
    const base = {
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' as const },
      sampleText: { value: 'Plain', source: 'visible-text' as const }
    }
    const groups = clusterControlTokens([
      token('1', {
        ...base,
        groupId,
        state: 'default',
        layout: { widthBehavior: 'hug' }
      }),
      token('2', {
        ...base,
        groupId,
        state: 'pressed',
        layout: { widthBehavior: 'fill' }
      })
    ])

    expect(groups).toHaveLength(2)
    expect(new Set(groups.map(group => group.name)).size).toBe(2)
  })

  it('groups default and selected without fabricating unobserved states', () => {
    const groupId = `sha256:${'c'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', { groupId, state: 'default' }),
      token('2', {
        groupId,
        state: 'selected',
        appearance: {
          ...token('2').appearance,
          background: { r: 0.9, g: 0.9, b: 0.9, a: 1 }
        }
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.representatives.map(item => item.state)).toEqual([
      'default', 'selected'
    ])
  })

  it('merges a linked state family into the matching presentation cluster', () => {
    const linkedGroup = `sha256:${'a'.repeat(64)}`
    const groups = clusterControlTokens([
      token('1', { groupId: linkedGroup, state: 'default' }),
      token('2', {
        groupId: linkedGroup,
        state: 'pressed',
        appearance: {
          ...token('2').appearance,
          background: { r: 0.95, g: 0.95, b: 0.95, a: 1 }
        }
      }),
      token('3', { groupId: `sha256:${'b'.repeat(64)}`, state: 'default' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.representatives.map(item => item.state)).toEqual([
      'default', 'pressed'
    ])
  })

  it('chooses the strongest evidence as the representative for each state', () => {
    const groups = clusterControlTokens([
      token('1', { occurrences: 20, stateOccurrences: 3 }),
      token('2', { occurrences: 10, stateOccurrences: 6 })
    ])

    expect(groups[0]?.representatives[0]?.id).toBe(token('2').id)
  })

  it('uses the simplest exact glyph as an icon-only catalog representative', () => {
    const simple = token('1', {
      slots: {
        leading: {
          width: 16,
          height: 16,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8"/></svg>'
        },
        trailing: null
      },
      occurrences: 1,
      stateOccurrences: 1
    })
    const compound = token('2', {
      slots: {
        leading: {
          width: 16,
          height: 16,
          assetType: 'ui-icon',
          vectorSvg: [
            '<svg viewBox="0 0 16 16">',
            '<circle cx="8" cy="8" r="8"/>',
            '<path d="m5 5 6 6"/>',
            '<path d="m11 5-6 6"/>',
            '</svg>'
          ].join('')
        },
        trailing: null
      },
      occurrences: 32,
      stateOccurrences: 32
    })

    const groups = clusterControlTokens([compound, simple])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.representatives[0]?.id).toBe(simple.id)
  })

  it('drops a text implementation node whose content and surface are both invisible', () => {
    const invisible = token('1', {
      family: 'select',
      intent: 'neutral',
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      geometry: {
        ...token('1').geometry,
        height: 32,
        radius: 6
      },
      appearance: {
        ...token('1').appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        foreground: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        outline: { r: 0, g: 0, b: 0, a: 0 },
        shadows: [{
          kind: 'inner',
          offsetX: 0,
          offsetY: 1,
          blur: 0,
          spread: 0,
          color: { r: 0.12, g: 0.14, b: 0.16, a: 0.04 }
        }]
      }
    })
    const visible = token('2', {
      family: 'select',
      intent: 'neutral',
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      appearance: {
        ...token('2').appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        foreground: { r: 0.12, g: 0.14, b: 0.16, a: 1 }
      },
      sampleText: { value: 'Option', source: 'visible-text' }
    })

    const groups = clusterControlTokens([invisible, visible])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.sourceIds).toEqual([visible.id])
  })

  it('collapses same-state transient surfaces and prefers the visible specimen', () => {
    const groupId = `sha256:${'a'.repeat(64)}`
    const ghost = token('1', {
      groupId,
      state: 'default',
      intent: 'tertiary',
      occurrences: 120,
      stateOccurrences: 120,
      appearance: {
        ...token('1').appearance,
        background: { r: 0, g: 0, b: 0, a: 0 }
      }
    })
    const surfaced = token('2', {
      groupId,
      state: 'default',
      intent: 'tertiary',
      occurrences: 2,
      stateOccurrences: 2,
      appearance: {
        ...token('2').appearance,
        background: { r: 0.5, g: 0.54, b: 0.6, a: 0.15 }
      }
    })

    const groups = clusterControlTokens([ghost, surfaced])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.surface).toBe('soft')
    expect(groups[0]?.representatives).toHaveLength(1)
    expect(groups[0]?.representatives[0]?.id).toBe(surfaced.id)
  })

  it('prefers a real safe sample over a more frequent anonymous token', () => {
    const anonymous = token('1', {
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      occurrences: 160,
      stateOccurrences: 8
    })
    const labeled = token('2', {
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      sampleText: { value: 'Size', source: 'visible-text' },
      occurrences: 8,
      stateOccurrences: 1
    })

    const groups = clusterControlTokens([anonymous, labeled])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.representatives[0]?.id).toBe(labeled.id)
  })

  it('chooses the most frequent safe product label within one visual style', () => {
    const anonymous = token('1', {
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      occurrences: 160,
      stateOccurrences: 20
    })
    const stateHeavy = token('2', {
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      sampleText: { value: 'Size', source: 'visible-text' },
      occurrences: 5,
      stateOccurrences: 8
    })
    const frequentLabel = token('3', {
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      sampleText: { value: 'Create image', source: 'visible-text' },
      occurrences: 9,
      stateOccurrences: 1
    })

    const groups = clusterControlTokens([
      anonymous,
      stateHeavy,
      frequentLabel
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.representatives[0]?.id).toBe(frequentLabel.id)
  })

  it('collapses equivalent compound menu rows and prefers the simplest native UI icon example', () => {
    const compound = (
      id: string,
      value: string,
      options: {
        assetType: 'ui-icon' | 'brand-logo' | 'unknown'
        vectorSvg?: string
        trailing?: 'none' | 'action'
      }
    ) => token(id, {
      geometry: {
        ...token(id).geometry,
        height: 52,
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
        gap: 10,
        radius: 8
      },
      slots: {
        leading: {
          width: 24,
          height: 24,
          assetType: options.assetType,
          ...(options.vectorSvg ? { vectorSvg: options.vectorSvg } : {})
        },
        trailing: options.trailing === 'action'
          ? { width: 54, height: 24, assetType: 'unknown' }
          : null
      },
      content: {
        kind: 'compound-row',
        trailing: options.trailing ?? 'none',
        textFlow: 'inline',
        textGap: 8
      },
      layout: { widthBehavior: 'fill' },
      sampleText: { value, source: 'visible-text' },
      supportingText: {
        value: value === 'Add photos & files'
          ? 'Upload from computer'
          : 'Supporting text',
        source: 'visible-text'
      },
      supportingStyle: {
        foreground: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
        typography: {
          fontFamilyStack: ['Arial'],
          fontStyle: 'normal',
          fontSizePx: 14,
          fontWeight: 400,
          lineHeightPx: 20,
          letterSpacingPx: 0
        }
      }
    })
    const addPhotos = compound('1', 'Add photos & files', {
      assetType: 'ui-icon',
      vectorSvg: '<svg viewBox="0 0 24 24"><path d="M12 2v20"/></svg>'
    })
    const groups = clusterControlTokens([
      addPhotos,
      compound('2', 'Create image', { assetType: 'unknown' }),
      compound('3', 'Web search', { assetType: 'ui-icon' }),
      compound('4', 'Figma', { assetType: 'brand-logo' }),
      compound('5', 'GitHub', { assetType: 'brand-logo' }),
      compound('6', 'Sites', { assetType: 'brand-logo' }),
      compound('7', 'Atlassian Rovo', {
        assetType: 'brand-logo',
        trailing: 'action'
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toMatch(/^Control\/MenuItem\//)
    expect(groups[0]?.sourceIds).toHaveLength(7)
    expect(groups[0]?.representatives).toHaveLength(1)
    expect(groups[0]?.representatives[0]?.id).toBe(addPhotos.id)
  })
})
