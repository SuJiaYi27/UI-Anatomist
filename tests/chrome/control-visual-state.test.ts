import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  createControlStateNormalizer
} from '../../src/chrome/content/index'
import type {
  CollectedControlToken,
  ControlObservation
} from '../../src/chrome/content/controls'
import type { ControlOwnership } from '../../src/chrome/content/control-ownership'
import { shouldInferVisualSelected } from '../../src/chrome/content/control-visual-state'
import {
  HOVER_PROBE_ATTRIBUTE,
  HOVER_TARGET_ATTRIBUTE
} from '../../src/chrome/content/hover-state-explorer'

const stable = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`

function token(
  seed: string,
  sample: string,
  background: { r: number; g: number; b: number; a: number },
  overrides: Partial<CollectedControlToken> = {}
): CollectedControlToken {
  const foreground = { r: 0.08, g: 0.08, b: 0.08, a: 1 }
  const typography = {
    fontFamilyStack: ['Inter'],
    fontStyle: 'normal' as const,
    fontSizePx: 14,
    fontWeight: 400,
    lineHeightPx: 20,
    letterSpacingPx: 0
  }
  return {
    id: stable(`${seed}id`),
    groupId: stable(`${seed}group`),
    templateId: stable(`${seed}template`),
    logicalControlId: stable(`${seed}logical`),
    instanceId: stable(`${seed}instance`),
    name: 'choice',
    family: 'button',
    state: 'default',
    intent: 'secondary',
    size: 'sm',
    geometry: {
      height: 32,
      minWidth: null,
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 8,
      radius: 6,
      borderWidth: 0,
      borderWidths: { top: 0, right: 0, bottom: 0, left: 0 }
    },
    appearance: {
      background,
      foreground,
      border: { r: 0, g: 0, b: 0, a: 0 },
      outline: { r: 0, g: 0, b: 0, a: 0 },
      outlineWidth: 0,
      outlineOffset: 0,
      shadows: []
    },
    typography,
    slots: { leading: null, trailing: null },
    content: {
      kind: 'compound-row',
      trailing: 'none',
      textFlow: 'stacked',
      textGap: 2
    },
    layout: { widthBehavior: 'fill', contentAlignment: 'start' },
    sampleText: { value: sample, source: 'visible-text' },
    supportingText: { value: 'Supporting', source: 'visible-text' },
    supportingStyle: { foreground, typography },
    occurrences: 1,
    stateOccurrences: 1,
    ...overrides
  }
}

function observation(
  element: HTMLElement,
  value: CollectedControlToken
): ControlObservation {
  const ownership: ControlOwnership = {
    interaction: element,
    layout: element,
    paint: element,
    slots: element,
    compositeAnchor: element
  }
  return { token: value, ownership }
}

function fixture() {
  const dom = new JSDOM(`
    <div role="listbox">
      <button id="one">One</button>
      <button id="target">Target</button>
      <button id="three">Three</button>
    </div>
  `, { url: 'https://example.com/', pretendToBeVisual: true })
  const document = dom.window.document
  const one = document.querySelector<HTMLElement>('#one')!
  const target = document.querySelector<HTMLElement>('#target')!
  const three = document.querySelector<HTMLElement>('#three')!
  const clear = { r: 0, g: 0, b: 0, a: 0 }
  return {
    dom,
    target,
    observations: [
      observation(one, token('one', 'One', clear)),
      observation(target, token('target', 'Target', { r: 0.92, g: 0.92, b: 0.92, a: 1 })),
      observation(three, token('three', 'Three', clear))
    ]
  }
}

describe('default-state visual comparison', () => {
  it('infers a persistent visual default difference without a carrier or fixed color rule', () => {
    const { dom, target, observations } = fixture()
    const targetObservation = observations[1]!

    expect(shouldInferVisualSelected(
      targetObservation,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('detects a non-background visual difference such as a persistent border', () => {
    const { dom, target, observations } = fixture()
    const targetObservation = observations[1]!
    targetObservation.token = {
      ...targetObservation.token,
      geometry: {
        ...targetObservation.token.geometry,
        borderWidth: 1,
        borderWidths: { top: 1, right: 1, bottom: 1, left: 1 }
      },
      appearance: {
        ...targetObservation.token.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 },
        border: { r: 0.15, g: 0.15, b: 0.15, a: 1 }
      }
    }

    expect(shouldInferVisualSelected(
      targetObservation,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('also compares a generic non-compound control by structure rather than content text', () => {
    const { dom, target, observations } = fixture()
    for (const item of observations) {
      item.token = {
        ...item.token,
        content: { kind: 'text-only' }
      }
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('retains an existing trailing carrier and vector when inferring selected', async () => {
    const { dom, target, observations } = fixture()
    const trailing = {
      width: 20,
      height: 20,
      assetType: 'ui-icon' as const,
      vectorSvg: '<svg viewBox="0 0 20 20"><path d="M4 10l4 4 8-8" /></svg>',
      surface: {
        width: 40,
        height: 40,
        background: { r: 1, g: 1, b: 1, a: 1 },
        foreground: { r: 0, g: 0, b: 0, a: 1 },
        border: { r: 0, g: 0, b: 0, a: 0 },
        borderWidth: 0,
        radii: { topLeft: 20, topRight: 20, bottomRight: 20, bottomLeft: 20 }
      }
    }
    target.textContent = 'Target'
    observations[1]!.token = {
      ...observations[1]!.token,
      slots: { leading: null, trailing }
    }

    const result = await createControlStateNormalizer()({
      controls: observations.map(item => item.token),
      observations
    })
    const selected = result.controls.find(item => item.sampleText?.value === 'Target')!

    expect(selected.state).toBe('selected')
    expect(selected.slots.trailing).toEqual(trailing)
  })

  it('keeps responsive peers comparable when their geometry is not identical', () => {
    const { dom, target, observations } = fixture()
    for (const index of [0, 2]) {
      observations[index]!.token = {
        ...observations[index]!.token,
        geometry: {
          ...observations[index]!.token.geometry,
          height: 48,
          minWidth: 180,
          padding: { top: 12, right: 16, bottom: 12, left: 16 },
          gap: 12
        },
        layout: { widthBehavior: 'hug', contentAlignment: 'start' }
      }
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('keeps peers comparable when their collected size changes with responsive height', () => {
    const { dom, observations } = fixture()
    for (const index of [0, 2]) {
      observations[index]!.token = {
        ...observations[index]!.token,
        size: 'lg',
        geometry: {
          ...observations[index]!.token.geometry,
          height: 72,
          minWidth: 220,
          padding: { top: 18, right: 20, bottom: 18, left: 20 }
        }
      }
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('uses a non-independent trailing UI icon as visual evidence without treating it as content identity', () => {
    const { dom, observations } = fixture()
    for (const item of observations) {
      item.token = {
        ...item.token,
        content: { kind: 'text-only' }
      }
    }
    observations[1]!.token = {
      ...observations[1]!.token,
      content: { kind: 'icon-trailing' },
      slots: {
        leading: null,
        trailing: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          vectorSvg: '<svg viewBox="0 0 20 20"><path d="M4 10l4 4 8-8" /></svg>'
        }
      }
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('keeps peers comparable when a state surface moves from the interaction to its wrapper', () => {
    const { dom, target, observations } = fixture()
    const wrapper = dom.window.document.createElement('div')
    target.replaceWith(wrapper)
    wrapper.append(target)
    observations[1]!.ownership = {
      ...observations[1]!.ownership,
      paint: wrapper
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('does not compare controls from different interaction families', () => {
    const { dom, observations } = fixture()
    observations[1]!.token = {
      ...observations[1]!.token,
      family: 'input'
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(false)
  })

  it('keeps outer rows comparable while excluding a nested action observation', () => {
    const { dom, target, observations } = fixture()
    const nestedAction = dom.window.document.createElement('button')
    nestedAction.textContent = 'More'
    target.append(nestedAction)
    const nestedObservation = observation(
      nestedAction,
      token('nested-action', 'More', { r: 0.92, g: 0.92, b: 0.92, a: 1 })
    )
    observations.push(nestedObservation)
    const directRows = observations.slice(0, 3)
    const peerContext = {
      directOptionsByObservation: new Map(
        directRows.map(row => [row, directRows] as const)
      ),
      directOptionGroupByObservation: new Map(
        directRows.map(row => [row, target.parentElement!] as const)
      )
    }

    // The complete observation set contains the nested action as its own
    // Control. The outer row remains comparable with its repeated peers, but
    // the nested action must not become an outer-row peer merely because it
    // shares the broad family and local scope.
    const outerResult = shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window,
      peerContext
    )
    const nestedResult = shouldInferVisualSelected(
      nestedObservation,
      observations,
      dom.window as unknown as Window,
      peerContext
    )
    expect({ outerResult, nestedResult }).toEqual({ outerResult: true, nestedResult: false })
  })

  it('keeps a repeated row comparable when one optional nested control is present', () => {
    const { dom, target, observations } = fixture()
    const optionalAction = dom.window.document.createElement('button')
    optionalAction.textContent = 'More'
    target.append(optionalAction)

    // The three buttons are still the same repeated row family in one local
    // list. One row has an optional nested action, so nested-control count is
    // intentionally different; that count must not be a peer-identity gate.
    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('does not infer a state without a comparable peer baseline', () => {
    const dom = new JSDOM('<button id="target">Target</button>', {
      url: 'https://example.com/',
      pretendToBeVisual: true
    })
    const target = dom.window.document.querySelector<HTMLElement>('#target')!
    const targetObservation = observation(
      target,
      token('alone', 'Target', { r: 0.92, g: 0.92, b: 0.92, a: 1 })
    )

    expect(shouldInferVisualSelected(
      targetObservation,
      [targetObservation],
      dom.window as unknown as Window
    )).toBe(false)
  })

  it('does not infer when two different peers have no majority baseline', () => {
    const { dom, observations } = fixture()

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations.slice(0, 2),
      dom.window as unknown as Window
    )).toBe(false)
  })

  it('allows more than one persistent emphasized peer when a normal baseline remains', () => {
    const { dom, target, observations } = fixture()
    const list = target.parentElement!
    const clear = { r: 0, g: 0, b: 0, a: 0 }
    const emphasized = { r: 0.92, g: 0.92, b: 0.92, a: 1 }
    const fourth = dom.window.document.createElement('button')
    fourth.id = 'four'
    fourth.textContent = 'Four'
    const fifth = dom.window.document.createElement('button')
    fifth.id = 'five'
    fifth.textContent = 'Five'
    list.append(fourth, fifth)
    const fourthObservation = observation(fourth, token('four', 'Four', clear))
    const fifthObservation = observation(fifth, token('five', 'Five', emphasized))
    observations.push(fourthObservation, fifthObservation)

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
    expect(shouldInferVisualSelected(
      fifthObservation,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('keeps a parent row eligible when an independent trailing action is not its only visual difference', () => {
    const { dom, target, observations } = fixture()
    const targetObservation = observations[1]!
    const wrapper = dom.window.document.createElement('div')
    const action = dom.window.document.createElement('button')
    action.textContent = 'More'
    target.replaceWith(wrapper)
    wrapper.append(target, action)
    targetObservation.ownership = {
      ...targetObservation.ownership,
      slots: wrapper,
      compositeAnchor: wrapper
    }

    expect(shouldInferVisualSelected(
      targetObservation,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('does not infer selected when only an independent trailing action differs', () => {
    const { dom, target, observations } = fixture()
    const targetObservation = observations[1]!
    const wrapper = dom.window.document.createElement('div')
    const action = dom.window.document.createElement('button')
    action.textContent = 'More'
    target.replaceWith(wrapper)
    wrapper.append(target, action)
    targetObservation.ownership = {
      ...targetObservation.ownership,
      slots: wrapper,
      compositeAnchor: wrapper
    }
    targetObservation.token = {
      ...targetObservation.token,
      appearance: {
        ...targetObservation.token.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 }
      }
    }

    expect(shouldInferVisualSelected(
      targetObservation,
      observations,
      dom.window as unknown as Window
    )).toBe(false)
  })

  it('keeps parent-owned slot evidence when an independent trailing action is present', () => {
    const { dom, target, observations } = fixture()
    const targetObservation = observations[1]!
    const wrapper = dom.window.document.createElement('div')
    const action = dom.window.document.createElement('button')
    action.textContent = 'More'
    target.replaceWith(wrapper)
    wrapper.append(target, action)

    const leadingMarker = {
      width: 16,
      height: 16,
      assetType: 'ui-icon' as const,
      vectorSvg: '<svg viewBox="0 0 16 16"><path d="M2 8h12" /></svg>'
    }
    targetObservation.token = {
      ...targetObservation.token,
      appearance: {
        ...targetObservation.token.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 }
      },
      slots: { leading: leadingMarker, trailing: null }
    }
    targetObservation.ownership = {
      ...targetObservation.ownership,
      slots: wrapper,
      compositeAnchor: wrapper
    }

    // Only the parent-owned leading marker differs from the peers. The
    // independent trailing action must not erase that evidence.
    expect(shouldInferVisualSelected(
      targetObservation,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('does not use visual order to discard a parent-owned trailing slot', () => {
    const { dom, target, observations } = fixture()
    const targetObservation = observations[1]!
    const wrapper = dom.window.document.createElement('div')
    const action = dom.window.document.createElement('button')
    action.textContent = 'More'
    target.replaceWith(wrapper)
    // The independent action is visually after the interaction, but the
    // trailing marker below belongs to the parent row's own slot evidence.
    wrapper.append(target, action)

    const trailingMarker = {
      width: 16,
      height: 16,
      assetType: 'ui-icon' as const,
      vectorSvg: '<svg viewBox="0 0 16 16"><path d="M2 8h12" /></svg>'
    }
    targetObservation.token = {
      ...targetObservation.token,
      appearance: {
        ...targetObservation.token.appearance,
        background: { r: 0, g: 0, b: 0, a: 0 }
      },
      slots: { leading: null, trailing: trailingMarker }
    }
    targetObservation.ownership = {
      ...targetObservation.ownership,
      slots: wrapper,
      compositeAnchor: wrapper
    }

    expect(shouldInferVisualSelected(
      targetObservation,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('tolerates rendering precision noise without treating every peer as a different baseline', () => {
    const { dom, observations } = fixture()
    observations[0]!.token = {
      ...observations[0]!.token,
      appearance: {
        ...observations[0]!.token.appearance,
        background: { r: 0, g: 0, b: 0, a: 0.0001 }
      }
    }
    observations[2]!.token = {
      ...observations[2]!.token,
      appearance: {
        ...observations[2]!.token.appearance,
        background: { r: 0, g: 0, b: 0, a: 0.0002 }
      }
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(true)
  })

  it('keeps a forced hover peer out of the default visual baseline', async () => {
    const { dom, observations } = fixture()
    const extraPeer = dom.window.document.createElement('button')
    extraPeer.textContent = 'Four'
    observations[0]!.ownership.interaction.parentElement?.append(extraPeer)
    observations.push(observation(
      extraPeer,
      token('four', 'Four', { r: 0, g: 0, b: 0, a: 0 })
    ))
    observations[2]!.token = {
      ...observations[2]!.token,
      state: 'hover',
      appearance: {
        ...observations[2]!.token.appearance,
        background: { r: 0.9, g: 0.9, b: 0.9, a: 1 }
      }
    }
    const normalize = createControlStateNormalizer()
    const result = await normalize({
      controls: observations.map(item => item.token),
      observations
    })

    expect(result.controls.find(item => item.sampleText?.value === 'Target')?.state)
      .toBe('selected')
    expect(result.controls.find(item => item.sampleText?.value === 'Three')?.state)
      .toBe('hover')
    expect(dom.window.document.activeElement).toBe(dom.window.document.body)
  })

  it('keeps a visually uniform default group at default', () => {
    const { dom, observations } = fixture()
    const clear = { r: 0, g: 0, b: 0, a: 0 }
    observations[1]!.token = {
      ...observations[1]!.token,
      appearance: {
        ...observations[1]!.token.appearance,
        background: clear
      }
    }

    expect(shouldInferVisualSelected(
      observations[1]!,
      observations,
      dom.window as unknown as Window
    )).toBe(false)
  })

  it('keeps a stable selected instance selected when another peer is force-hovered later', async () => {
    const { dom, observations } = fixture()
    const normalize = createControlStateNormalizer()
    const list = observations[0]!.ownership.interaction.parentElement!
    const peerContext = {
      directOptionsByObservation: new Map(
        observations.map(item => [item, observations] as const)
      ),
      directOptionGroupByObservation: new Map(
        observations.map(item => [item, list] as const)
      )
    }
    const baseline = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, peerContext)
    const hoverPeer = observations[2]!
    list.setAttribute(HOVER_PROBE_ATTRIBUTE, 'true')
    hoverPeer.ownership.interaction.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
    hoverPeer.token = {
      ...hoverPeer.token,
      state: 'hover',
      appearance: {
        ...hoverPeer.token.appearance,
        background: { r: 0.9, g: 0.9, b: 0.9, a: 1 }
      }
    }

    const hoverSample = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, peerContext)
    const selectedTarget = baseline.controls.find(item => item.sampleText?.value === 'Target')!
    const hoveredTarget = hoverSample.controls.find(item => item.sampleText?.value === 'Target')!
    const hoveredPeer = hoverSample.controls.find(item => item.sampleText?.value === 'Three')!

    expect(selectedTarget.state).toBe('selected')
    expect(hoveredTarget.state).toBe('selected')
    expect(hoveredTarget.id).toBe(selectedTarget.id)
    expect(hoveredPeer.state).toBe('hover')
    expect(new Set([selectedTarget.id, hoveredTarget.id]).size).toBe(1)
  })

  it('retains a selected state when later sampling only changes non-state size and text gap', async () => {
    const { dom, observations } = fixture()
    const normalize = createControlStateNormalizer()
    const list = observations[0]!.ownership.interaction.parentElement!
    const peerContext = {
      directOptionsByObservation: new Map(
        observations.map(item => [item, observations] as const)
      ),
      directOptionGroupByObservation: new Map(
        observations.map(item => [item, list] as const)
      )
    }
    const baseline = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, peerContext)
    const hoverPeer = observations[2]!
    list.setAttribute(HOVER_PROBE_ATTRIBUTE, 'true')
    hoverPeer.ownership.interaction.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
    hoverPeer.token = {
      ...hoverPeer.token,
      state: 'hover',
      appearance: {
        ...hoverPeer.token.appearance,
        background: { r: 0.9, g: 0.9, b: 0.9, a: 1 }
      }
    }
    observations[1]!.token = {
      ...observations[1]!.token,
      size: 'lg',
      geometry: {
        ...observations[1]!.token.geometry,
        height: 64,
        padding: { top: 16, right: 20, bottom: 16, left: 20 }
      },
      content: {
        kind: 'compound-row',
        trailing: 'none',
        textFlow: 'stacked',
        textGap: 6
      }
    }

    const responsiveSample = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, peerContext)
    const selectedTarget = baseline.controls.find(item => item.sampleText?.value === 'Target')!
    const responsiveTarget = responsiveSample.controls.find(item => item.sampleText?.value === 'Target')!
    const hoveredPeer = responsiveSample.controls.find(item => item.sampleText?.value === 'Three')!

    expect(selectedTarget.state).toBe('selected')
    expect(responsiveTarget.state).toBe('selected')
    expect(hoveredPeer.state).toBe('hover')
  })

  it('does not retain selected from a prior List when the current sample marks the instance outside every List pedigree', async () => {
    const { dom, observations } = fixture()
    const normalize = createControlStateNormalizer()
    const list = observations[0]!.ownership.interaction.parentElement!
    const directOptionsByObservation = new Map(
      observations.map(item => [item, observations] as const)
    )
    const directOptionGroupByObservation = new Map(
      observations.map(item => [item, list] as const)
    )
    const baseline = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, { directOptionsByObservation, directOptionGroupByObservation })
    const outside = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, {
      directOptionsByObservation: new Map(),
      directOptionGroupByObservation: new Map()
    })

    expect(baseline.controls.find(item => item.sampleText?.value === 'Target')?.state)
      .toBe('selected')
    expect(outside.controls.find(item => item.sampleText?.value === 'Target')?.state)
      .toBe('default')
  })

  it('does not retain selected from a different current List when that List has no current visual baseline', async () => {
    const { dom, observations } = fixture()
    const normalize = createControlStateNormalizer()
    const firstList = observations[0]!.ownership.interaction.parentElement!
    const secondList = dom.window.document.createElement('div')
    const directOptionsByObservation = new Map(
      observations.map(item => [item, observations] as const)
    )
    const firstGroupByObservation = new Map(
      observations.map(item => [item, firstList] as const)
    )
    const baseline = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, { directOptionsByObservation, directOptionGroupByObservation: firstGroupByObservation })
    const target = observations[1]!
    const moved = await normalize({
      controls: observations.map(item => item.token),
      observations
    }, {
      directOptionsByObservation: new Map([[target, [target]]]),
      directOptionGroupByObservation: new Map([[target, secondList]])
    })

    expect(baseline.controls.find(item => item.sampleText?.value === 'Target')?.state)
      .toBe('selected')
    expect(moved.controls.find(item => item.sampleText?.value === 'Target')?.state)
      .toBe('default')
  })

  it('applies the inferred state through the normalizer and recomputes state identity', async () => {
    const { dom, observations } = fixture()
    const normalize = createControlStateNormalizer()
    const result = await normalize({
      controls: observations.map(item => item.token),
      observations
    })
    const target = result.controls.find(item => item.sampleText?.value === 'Target')!

    expect(target.state).toBe('selected')
    expect(target.id).not.toBe(observations[1]!.token.id)
    expect(result.observations.find(item => item.ownership.interaction.id === 'target')?.token.state)
      .toBe('selected')
  })
})
