import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import {
  collectControls,
  collectControlsWithObservations,
  controlFamily,
  controlSize,
  controlState
} from '../../src/chrome/content/controls'
import { analyzeControlAnatomy } from '../../src/chrome/content/control-anatomy'
import {
  HOVER_PROBE_ATTRIBUTE,
  HOVER_TARGET_ATTRIBUTE
} from '../../src/chrome/content/hover-state-explorer'
import { createControlDiagnosticRecorder } from '../../src/chrome/content/control-diagnostics'

function rect(width: number, height: number, x = 0, y = 0): DOMRect {
  return {
    x, y, width, height, top: y, right: x + width, bottom: y + height, left: x,
    toJSON: () => ({})
  }
}

function fixture(): JSDOM {
  const dom = new JSDOM(readFileSync('tests/fixtures/controls.html', 'utf8'), {
    pretendToBeVisual: true,
    url: 'https://example.com/'
  })
  dom.window.document.querySelectorAll<HTMLElement>('[data-control]').forEach((element, index) => {
    const width = Number(element.dataset.width)
    const height = Number(element.dataset.height)
    element.getBoundingClientRect = () => rect(width, height, index * 25, index * 10)
  })
  return dom
}

describe('control classification', () => {
  it('recognizes only the seven explicit families', () => {
    const dom = fixture()
    const document = dom.window.document
    expect(controlFamily(document.querySelector('button')!)).toBe('button')
    expect(controlFamily(document.querySelector('input:not([type])')!)).toBe('input')
    expect(controlFamily(document.querySelector('textarea')!)).toBe('textarea')
    expect(controlFamily(document.querySelector('select')!)).toBe('select')
    expect(controlFamily(document.querySelector('[role="switch"]')!)).toBe('toggle')
    expect(controlFamily(document.querySelector('[type="checkbox"]')!)).toBe('checkbox')
    expect(controlFamily(document.querySelector('[type="radio"]')!)).toBe('radio')
    expect(controlFamily(document.querySelector('a')!)).toBeNull()
    expect(controlFamily(document.querySelector('article')!)).toBeNull()

    const indexed = document.createElement('div')
    indexed.tabIndex = 0
    expect(controlFamily(indexed)).toBe('button')
  })

  it('lets a synthetic hover probe override semantic state while preserving normal priority', () => {
    const dom = new JSDOM('<button disabled aria-checked="true" aria-pressed="true"></button>', {
      pretendToBeVisual: true
    })
    const element = dom.window.document.querySelector<HTMLButtonElement>('button')!
    expect(controlState(element)).toBe('disabled')

    element.disabled = false
    expect(controlState(element)).toBe('selected')
    element.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
    expect(controlState(element)).toBe('hover')
    element.removeAttribute(HOVER_TARGET_ATTRIBUTE)
    element.removeAttribute('aria-checked')
    expect(controlState(element)).toBe('pressed')
    element.removeAttribute('aria-pressed')
    element.setAttribute('aria-expanded', 'true')
    expect(controlState(element)).toBe('expanded')
    element.removeAttribute('aria-expanded')
    element.focus()
    expect(controlState(element)).toBe('focus')
    element.blur()

    const originalMatches = element.matches.bind(element)
    element.matches = ((selector: string) =>
      selector === ':hover' || originalMatches(selector)) as typeof element.matches
    expect(controlState(element)).toBe('hover')
    element.matches = originalMatches
    expect(controlState(element)).toBe('default')

    element.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
    expect(controlState(element)).toBe('hover')
  })

  it('does not mark a control hovered merely because it supports a descendant hover selector', () => {
    const dom = new JSDOM(`
      <div role="menu" ${HOVER_PROBE_ATTRIBUTE}="true">
        <button id="first" ${HOVER_TARGET_ATTRIBUTE}="true">First</button>
        <button id="second">Second</button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document

    expect(controlState(document.querySelector<HTMLElement>('#first')!)).toBe('hover')
    expect(controlState(document.querySelector<HTMLElement>('#second')!)).toBe('default')
    expect(controlState(document.querySelector<HTMLElement>('[role="menu"]')!)).toBe('default')
  })

  it('does not treat activeElement alone as visual focus', () => {
    const dom = new JSDOM('<button>Open menu</button>', {
      pretendToBeVisual: true
    })
    const element = dom.window.document.querySelector<HTMLButtonElement>('button')!
    element.focus()
    const originalMatches = element.matches.bind(element)
    element.matches = ((selector: string) =>
      selector === ':focus-visible'
        ? false
        : originalMatches(selector)) as typeof element.matches

    expect(dom.window.document.activeElement).toBe(element)
    expect(controlState(element)).toBe('default')
  })

  it('recognizes native disabled state inherited from a fieldset', () => {
    const dom = new JSDOM(`
      <fieldset disabled>
        <input id="field" />
      </fieldset>
    `, { pretendToBeVisual: true })

    expect(controlState(
      dom.window.document.querySelector<HTMLElement>('#field')!
    )).toBe('disabled')
  })

  it('maps standard rendered heights and preserves unusual heights as custom', () => {
    expect([24, 32, 40, 48, 56].map(controlSize)).toEqual(['xs', 'sm', 'md', 'lg', 'xl'])
    expect(controlSize(43)).toBe('custom')
  })

  it.each([
    ['disabled', '<button id="control" disabled>Unavailable</button>'],
    ['inert', '<div inert><button id="control">Unavailable</button></div>'],
    ['pointer-blocked', '<button id="control" style="pointer-events:none">Unavailable</button>']
  ])('keeps a visually rendered %s control as design evidence', async (_kind, markup) => {
    const dom = new JSDOM(markup, {
      pretendToBeVisual: true,
      url: 'https://example.com/'
    })
    const control = dom.window.document.querySelector<HTMLElement>('#control')!
    control.style.width = '96px'
    control.style.height = '32px'
    control.style.background = 'rgb(245,245,245)'
    control.getBoundingClientRect = () => rect(96, 32)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.sampleText).toEqual({
      value: 'Unavailable',
      source: 'visible-text'
    })
    expect(tokens[0]?.state).toBe(_kind === 'disabled' ? 'disabled' : 'default')
  })
})

describe('collectControls', () => {
  it('retains a tight painted carrier for a trailing icon slot', async () => {
    const dom = new JSDOM(`
      <button id="row" style="
        display:flex;align-items:center;width:276px;height:72px;
        padding:8px;background:transparent;border:0
      ">
        <span id="primary">简体中文</span>
        <span id="support">Simplified Chinese</span>
        <span id="carrier" style="
          display:block;width:20px;height:20px;border-radius:50%;
          background:rgb(255,255,255)
        ">
          <svg id="check" viewBox="0 0 20 20" fill="none">
            <path d="M4 10l4 4 8-8" stroke="currentColor"/>
          </svg>
        </span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      row: rect(276, 72),
      primary: rect(64, 20, 16, 12),
      support: rect(136, 20, 16, 34),
      carrier: rect(20, 20, 240, 26),
      check: rect(20, 20, 240, 26)
    }
    for (const [id, bounds] of Object.entries(boxes)) {
      document.getElementById(id)!.getBoundingClientRect = () => bounds
    }

    const [token] = await collectControls(document)

    expect(token).toMatchObject({
      content: { kind: 'compound-row', trailing: 'action' },
      slots: {
        trailing: {
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          surface: {
            width: 20,
            height: 20,
            background: { r: 1, g: 1, b: 1, a: 1 },
            borderWidth: 0,
            radii: {
              topLeft: 10,
              topRight: 10,
              bottomRight: 10,
              bottomLeft: 10
            }
          }
        }
      }
    })
  })

  it('does not promote row, oversized, multi-graphic, or private surfaces to a carrier', async () => {
    const cases = [
      {
        name: 'row background',
        markup: `
          <button id="row" style="width:276px;height:72px;background:white">
            <span id="primary">Primary</span><span id="support">Support</span>
            <svg id="check" viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg>
          </button>
        `,
        extra: () => undefined,
        carrier: rect(276, 72)
      },
      {
        name: 'oversized inner surface',
        markup: `
          <button id="row" style="width:276px;height:72px">
            <span id="primary">Primary</span><span id="support">Support</span>
            <span id="carrier" style="display:block;width:80px;height:80px;background:white;border-radius:40px">
              <svg id="check" viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg>
            </span>
          </button>
        `,
        extra: () => undefined,
        carrier: rect(80, 80, 210, 0)
      },
      {
        name: 'multiple graphics',
        markup: `
          <button id="row" style="width:276px;height:72px">
            <span id="primary">Primary</span><span id="support">Support</span>
            <span id="carrier" style="display:block;width:20px;height:20px;background:white;border-radius:50%">
              <svg id="check" viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg>
              <svg id="extra" viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>
            </span>
          </button>
        `,
        extra: (document: Document) => {
          document.getElementById('extra')!.getBoundingClientRect = () =>
            rect(20, 20, 240, 26)
        },
        carrier: rect(20, 20, 240, 26)
      },
      {
        name: 'private context',
        markup: `
          <div data-testid="account-profile">
            <button id="row" style="width:276px;height:72px">
              <span id="primary">Primary</span><span id="support">Support</span>
              <span id="carrier" style="display:block;width:20px;height:20px;background:white;border-radius:50%">
                <svg id="check" viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg>
              </span>
            </button>
          </div>
        `,
        extra: () => undefined,
        carrier: rect(20, 20, 240, 26)
      }
    ] as const

    for (const testCase of cases) {
      const dom = new JSDOM(testCase.markup, {
        pretendToBeVisual: true,
        url: 'https://example.com/'
      })
      const document = dom.window.document
      const row = document.getElementById('row')!
      row.getBoundingClientRect = () => rect(276, 72)
      document.getElementById('primary')!.getBoundingClientRect = () =>
        rect(64, 20, 16, 12)
      document.getElementById('support')!.getBoundingClientRect = () =>
        rect(64, 20, 16, 34)
      document.getElementById('check')!.getBoundingClientRect = () =>
        testCase.name === 'oversized inner surface'
          ? rect(20, 20, 240, 26)
          : testCase.carrier
      const carrier = document.getElementById('carrier')
      if (carrier) carrier.getBoundingClientRect = () => testCase.carrier
      testCase.extra(document)

      const anatomy = await analyzeControlAnatomy(
        row as HTMLElement,
        dom.window as unknown as Window,
        { allowCompound: true }
      )
      expect(anatomy.slots.trailing?.surface, testCase.name).toBeUndefined()
    }
  })

  it('merges bounded safe fragments on each of two visual text lines before building a compound row', async () => {
    const dom = new JSDOM(`
      <button id="row" aria-selected="true" style="width:309px;height:72px;padding:8px">
        <span id="primary-a">Primary</span><span id="primary-b">label</span>
        <span id="support-a">Support</span><span id="support-b">copy</span>
        <svg id="check" viewBox="0 0 16 16"><path d="M2 8l3 3 8-9"/></svg>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    row.getBoundingClientRect = () => rect(309, 72)
    const bounds: Record<string, DOMRect> = {
      'primary-a': rect(48, 24, 16, 12),
      'primary-b': rect(40, 24, 72, 12),
      'support-a': rect(48, 20, 16, 40),
      'support-b': rect(32, 20, 72, 40),
      check: rect(16, 16, 277, 28)
    }
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[id]:not(#row)'))) {
      element.getBoundingClientRect = () => bounds[element.id]!
    }

    const [token] = await collectControls(document)

    expect(token).toMatchObject({
      content: { kind: 'compound-row', textFlow: 'stacked', trailing: 'action' },
      sampleText: { value: 'Primary label', source: 'visible-text' },
      supportingText: { value: 'Support copy', source: 'visible-text' },
      slots: { trailing: { width: 16, height: 16, assetType: 'ui-icon' } }
    })
  })

  it('merges adjacent fragments when only their foreground colors differ', async () => {
    const dom = new JSDOM(`
      <button id="row" style="width:309px;height:72px;padding:8px">
        <span id="primary-a" style="color:rgb(31,35,40)">Primary</span>
        <span id="primary-b" style="color:rgb(89,99,110)">label</span>
        <span id="support-a" style="color:rgb(31,35,40)">Support</span>
        <span id="support-b" style="color:rgb(89,99,110)">copy</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    row.getBoundingClientRect = () => rect(309, 72)
    const bounds: Record<string, DOMRect> = {
      'primary-a': rect(48, 16, 16, 12),
      'primary-b': rect(40, 16, 72, 12),
      'support-a': rect(48, 16, 16, 40),
      'support-b': rect(40, 16, 72, 40)
    }
    for (const [id, bound] of Object.entries(bounds)) {
      document.getElementById(id)!.getBoundingClientRect = () => bound
    }

    const [token] = await collectControls(document)

    expect(token).toMatchObject({
      content: { kind: 'compound-row', textFlow: 'stacked' },
      sampleText: { value: 'Primary label', source: 'visible-text' },
      supportingText: { value: 'Support copy', source: 'visible-text' }
    })
  })

  it.each([
    {
      name: 'one plus one',
      lines: [['Primary'], ['Support']],
      expected: ['Primary', 'Support']
    },
    {
      name: 'one plus two',
      lines: [['Primary'], ['Support', 'copy']],
      expected: ['Primary', 'Support copy']
    },
    {
      name: 'two plus one',
      lines: [['Primary', 'label'], ['Support']],
      expected: ['Primary label', 'Support']
    },
    {
      name: 'three plus two',
      lines: [['Primary', 'language', 'label'], ['Support', 'copy']],
      expected: ['Primary language label', 'Support copy']
    }
  ])('recognizes arbitrary positive fragment counts for $name', async ({ name, lines, expected }) => {
    const spanMarkup = lines.flatMap((line, lineIndex) => line.map((value, fragmentIndex) =>
      `<span id="line-${lineIndex}-${fragmentIndex}">${value}</span>`
    )).join(' ')
    const dom = new JSDOM(
      `<button id="row" style="width:309px;height:72px;padding:8px">${spanMarkup}</button>`,
      { pretendToBeVisual: true }
    )
    const document = dom.window.document
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect = () => rect(309, 72)
    lines.forEach((line, lineIndex) => {
      let x = 16
      line.forEach((_value, fragmentIndex) => {
        const element = document.getElementById(`line-${lineIndex}-${fragmentIndex}`)!
        const width = 32 + fragmentIndex * 4
        const y = 12 + lineIndex * 28
        const bounds = rect(width, 16, x, y)
        element.getBoundingClientRect = () => bounds
        x += width + 4
      })
    })

    const [token] = await collectControls(document)

    expect(token).toMatchObject({
      content: { kind: 'compound-row', textFlow: 'stacked' },
      sampleText: { value: expected[0], source: 'visible-text' },
      supportingText: { value: expected[1], source: 'visible-text' }
    })
  })

  it('keeps typography differences as a hard merge boundary', async () => {
    const dom = new JSDOM(`
      <button id="row" style="width:309px;height:72px;padding:8px">
        <span id="primary-a">Primary</span>
        <span id="primary-b" style="font-weight:700">label</span>
        <span id="support-a">Support</span>
        <span id="support-b">copy</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect = () => rect(309, 72)
    const bounds: Record<string, DOMRect> = {
      'primary-a': rect(48, 16, 16, 12),
      'primary-b': rect(40, 16, 72, 12),
      'support-a': rect(48, 16, 16, 40),
      'support-b': rect(40, 16, 72, 40)
    }
    for (const [id, bound] of Object.entries(bounds)) {
      document.getElementById(id)!.getBoundingClientRect = () => bound
    }

    const [token] = await collectControls(document)

    expect(token?.content).toEqual({ kind: 'text-only' })
    expect(token?.sampleText).toBeUndefined()
    expect(token?.supportingText).toBeUndefined()
  })

  it('does not merge four safe fragments when they are not two bounded visual lines', async () => {
    const cases = [
      {
        name: 'four separate lines',
        positions: [[16, 8], [16, 26], [16, 44], [16, 62]]
      },
      {
        name: 'two remote columns',
        positions: [[16, 12], [176, 12], [16, 40], [176, 40]]
      }
    ]
    for (const specimen of cases) {
      const dom = new JSDOM(`
        <button id="row" style="width:309px;height:72px;padding:8px">
          <span id="a">First</span><span id="b">second</span>
          <span id="c">Third</span><span id="d">fourth</span>
        </button>
      `, { pretendToBeVisual: true })
      const document = dom.window.document
      document.querySelector<HTMLElement>('#row')!.getBoundingClientRect = () => rect(309, 72)
      for (const [index, id] of ['a', 'b', 'c', 'd'].entries()) {
        const [x, y] = specimen.positions[index]!
        document.getElementById(id)!.getBoundingClientRect = () => rect(40, 16, x, y)
      }

      const [token] = await collectControls(document)
      expect(token?.content, specimen.name).toEqual({ kind: 'text-only' })
    }
  })

  it('does not export a merged line that fails the existing safe-copy gate', async () => {
    const dom = new JSDOM(`
      <button id="row" style="width:309px;height:72px;padding:8px">
        <span id="a">A!B!</span><span id="b">C!D!</span>
        <span id="c">Support</span><span id="d">copy</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect = () => rect(309, 72)
    const bounds: Record<string, DOMRect> = {
      a: rect(48, 24, 16, 12), b: rect(72, 24, 72, 12),
      c: rect(48, 20, 16, 40), d: rect(32, 20, 72, 40)
    }
    for (const [id, value] of Object.entries(bounds)) {
      document.getElementById(id)!.getBoundingClientRect = () => value
    }

    const [token] = await collectControls(document)
    expect(token?.content).toEqual({ kind: 'text-only' })
    expect(token?.supportingText).toBeUndefined()
  })

  it('writes an anonymous anatomy trace for a 72px clipped-list button whose three visual rows cannot become a compound row', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="listbox" style="overflow-y:auto;width:309px;height:216px">
        <button id="previous" style="width:309px;height:72px"><span>Previous label</span><span>Previous support</span></button>
        <button id="target" style="width:309px;height:72px"><span>Split</span><span> label</span><span>Supporting label</span></button>
        <button id="next" style="width:309px;height:72px"><span>Next label</span><span>Next support</span></button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/private-route' })
    const document = dom.window.document
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!
    list.getBoundingClientRect = () => rect(309, 216)
    const setRect = (id: string, x: number, y: number) => {
      document.getElementById(id)!.getBoundingClientRect = () => rect(309, 72, x, y)
    }
    setRect('previous', 0, 0)
    setRect('target', 0, 72)
    setRect('next', 0, 144)
    const textRects: Record<string, DOMRect> = {
      'Previous label': rect(96, 20, 24, 12),
      'Previous support': rect(112, 20, 24, 36),
      Split: rect(32, 20, 24, 84),
      ' label': rect(40, 20, 60, 108),
      'Supporting label': rect(112, 20, 24, 132),
      'Next label': rect(72, 20, 24, 156),
      'Next support': rect(88, 20, 24, 180)
    }
    for (const span of Array.from(document.querySelectorAll<HTMLElement>('span'))) {
      span.getBoundingClientRect = () => textRects[span.textContent ?? '']!
    }

    const baseline = await collectControlsWithObservations(document)
    const diagnostics = createControlDiagnosticRecorder(document)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const collected = await collectControlsWithObservations(document, { diagnostics })
    await diagnostics.finalize()

    const traces = log.mock.calls
      .map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.kind === 'control-anatomy-trace-v1')
    log.mockRestore()

    expect(collected.controls).toEqual(baseline.controls)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      family: 'button',
      role: 'button',
      productCommand: true,
      privateContext: false,
      relativeRowOrder: 'target',
      rawDirectTextCandidateCount: 3,
      renderedTextCandidateCount: 3,
      safeTextCandidateCount: 3,
      lineClusterCount: 3,
      lineRegionCounts: [1, 1, 1],
      nestedControlBoundaryExcludedCount: 0,
      allowCompound: true,
      anatomyTextRegionCount: 3,
      compoundFound: false,
      samplePresent: true,
      supportingPresent: false,
      controlSampleCandidatePresent: false,
      baselineRows: [
        { relativeRowOrder: 'previous' },
        { relativeRowOrder: 'next' }
      ]
    })
    const serialized = JSON.stringify(traces)
    expect(serialized).not.toContain('Split')
    expect(serialized).not.toContain('Supporting label')
    expect(serialized).not.toContain('"id":"target"')
    expect(serialized).not.toContain('private-route')
    expect(serialized).not.toContain('example.com')
  })

  it('writes a v2 anonymous merge trace for a text-only clipped-list candidate without changing product output', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="listbox" style="overflow-y:auto;width:309px;height:216px">
        <button id="previous" style="width:309px;height:72px"><span>Previous label</span><span>Previous support</span></button>
        <button id="target" style="width:309px;height:72px"><span>Primary left</span><span style="font-weight:700">Primary right</span><span>Support left</span><span>Support right</span></button>
        <button id="next" style="width:309px;height:72px"><span>Next label</span><span>Next support</span></button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!
    list.getBoundingClientRect = () => rect(309, 216)
    const setRect = (id: string, y: number) => {
      document.getElementById(id)!.getBoundingClientRect = () => rect(309, 72, 0, y)
    }
    setRect('previous', 0)
    setRect('target', 72)
    setRect('next', 144)
    const textRects: Record<string, DOMRect> = {
      'Previous label': rect(80, 16, 24, 12),
      'Previous support': rect(100, 16, 24, 32),
      'Primary left': rect(48, 16, 24, 84),
      'Primary right': rect(56, 16, 74, 84),
      'Support left': rect(56, 16, 24, 108),
      'Support right': rect(64, 16, 82, 108),
      'Next label': rect(72, 16, 24, 156),
      'Next support': rect(96, 16, 24, 176)
    }
    for (const span of Array.from(document.querySelectorAll<HTMLElement>('span'))) {
      span.getBoundingClientRect = () => textRects[span.textContent ?? '']!
    }

    const baseline = await collectControlsWithObservations(document)
    const diagnostics = createControlDiagnosticRecorder(document)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const collected = await collectControlsWithObservations(document, { diagnostics })
    await diagnostics.finalize()
    const traces = log.mock.calls
      .map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.kind === 'control-anatomy-merge-trace-v2')
    log.mockRestore()

    expect(collected.controls).toEqual(baseline.controls)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      runtimeRevision: expect.stringMatching(/^merge-v3-/),
      preRegionCount: 4,
      preLineRegionCounts: [2, 2],
      mergeDecision: 'style',
      rows: [
        {
          styleCompatible: false,
          styleDifferences: {
            fontWeight: true,
            color: false
          }
        },
        {
          styleCompatible: true,
          styleDifferences: {
            fontWeight: false,
            color: false
          }
        }
      ],
      contentKindBefore: 'text-only',
      contentKindAfter: 'text-only',
      anatomyTextRegionCount: 4,
      compoundFound: false,
      samplePresent: false,
      supportingPresent: false
    })
    const serialized = JSON.stringify(traces)
    expect(serialized).not.toContain('Primary left')
    expect(serialized).not.toContain('Support right')
    expect(serialized).not.toContain('canonical')
    expect(serialized).not.toContain('example.com')
  })

  it('writes anonymous selected-state provenance without changing the collected state', async () => {
    const dom = new JSDOM(`
      <div role="listbox" style="width:320px;height:216px">
        <button id="default-peer" style="display:flex;width:309px;height:72px;padding:8px;background:transparent">
          <span>Default label</span><span>Default support</span>
        </button>
        <button id="target" data-state="selected" style="display:flex;width:309px;height:72px;padding:8px;background:rgba(0,0,0,.05)">
          <span>Selected label</span><span>Selected support</span>
          <span id="carrier" style="display:block;width:40px;height:40px;border-radius:50%;background:white">
            <svg id="check" viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor"/></svg>
          </span>
        </button>
        <button id="hover-peer" data-smart-scan-hover-target="true" style="display:flex;width:309px;height:72px;padding:8px;background:rgba(0,0,0,.08)">
          <span>Hover label</span><span>Hover support</span>
        </button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('[role="listbox"]')!.getBoundingClientRect =
      () => rect(320, 216)
    const rows: Record<string, DOMRect> = {
      'default-peer': rect(309, 72, 0, 0),
      target: rect(309, 72, 0, 72),
      'hover-peer': rect(309, 72, 0, 144)
    }
    for (const [id, bounds] of Object.entries(rows)) {
      document.getElementById(id)!.getBoundingClientRect = () => bounds
    }
    const textBounds: Record<string, DOMRect> = {
      'Default label': rect(96, 20, 16, 12),
      'Default support': rect(112, 20, 16, 34),
      'Selected label': rect(104, 20, 16, 84),
      'Selected support': rect(120, 20, 16, 106),
      'Hover label': rect(80, 20, 16, 156),
      'Hover support': rect(96, 20, 16, 178)
    }
    for (const span of Array.from(document.querySelectorAll<HTMLElement>('button span'))) {
      span.getBoundingClientRect = () => textBounds[span.textContent ?? '']!
    }
    document.getElementById('carrier')!.getBoundingClientRect = () => rect(40, 40, 253, 88)
    document.getElementById('check')!.getBoundingClientRect = () => rect(20, 20, 263, 98)

    const baseline = await collectControlsWithObservations(document)
    const diagnostics = createControlDiagnosticRecorder(document)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const collected = await collectControlsWithObservations(document, { diagnostics })
    await diagnostics.finalize()
    const traces = log.mock.calls
      .map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.kind === 'control-state-provenance-trace-v1')
    log.mockRestore()

    expect(collected.controls).toEqual(baseline.controls)
    expect(collected.controls.find(token => token.sampleText?.value === 'Selected label')?.state)
      .toBe('default')
    expect(traces).toHaveLength(3)
    expect(traces.map(trace => trace.traceRole).sort()).toEqual([
      'default-peer', 'hover-peer', 'target'
    ])
    const target = traces.find(trace => trace.traceRole === 'target')
    expect(target).toMatchObject({
      family: 'button',
      contentKind: 'compound-row',
      collectedState: 'default',
      preNormalizeState: 'default',
      decisionSource: 'default',
      ownership: {
        interaction: {
          sameNodeAsInteraction: true,
          onlyTargetControl: true,
          signals: { dataState: 'selected' }
        }
      },
      markerScope: { sameControlOnly: true },
      visualFacts: {
        rowPainted: true,
        trailingVector: true,
        trailingSurface: true,
        surfaceRound: true,
        surfaceContainsGraphic: true
      },
      peerComparison: {
        markerPeerCount: 0,
        paintedNoMarkerPeer: true,
        hoverPaintedNoMarkerPeer: true
      }
    })
    const serialized = JSON.stringify(traces)
    expect(serialized).not.toContain('Selected label')
    expect(serialized).not.toContain('"id":"target"')
    expect(serialized).not.toContain('example.com')
  })

  it('writes anonymous ownership traces for distinct transient input rejection paths', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="listbox">
        <div id="other-surface" style="width:300px;height:48px;background:rgb(230,230,230)">
          <input id="other-input" style="width:200px;height:24px;padding:0;border:0;background:transparent" />
          <button id="other-control" style="width:24px;height:24px">Extra</button>
        </div>
        <div id="tall-surface" style="width:300px;height:80px;background:rgb(230,230,230)">
          <input id="tall-input" style="width:240px;height:24px;padding:0;border:0;background:transparent" />
        </div>
        <div id="inset-surface" style="width:300px;height:64px;background:rgb(230,230,230)">
          <input id="inset-input" style="width:240px;height:24px;padding:0;border:0;background:transparent" />
        </div>
        <div id="slot-surface" style="display:flex;width:300px;height:64px;background:rgb(230,230,230)">
          <svg id="slot-icon" viewBox="0 0 16 16"><path d="M2 2h12v12H2Z"/></svg>
          <input id="slot-input" style="width:240px;height:24px;padding:0;border:0;background:transparent" />
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/private-route' })
    const document = dom.window.document
    const setRect = (id: string, width: number, height: number, x: number, y: number) => {
      document.getElementById(id)!.getBoundingClientRect = () => rect(width, height, x, y)
    }
    const transient = document.querySelector<HTMLElement>('[role="listbox"]')!
    transient.getBoundingClientRect = () => rect(320, 320)
    setRect('other-surface', 300, 48, 0, 0)
    setRect('other-input', 200, 24, 8, 12)
    setRect('other-control', 24, 24, 260, 12)
    setRect('tall-surface', 300, 80, 0, 80)
    setRect('tall-input', 240, 24, 16, 108)
    setRect('inset-surface', 300, 64, 0, 176)
    setRect('inset-input', 240, 24, 30, 196)
    setRect('slot-surface', 300, 64, 0, 256)
    setRect('slot-icon', 16, 16, 16, 280)
    setRect('slot-input', 240, 24, 48, 276)
    const baseline = await collectControlsWithObservations(document)
    const diagnostics = createControlDiagnosticRecorder(document)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const collected = await collectControlsWithObservations(document, { diagnostics })
    await diagnostics.finalize()

    const traces = log.mock.calls
      .map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.kind === 'control-ownership-trace-v1')
    log.mockRestore()

    expect(collected.controls).toEqual(baseline.controls)
    expect(traces).toHaveLength(4)
    const ancestors = traces.flatMap(trace => trace.ancestors)
    expect(ancestors.some(ancestor => ancestor.decision === 'other-visible-control')).toBe(true)
    expect(ancestors.some(ancestor => ancestor.decision === 'height-delta-over-48')).toBe(true)
    expect(ancestors.some(ancestor =>
      ancestor.paint.elementPaint && !ancestor.insetMatch && !ancestor.overlayMatch
    )).toBe(true)
    expect(ancestors.some(ancestor =>
      ancestor.renderedSiblingGraphics === '1' && !ancestor.ownsSiblingGraphic
    )).toBe(true)
    const serialized = JSON.stringify(traces)
    expect(serialized).not.toContain('other-input')
    expect(serialized).not.toContain('private-route')
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('background:rgb')
  })

  it('keeps an accepted transient input and product output free of ownership traces', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="listbox">
        <div id="shell" style="width:240px;height:36px;padding:6px 12px;background:rgb(240,240,240)">
          <input id="field" style="width:216px;height:24px;padding:0;border:0;background:transparent" />
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('[role="listbox"]')!.getBoundingClientRect =
      () => rect(264, 48)
    document.querySelector<HTMLElement>('#shell')!.getBoundingClientRect =
      () => rect(240, 36)
    document.querySelector<HTMLElement>('#field')!.getBoundingClientRect =
      () => rect(216, 24, 12, 6)
    const baseline = await collectControlsWithObservations(document)
    const diagnostics = createControlDiagnosticRecorder(document)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const collected = await collectControlsWithObservations(document, { diagnostics })
    await diagnostics.finalize()
    const traces = log.mock.calls
      .map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.kind === 'control-ownership-trace-v1')
    log.mockRestore()

    expect(collected.controls).toEqual(baseline.controls)
    expect(traces).toEqual([])
  })

  it('uses a padded graphic shell as the painted owner of a transparent input', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="listbox">
        <div data-shell style="display:flex;width:308px;height:48px;padding:12px 16px;background:rgb(230,230,230);border-radius:12px">
          <svg data-graphic viewBox="0 0 16 16"><path d="M2 2h12v12H2Z"/></svg>
          <input data-input style="width:240px;height:24px;padding:0;border:0;background:transparent" />
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('[role="listbox"]')!.getBoundingClientRect =
      () => rect(340, 64)
    document.querySelector<HTMLElement>('[data-shell]')!.getBoundingClientRect =
      () => rect(308, 48)
    document.querySelector<SVGElement>('[data-graphic]')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    document.querySelector<HTMLElement>('[data-input]')!.getBoundingClientRect =
      () => rect(240, 24, 52, 12)
    const diagnostics = createControlDiagnosticRecorder(document)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const collected = await collectControlsWithObservations(document, { diagnostics })
    await diagnostics.finalize()
    const traces = log.mock.calls
      .map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.kind === 'control-ownership-trace-v1')
    log.mockRestore()

    expect(traces).toEqual([])
    expect(collected.controls).toHaveLength(1)
    expect(collected.observations).toHaveLength(1)
    const [observation] = collected.observations
    const shell = document.querySelector<HTMLElement>('[data-shell]')!
    const input = document.querySelector<HTMLElement>('[data-input]')!
    expect(observation?.ownership).toEqual({
      interaction: input,
      layout: shell,
      paint: shell,
      slots: shell,
      compositeAnchor: shell
    })
    expect(collected.controls[0]).toMatchObject({
      family: 'input',
      geometry: {
        minWidth: 308,
        height: 48,
        padding: { top: 12, right: 16, bottom: 12, left: 16 },
        radius: 12
      },
      appearance: { background: { r: 0.902, g: 0.902, b: 0.902, a: 1 } },
      slots: { leading: { assetType: 'ui-icon', width: 16, height: 16 } }
    })
  })

  it('keeps padded graphic-shell promotion behind its existing safety gates', async () => {
    const cases = [
      {
        name: 'no-owned-graphic',
        markup: '<div data-shell style="display:flex;width:308px;height:48px;padding:12px 16px;background:rgb(230,230,230)"><input data-input style="width:240px;height:24px;padding:0;border:0;background:transparent" /></div>',
        shell: rect(308, 48), input: rect(240, 24, 52, 12)
      },
      {
        name: 'mismatched-vertical-padding',
        markup: '<div data-shell style="display:flex;width:308px;height:48px;padding:12px 16px;background:rgb(230,230,230)"><svg data-graphic viewBox="0 0 16 16"><path d="M2 2h12v12H2Z"/></svg><input data-input style="width:240px;height:24px;padding:0;border:0;background:transparent" /></div>',
        shell: rect(308, 48), input: rect(240, 24, 52, 8), graphic: rect(16, 16, 16, 16)
      },
      {
        name: 'second-visible-control',
        markup: '<div data-shell style="display:flex;width:308px;height:48px;padding:12px 16px;background:rgb(230,230,230)"><svg data-graphic viewBox="0 0 16 16"><path d="M2 2h12v12H2Z"/></svg><input data-input style="width:240px;height:24px;padding:0;border:0;background:transparent" /><button data-extra style="width:16px;height:16px">x</button></div>',
        shell: rect(308, 48), input: rect(240, 24, 52, 12), graphic: rect(16, 16, 16, 16), extra: rect(16, 16, 280, 16)
      },
      {
        name: 'width-over-96',
        markup: '<div data-shell style="display:flex;width:308px;height:48px;padding:12px 16px;background:rgb(230,230,230)"><svg data-graphic viewBox="0 0 16 16"><path d="M2 2h12v12H2Z"/></svg><input data-input style="width:240px;height:24px;padding:0;border:0;background:transparent" /></div>',
        shell: rect(337, 48), input: rect(240, 24, 52, 12), graphic: rect(16, 16, 16, 16)
      },
      {
        name: 'height-over-48',
        markup: '<div data-shell style="display:flex;width:308px;height:48px;padding:12px 16px;background:rgb(230,230,230)"><svg data-graphic viewBox="0 0 16 16"><path d="M2 2h12v12H2Z"/></svg><input data-input style="width:240px;height:24px;padding:0;border:0;background:transparent" /></div>',
        shell: rect(308, 73), input: rect(240, 24, 52, 12), graphic: rect(16, 16, 16, 16)
      }
    ]

    for (const specimen of cases) {
      const dom = new JSDOM(
        `<div data-smart-scan-transient-structure="true" role="listbox">${specimen.markup}</div>`,
        { pretendToBeVisual: true, url: 'https://example.com/' }
      )
      const document = dom.window.document
      document.querySelector<HTMLElement>('[role="listbox"]')!.getBoundingClientRect =
        () => rect(400, 120)
      document.querySelector<HTMLElement>('[data-shell]')!.getBoundingClientRect =
        () => specimen.shell
      document.querySelector<HTMLElement>('[data-input]')!.getBoundingClientRect =
        () => specimen.input
      const graphic = document.querySelector<SVGElement>('[data-graphic]')
      if (graphic && specimen.graphic) graphic.getBoundingClientRect = () => specimen.graphic!
      const extra = document.querySelector<HTMLElement>('[data-extra]')
      if (extra && specimen.extra) extra.getBoundingClientRect = () => specimen.extra!

      const collected = await collectControlsWithObservations(document)
      expect(
        collected.controls.filter(control => control.family === 'input'),
        specimen.name
      ).toEqual([])
    }
  })

  it('uses the rendered text node style and geometric icon spacing when the control root is generic', async () => {
    const dom = new JSDOM(`
      <button id="control" style="
        width:180px;height:48px;padding:8px 12px;
        font-family:Arial;font-size:14px;color:rgb(20,20,20)
      ">
        <svg id="leading" viewBox="0 0 24 24" fill="none">
          <path d="M4 12h16" stroke="currentColor"/>
        </svg>
        <span id="label" style="
          font-family:'Google Sans Flex';font-size:16px;font-weight:500;
          line-height:24px;color:rgb(40,80,120)
        ">Flash</span>
        <svg id="trailing" viewBox="0 0 24 24" fill="none">
          <path d="m8 10 4 4 4-4" stroke="currentColor"/>
        </svg>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#control')!.getBoundingClientRect =
      () => rect(180, 48)
    document.querySelector<HTMLElement>('#leading')!.getBoundingClientRect =
      () => rect(24, 24, 12, 12)
    document.querySelector<HTMLElement>('#label')!.getBoundingClientRect =
      () => rect(72, 24, 48, 12)
    document.querySelector<HTMLElement>('#trailing')!.getBoundingClientRect =
      () => rect(24, 24, 132, 12)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      geometry: { gap: 12 },
      appearance: {
        foreground: {
          r: 0.1569,
          g: 0.3137,
          b: 0.4706,
          a: 1
        }
      },
      typography: {
        fontFamilyStack: ['Google Sans Flex'],
        fontSizePx: 16,
        fontWeight: 500,
        lineHeightPx: 24
      },
      content: { kind: 'icon-both' },
      slots: {
        leading: { assetType: 'ui-icon' },
        trailing: { assetType: 'ui-icon' }
      }
    })
  })

  it('keeps reusable template identity separate from logical controls and content instances', async () => {
    const dom = new JSDOM(`
      <div role="menu">
        <button id="first" style="height:40px;padding:8px 12px">Search the web</button>
        <button id="second" style="height:40px;padding:8px 12px">Create an image</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/workspace' })
    const [first, second] = Array.from(dom.window.document.querySelectorAll<HTMLElement>('button'))
    first!.getBoundingClientRect = () => rect(180, 40, 0, 0)
    second!.getBoundingClientRect = () => rect(180, 40, 0, 44)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(2)
    expect(new Set(tokens.map(token => token.templateId))).toEqual(
      new Set([tokens[0]?.templateId])
    )
    expect(tokens[0]?.logicalControlId).not.toBe(tokens[1]?.logicalControlId)
    expect(tokens[0]?.instanceId).not.toBe(tokens[1]?.instanceId)
    expect(JSON.stringify(tokens)).not.toContain('workspace')
    expect(JSON.stringify(tokens)).not.toContain('first')
    expect(JSON.stringify(tokens)).not.toContain('second')
  })

  it('treats a font-backed icon as a vector slot without serializing its ligature text', async () => {
    const fontBase64 = readFileSync(
      'tests/fixtures/font-icon-ligature.woff2.base64',
      'utf8'
    ).trim()
    const dom = new JSDOM(`
      <style>
        @font-face {
          font-family: "Material Symbols Outlined";
          src: url(data:font/woff2;base64,${fontBase64}) format("woff2");
        }
      </style>
      <button id="button" aria-label="Settings"
        style="width:32px;height:32px;padding:4px;background:#eee;border-radius:4px">
        <span id="icon" data-mat-icon-type="font" data-mat-icon-name="settings"
          style="font-family:'Material Symbols Outlined';display:inline-block">settings</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    ;(dom.window as unknown as { fetch: typeof fetch }).fetch = globalThis.fetch.bind(globalThis)
    Object.defineProperty(dom.window.performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{
        name: `data:font/woff2;base64,${fontBase64}`,
        entryType: 'resource',
        startTime: 0,
        duration: 0,
        toJSON: () => ({})
      }]
    })
    const button = document.querySelector('#button')!
    const icon = document.querySelector('#icon')!
    ;(button as HTMLElement).getBoundingClientRect = () => rect(32, 32)
    ;(icon as HTMLElement).getBoundingClientRect = () => rect(24, 24, 4, 4)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.content).toEqual({ kind: 'icon-only' })
    expect(tokens[0]?.slots.leading).toMatchObject({
      width: 24,
      height: 24,
      assetType: 'ui-icon'
    })
    expect(tokens[0]?.slots.leading?.vectorSvg).toContain('<path')
    expect(tokens[0]?.sampleText).toBeUndefined()
    expect(tokens[0]?.supportingText).toBeUndefined()
  })

  it('collects all observed families while preserving distinct control instances', async () => {
    const tokens = await collectControls(fixture().window.document)
    expect([...new Set(tokens.map(token => token.family))].sort()).toEqual([
      'button', 'checkbox', 'input', 'radio', 'select', 'textarea', 'toggle'
    ])
    expect(tokens.filter(token => token.family === 'button')).toHaveLength(2)
    expect(tokens.filter(token => token.family === 'button'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ occurrences: 1 }),
        expect.objectContaining({ occurrences: 1 })
      ]))
    expect(tokens.find(token => token.family === 'toggle')?.state).toBe('selected')
    expect(tokens.find(token => token.family === 'button')?.geometry.minWidth).toBeNull()
  })

  it('drops a text control implementation node when both its content and surface are invisible', async () => {
    const dom = new JSDOM(`
      <select id="internal" style="
        width:32px;height:32px;padding:0;border:0;border-radius:6px;
        color:rgba(0,0,0,0);background:transparent;
        box-shadow:inset 0 1px 0 rgba(31,35,40,0.04)
      "></select>
      <select id="visible" style="
        width:32px;height:32px;padding:0;border:1px solid rgb(208,215,222);
        border-radius:6px;
        color:rgb(31,35,40);background:transparent
      "></select>
    `, { pretendToBeVisual: true })
    const internal = dom.window.document.querySelector<HTMLElement>('#internal')!
    const visible = dom.window.document.querySelector<HTMLElement>('#visible')!
    internal.getBoundingClientRect = () => rect(32, 32)
    visible.getBoundingClientRect = () => rect(32, 32, 40)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.family).toBe('select')
    expect(tokens[0]?.appearance.foreground.a).toBe(1)
  })

  it('drops padding-only text fields that have no painted control surface', async () => {
    const dom = new JSDOM(`
      <input id="input" placeholder="Find a branch..." style="
        width:220px;height:30px;padding:1px 8px 1px 0;
        border:0;border-radius:0;outline:0;
        color:rgb(31,35,40);background:transparent
      " />
      <select id="select" style="
        width:80px;height:30px;padding:1px 0;
        border:0;border-radius:0;outline:0;
        color:rgb(31,35,40);background:transparent
      "></select>
    `, { pretendToBeVisual: true })
    const input = dom.window.document.querySelector<HTMLElement>('#input')!
    const select = dom.window.document.querySelector<HTMLElement>('#select')!
    input.getBoundingClientRect = () => rect(220, 30)
    select.getBoundingClientRect = () => rect(80, 30, 240)

    expect(await collectControls(dom.window.document)).toEqual([])
  })

  it('keeps a transparent combobox when one tight painted shell owns it', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="dialog">
        <div id="shell" style="
          width:260px;height:32px;padding:0;
          border:1px solid rgb(208,215,222);border-radius:6px;
          background:rgb(255,255,255)
        ">
          <input id="combobox" role="combobox" style="
            width:260px;height:32px;padding:5px 12px;
            border:0;outline:0;border-radius:0;background:transparent
          " />
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const shell = document.querySelector<HTMLElement>('#shell')!
    const combobox = document.querySelector<HTMLElement>('#combobox')!
    shell.getBoundingClientRect = () => rect(260, 32)
    combobox.getBoundingClientRect = () => rect(260, 32)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'select',
      geometry: {
        height: 32,
        minWidth: 260,
        radius: 6,
        borderWidth: 1
      }
    })
  })

  it('does not infer an editing-control owner from a positioned icon gutter alone', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="dialog">
        <div id="shell" style="
          position:relative;width:260px;height:32px;padding:0;
          border:1px solid rgb(208,215,222);border-radius:6px;
          background:rgb(255,255,255)
        ">
          <svg id="search" viewBox="0 0 16 16" fill="currentColor" style="position:absolute">
            <path d="M2 2h12v12H2Z"/>
          </svg>
          <input id="combobox" role="combobox" style="
            width:228px;height:32px;margin-left:32px;padding:5px 12px;
            border:0;outline:0;border-radius:0;background:transparent
          " />
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const shell = document.querySelector<HTMLElement>('#shell')!
    const search = document.querySelector<HTMLElement>('#search')!
    const combobox = document.querySelector<HTMLElement>('#combobox')!
    shell.getBoundingClientRect = () => rect(260, 32)
    search.getBoundingClientRect = () => rect(16, 16, 8, 8)
    combobox.getBoundingClientRect = () => rect(228, 32, 32)

    const tokens = await collectControls(document)

    expect(tokens).toEqual([])
  })

  it('keeps separate layout and painted owners for one transparent input', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="dialog">
        <div id="paint-shell" style="
          width:288px;height:32px;padding:0;
          border:1px solid rgb(208,215,222);border-radius:6px;
          background:rgb(255,255,255)
        ">
          <div id="layout-shell" style="
            display:flex;width:288px;height:32px;padding:0 0 0 8px;
            align-items:center;gap:8px;background:transparent
          ">
            <svg id="search" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v12H2Z"/>
            </svg>
            <input id="filter" placeholder="Filter items" style="
              width:256px;height:32px;padding:5px 12px;
              border:0;outline:0;border-radius:0;background:transparent
            " />
          </div>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const paintShell = document.querySelector<HTMLElement>('#paint-shell')!
    const layoutShell = document.querySelector<HTMLElement>('#layout-shell')!
    const search = document.querySelector<HTMLElement>('#search')!
    const input = document.querySelector<HTMLElement>('#filter')!
    paintShell.getBoundingClientRect = () => rect(288, 32)
    layoutShell.getBoundingClientRect = () => rect(288, 32)
    search.getBoundingClientRect = () => rect(16, 16, 8, 8)
    input.getBoundingClientRect = () => rect(256, 32, 32)

    const result = await collectControlsWithObservations(document)
    const observation = result.observations.find(item =>
      item.ownership.interaction === input
    )

    expect(observation?.ownership).toEqual({
      interaction: input,
      layout: layoutShell,
      paint: paintShell,
      slots: layoutShell,
      compositeAnchor: paintShell
    })
    expect(observation?.token).toMatchObject({
      family: 'input',
      geometry: {
        height: 32,
        minWidth: 288,
        radius: 6,
        borderWidth: 1
      },
      appearance: { background: { a: 1 }, border: { a: 1 } },
      slots: {
        leading: {
          assetType: 'ui-icon',
          width: 16,
          height: 16,
          vectorSvg: expect.stringContaining('<path')
        }
      },
      content: { kind: 'icon-leading' },
      layout: { contentAlignment: 'start' }
    })
  })

  it('uses a compact painted shell when visible graphics reserve horizontal space', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="dialog">
        <span id="shell" style="
          display:flex;width:304px;height:32px;padding:0 0 0 8px;
          align-items:center;border:1px solid rgb(208,215,222);
          border-radius:6px;background:rgb(255,255,255);
          box-shadow:0 0 0 2px rgba(9,105,218,0.3)
        ">
          <svg id="leading" viewBox="0 0 16 16" fill="currentColor"
            aria-hidden="true">
            <path d="M2 2h12v12H2Z"/>
          </svg>
          <input id="filter" role="combobox" placeholder="Filter items" style="
            width:246px;height:30px;padding:1px 8px 1px 0;
            border:0;outline:0;border-radius:0;background:transparent
          " />
          <svg id="hidden" viewBox="0 0 16 16" fill="currentColor"
            style="visibility:hidden">
            <path d="M3 3h10v10H3Z"/>
          </svg>
        </span>
      </div>
    `, {
      pretendToBeVisual: true,
      url: 'https://example.com/'
    })
    const document = dom.window.document
    const shell = document.querySelector<HTMLElement>('#shell')!
    const leading = document.querySelector<HTMLElement>('#leading')!
    const input = document.querySelector<HTMLElement>('#filter')!
    const hidden = document.querySelector<HTMLElement>('#hidden')!
    shell.getBoundingClientRect = () => rect(304, 32)
    leading.getBoundingClientRect = () => rect(16, 16, 9, 8)
    input.getBoundingClientRect = () => rect(246, 30, 33, 1)
    hidden.getBoundingClientRect = () => rect(16, 16, 287, 8)

    const result = await collectControlsWithObservations(document)
    const observation = result.observations.find(item =>
      item.ownership.interaction === input
    )

    expect(observation?.ownership).toEqual({
      interaction: input,
      layout: shell,
      paint: shell,
      slots: shell,
      compositeAnchor: shell
    })
    expect(observation?.token).toMatchObject({
      family: 'select',
      geometry: {
        height: 32,
        minWidth: 304,
        radius: 6,
        borderWidth: 1
      },
      appearance: {
        background: { a: 1 },
        border: { a: 1 }
      },
      slots: {
        leading: {
          assetType: 'ui-icon',
          width: 16,
          height: 16,
          vectorSvg: expect.stringContaining('<path')
        },
        trailing: null
      },
      content: { kind: 'icon-leading' },
      layout: { contentAlignment: 'start' }
    })
  })

  it('keeps a low-alpha neutral hover surface in the tertiary control family', async () => {
    const dom = new JSDOM(`
      <button id="default" style="
        width:32px;height:32px;padding:0 8px;border:0;border-radius:6px;
        color:rgb(89,99,110);background:transparent
      "><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v2H2z"/></svg></button>
      <button id="hover" style="
        width:32px;height:32px;padding:0 8px;border:0;border-radius:6px;
        color:rgb(89,99,110);background:rgba(129,139,152,0.15)
      "><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v2H2z"/></svg></button>
    `, { pretendToBeVisual: true })
    const defaultButton = dom.window.document.querySelector<HTMLElement>('#default')!
    const hoverButton = dom.window.document.querySelector<HTMLElement>('#hover')!
    const defaultIcon = defaultButton.querySelector<HTMLElement>('svg')!
    const hoverIcon = hoverButton.querySelector<HTMLElement>('svg')!
    defaultButton.getBoundingClientRect = () => rect(32, 32)
    hoverButton.getBoundingClientRect = () => rect(32, 32, 40)
    defaultIcon.getBoundingClientRect = () => rect(16, 16, 8, 8)
    hoverIcon.getBoundingClientRect = () => rect(16, 16, 48, 8)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(2)
    expect(tokens.every(token => token.intent === 'tertiary')).toBe(true)
    expect(new Set(tokens.map(token => token.groupId)).size).toBe(1)
  })

  it('does not read or serialize text, placeholders, asset identity or selectors', async () => {
    const dom = fixture()
    const button = dom.window.document.querySelector<HTMLButtonElement>('button')!
    Object.defineProperty(button, 'textContent', {
      configurable: true,
      get: () => { throw new Error('control collector must not read text') }
    })
    const serialized = JSON.stringify(await collectControls(dom.window.document))
    expect(serialized).not.toMatch(
      /Private notes|aria-label|svg|path|selector|example\.com/i
    )
  })

  it('keeps shared visual/template identity while preserving safe content instances', async () => {
    const dom = new JSDOM(`
      <button style="height:40px;padding:8px 12px;background:black;color:white">Share</button>
      <button style="height:40px;padding:8px 12px;background:black;color:white">Upgrade</button>
      <button style="height:40px;padding:8px 12px;background:black;color:white">Share</button>
    `, { pretendToBeVisual: true })
    dom.window.document.querySelectorAll<HTMLElement>('button').forEach(element => {
      element.getBoundingClientRect = () => rect(120, 40)
    })

    const tokens = await collectControls(dom.window.document)
    const single = new JSDOM(
      '<button style="height:40px;padding:8px 12px;background:black;color:white">Other label</button>',
      { pretendToBeVisual: true }
    )
    const singleButton = single.window.document.querySelector<HTMLElement>('button')!
    singleButton.getBoundingClientRect = () => rect(120, 40)
    const singleToken = (await collectControls(single.window.document))[0]
    expect(tokens).toHaveLength(3)
    expect(new Set(tokens.map(token => token.id))).toEqual(new Set([singleToken?.id]))
    expect(new Set(tokens.map(token => token.templateId)))
      .toEqual(new Set([singleToken?.templateId]))
    expect(new Set(tokens.map(token => token.logicalControlId)).size).toBe(3)
    expect(new Set(tokens.map(token => token.instanceId)).size).toBe(3)
    expect(tokens.map(token => token.sampleText?.value).sort()).toEqual([
      'Share', 'Share', 'Upgrade'
    ])
  })

  it('preserves compound primary and supporting copy as paired instances', async () => {
    const dom = new JSDOM(`
      <button class="row" style="
        width:220px;height:52px;padding:6px 8px;display:flex;
        align-items:center;gap:8px;border:0;background:transparent
      ">
        <span class="primary">Zulu option</span>
        <span class="supporting" style="color:rgb(120,120,120)">Second detail</span>
      </button>
      <button class="row" style="
        width:220px;height:52px;padding:6px 8px;display:flex;
        align-items:center;gap:8px;border:0;background:transparent
      ">
        <span class="primary">Alpha option</span>
        <span class="supporting" style="color:rgb(120,120,120)">First detail</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.querySelectorAll<HTMLElement>('.row').forEach((row, index) => {
      row.getBoundingClientRect = () => rect(220, 52, 0, index * 60)
      row.querySelector<HTMLElement>('.primary')!.getBoundingClientRect =
        () => rect(84, 20, 8, index * 60 + 6)
      row.querySelector<HTMLElement>('.supporting')!.getBoundingClientRect =
        () => rect(96, 20, 8, index * 60 + 30)
    })

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(2)
    expect(tokens.map(token => [
      token.sampleText?.value,
      token.supportingText?.value
    ]).sort()).toEqual([
      ['Alpha option', 'First detail'],
      ['Zulu option', 'Second detail']
    ])
  })

  it('classifies content structure and keeps only bounded safe sample labels', async () => {
    const dom = new JSDOM(`
      <button id="icon" style="width:36px;height:36px"><svg></svg></button>
      <button id="text" style="width:80px;height:36px">Private text</button>
      <button id="leading" style="width:100px;height:36px"><svg></svg>Private action</button>
      <button id="empty" style="width:36px;height:36px"></button>
    `, { pretendToBeVisual: true })
    dom.window.document.querySelectorAll<HTMLElement>('button').forEach(element => {
      element.getBoundingClientRect = () => rect(
        Number.parseFloat(element.style.width),
        Number.parseFloat(element.style.height)
      )
      element.querySelectorAll<HTMLElement>('svg').forEach(graphic => {
        graphic.getBoundingClientRect = () => rect(20, 20)
      })
    })

    const tokens = await collectControls(dom.window.document)
    expect(tokens.map(token => token.content.kind).sort()).toEqual([
      'icon-leading', 'icon-only', 'text-only'
    ])
    expect(tokens.find(token => token.content.kind === 'text-only')?.sampleText).toEqual({
      value: 'Private text',
      source: 'visible-text'
    })
    expect(tokens.find(token => token.content.kind === 'icon-leading')?.sampleText).toEqual({
      value: 'Private action',
      source: 'visible-text'
    })
  })

  it('preserves a UI vector from the promoted visual wrapper around a control', async () => {
    const dom = new JSDOM(`
      <div id="surface" style="
        display:flex;align-items:center;gap:3px;
        width:110px;height:34px;padding:0 12px;
        border:1px solid transparent;border-radius:8px
      ">
        <svg id="sparkle" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2 12 8 18 10 12 12 10 18 8 12 2 10 8 8Z"/>
        </svg>
        <button id="upgrade" style="
          width:70px;height:20px;padding:0;border:0;
          background:transparent;color:rgb(44,103,197)
        ">Upgrade</button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const surface = document.querySelector<HTMLElement>('#surface')!
    const sparkle = document.querySelector<HTMLElement>('#sparkle')!
    const upgrade = document.querySelector<HTMLElement>('#upgrade')!
    surface.getBoundingClientRect = () => rect(110, 34)
    sparkle.getBoundingClientRect = () => rect(20, 20, 12, 7)
    upgrade.getBoundingClientRect = () => rect(70, 20, 35, 7)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      content: { kind: 'icon-leading' },
      sampleText: { value: 'Upgrade', source: 'visible-text' },
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'ui-icon'
        }
      }
    })
    expect(tokens[0]?.slots.leading?.vectorSvg).toContain(
      'M10 2 12 8 18 10 12 12 10 18 8 12 2 10 8 8Z'
    )
  })

  it('preserves a nested UI icon and two-line copy as a fill-width compound row', async () => {
    const dom = new JSDOM(`
      <div id="menu" style="width:420px;padding:8px;display:flex;flex-direction:column">
        <button id="row" style="
          width:100%;
          height:52px;
          padding:6px 8px;
          display:flex;
          align-items:center;
          gap:10px;
          border:0;
          border-radius:8px;
          background:transparent;
          color:rgb(13,13,13)
        ">
          <span id="icon-wrap">
            <svg id="paperclip" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 12.5 14.5 6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7.1-7.1l8-8"
                stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <span id="copy" style="display:flex;flex-direction:column">
            <span id="primary">Add photos &amp; files</span>
            <span id="supporting" style="color:rgb(143,143,143)">Upload from computer</span>
          </span>
        </button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('#menu')!
    const row = document.querySelector<HTMLElement>('#row')!
    const iconWrap = document.querySelector<HTMLElement>('#icon-wrap')!
    const svg = document.querySelector<HTMLElement>('#paperclip')!
    const copy = document.querySelector<HTMLElement>('#copy')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    menu.getBoundingClientRect = () => rect(420, 68)
    row.getBoundingClientRect = () => rect(404, 52, 8, 8)
    iconWrap.getBoundingClientRect = () => rect(24, 24, 16, 22)
    svg.getBoundingClientRect = () => rect(24, 24, 16, 22)
    copy.getBoundingClientRect = () => rect(180, 40, 50, 14)
    primary.getBoundingClientRect = () => rect(132, 20, 50, 14)
    supporting.getBoundingClientRect = () => rect(150, 20, 50, 34)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      geometry: {
        minWidth: 404
      },
      content: {
        kind: 'compound-row',
        trailing: 'none',
        textFlow: 'stacked',
        textGap: 0
      },
      layout: {
        widthBehavior: 'fill'
      },
      slots: {
        leading: {
          width: 24,
          height: 24,
          assetType: 'ui-icon'
        }
      },
      sampleText: {
        value: 'Add photos & files',
        source: 'visible-text'
      },
      supportingText: {
        value: 'Upload from computer',
        source: 'visible-text'
      }
    })
    expect((tokens[0] as unknown as {
      slots: { leading: { vectorSvg?: string } | null }
    }).slots.leading?.vectorSvg).toContain('<path')
  })

  it('preserves inline primary and supporting copy as one compound menu row', async () => {
    const dom = new JSDOM(`
      <div id="menu" style="width:420px;padding:8px">
        <button id="row" style="
          width:100%;height:52px;padding:6px 8px;display:flex;
          align-items:center;gap:10px;border:0;background:transparent
        ">
          <svg id="paperclip" viewBox="0 0 24 24" fill="none">
            <path d="M8 12 16 4" stroke="currentColor"/>
          </svg>
          <span id="primary">Add photos &amp; files</span>
          <span id="supporting" style="color:rgb(143,143,143)">Upload from computer</span>
        </button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('#menu')!
    const row = document.querySelector<HTMLElement>('#row')!
    const icon = document.querySelector<HTMLElement>('#paperclip')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    menu.getBoundingClientRect = () => rect(420, 68)
    row.getBoundingClientRect = () => rect(404, 52, 8, 8)
    icon.getBoundingClientRect = () => rect(24, 24, 16, 22)
    primary.getBoundingClientRect = () => rect(132, 20, 50, 24)
    supporting.getBoundingClientRect = () => rect(150, 20, 190, 24)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      content: {
        kind: 'compound-row',
        trailing: 'none',
        textFlow: 'inline',
        textGap: 8
      },
      sampleText: { value: 'Add photos & files' },
      supportingText: { value: 'Upload from computer' }
    })
  })

  it('treats space-between separation as responsive layout rather than literal text spacing', async () => {
    const dom = new JSDOM(`
      <div id="menu" style="width:420px;padding:8px">
        <button id="row" style="
          width:360px;height:40px;padding:6px 8px;display:flex;
          align-items:center;justify-content:space-between;border:0;
          border-radius:6px;background:rgb(245,245,245)
        ">
          <svg id="check" viewBox="0 0 20 20" fill="none">
            <path d="m3 10 4 4 10-10" stroke="currentColor"/>
          </svg>
          <span id="primary">main</span>
          <span id="supporting">default</span>
        </button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('#menu')!
    const row = document.querySelector<HTMLElement>('#row')!
    const check = document.querySelector<HTMLElement>('#check')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    menu.getBoundingClientRect = () => rect(420, 56)
    row.getBoundingClientRect = () => rect(360, 40, 8, 8)
    check.getBoundingClientRect = () => rect(16, 16, 16, 20)
    primary.getBoundingClientRect = () => rect(32, 20, 44, 18)
    supporting.getBoundingClientRect = () => rect(48, 20, 312, 18)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      geometry: { minWidth: 360 },
      layout: { widthBehavior: 'fill' },
      content: {
        kind: 'compound-row',
        textFlow: 'inline',
        textGap: 8
      },
      sampleText: { value: 'main' },
      supportingText: { value: 'default' }
    })
  })

  it('preserves a composer as one compound input with actions on both sides', async () => {
    const dom = new JSDOM(`
      <div id="composer" style="
        width:640px;height:52px;padding:6px 8px;
        display:flex;align-items:center;gap:8px;
        border:1px solid rgb(220,220,220);border-radius:26px;background:white
      ">
        <button id="plus" style="
          width:36px;height:36px;border:0;border-radius:4px;
          background:rgb(245,245,245);color:rgb(13,13,13)
        ">
          <span aria-hidden="true">
            <svg id="plus-icon" viewBox="0 0 24 24" fill="none">
              <path d="M12 4v16M4 12h16" stroke="currentColor"/>
            </svg>
          </span>
        </button>
        <input id="prompt" placeholder="Ask anything" style="
          width:500px;height:40px;border:0;background:transparent;color:rgb(13,13,13)
        "/>
        <button id="mic" style="
          width:32px;height:32px;border:0;border-radius:16px;
          background:transparent;color:rgb(13,13,13)
        ">
          <span aria-hidden="true">
            <svg id="mic-icon" viewBox="0 0 24 24" fill="none">
              <path d="M12 4v10" stroke="currentColor"/>
            </svg>
          </span>
        </button>
        <button id="voice" style="
          width:40px;height:40px;border:0;border-radius:20px;
          background:black;color:white
        ">
          <span aria-hidden="true">
            <svg id="voice-icon" viewBox="0 0 24 24" fill="none">
              <path d="M6 12h12" stroke="white"/>
            </svg>
          </span>
        </button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      composer: rect(640, 52, 0, 0),
      plus: rect(36, 36, 8, 8),
      'plus-icon': rect(20, 20, 16, 16),
      prompt: rect(500, 40, 52, 6),
      mic: rect(32, 32, 560, 10),
      'mic-icon': rect(20, 20, 566, 16),
      voice: rect(40, 40, 600, 6),
      'voice-icon': rect(20, 20, 610, 16)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'input',
      geometry: {
        height: 52,
        minWidth: 640,
        radius: 26
      },
      content: { kind: 'compound-input' },
      layout: { widthBehavior: 'fill' },
      sampleText: { value: 'Ask anything', source: 'placeholder' },
      slotGroups: {
        leading: [expect.objectContaining({
          width: 20,
          height: 20,
          assetType: 'ui-icon',
          surface: expect.objectContaining({
            width: 36,
            height: 36,
            borderWidth: 0,
            radii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 }
          })
        })],
        trailing: [
          expect.objectContaining({
            width: 20,
            height: 20,
            assetType: 'ui-icon',
            surface: expect.objectContaining({
              width: 32,
              height: 32,
              radii: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 }
            })
          }),
          expect.objectContaining({
            width: 20,
            height: 20,
            assetType: 'ui-icon',
            surface: expect.objectContaining({
              width: 40,
              height: 40,
              radii: { topLeft: 20, topRight: 20, bottomRight: 20, bottomLeft: 20 }
            })
          })
        ]
      }
    })
    expect(tokens[0]?.slotGroups?.leading[0]?.surface).toMatchObject({
      background: { r: 0.9608, g: 0.9608, b: 0.9608, a: 1 },
      foreground: { r: 0.051, g: 0.051, b: 0.051, a: 1 }
    })
    expect(tokens[0]?.slotGroups?.trailing[1]?.surface).toMatchObject({
      background: { r: 0, g: 0, b: 0, a: 1 },
      foreground: { r: 1, g: 1, b: 1, a: 1 }
    })
  })

  it.each([
    ['visibility:hidden', 'visibility:hidden'],
    ['opacity:0', 'opacity:0']
  ])('rejects a compact action graphic hidden by a %s wrapper', async (_label, hiddenStyle) => {
    const dom = new JSDOM(`
      <div id="composer" style="
        width:360px;height:52px;padding:6px 8px;
        display:flex;align-items:center;gap:8px;
        border:1px solid rgb(220,220,220);border-radius:26px;background:white
      ">
        <button id="plus" style="width:36px;height:36px;border:0">
          <span style="${hiddenStyle}">
            <svg id="plus-icon" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>
          </span>
        </button>
        <input id="prompt" placeholder="Ask anything" style="width:240px;height:40px" />
        <button id="send" style="width:40px;height:40px;border:0">
          <span aria-hidden="true">
            <svg id="send-icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
          </span>
        </button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      composer: rect(360, 52),
      plus: rect(36, 36, 8, 8),
      'plus-icon': rect(20, 20, 16, 16),
      prompt: rect(240, 40, 52, 6),
      send: rect(40, 40, 312, 6),
      'send-icon': rect(20, 20, 322, 16)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const tokens = await collectControls(document)

    expect(tokens.some(token => token.content.kind === 'compound-input')).toBe(false)
  })

  it('treats clipped screen-reader text as non-visual beside a rendered icon', async () => {
    const dom = new JSDOM(`
      <button id="settings" style="width:32px;height:32px;padding:8px;border:0">
        <svg id="settings-icon" aria-hidden="true" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2h12v12H2Z"/>
        </svg>
        <span id="sr-label" style="
          position:absolute;width:1px;height:1px;overflow:hidden;
          clip:rect(0 0 0 0);clip-path:inset(50%)
        ">Settings</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#settings')!.getBoundingClientRect =
      () => rect(32, 32)
    document.querySelector<HTMLElement>('#settings-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 8)
    document.querySelector<HTMLElement>('#sr-label')!.getBoundingClientRect =
      () => rect(1, 1)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      content: { kind: 'icon-only' },
      slots: {
        leading: { assetType: 'ui-icon', width: 16, height: 16 },
        trailing: null
      }
    })
    expect(tokens[0]).not.toHaveProperty('sampleText')
    expect(tokens[0]).not.toHaveProperty('supportingText')
  })

  it('keeps ordinary rendered text beside an icon as visible control copy', async () => {
    const dom = new JSDOM(`
      <button id="settings" style="width:96px;height:32px;padding:6px 8px;display:flex;gap:8px">
        <svg id="settings-icon" aria-hidden="true" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2h12v12H2Z"/>
        </svg>
        <span id="label">Settings</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#settings')!.getBoundingClientRect =
      () => rect(96, 32)
    document.querySelector<HTMLElement>('#settings-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 8)
    document.querySelector<HTMLElement>('#label')!.getBoundingClientRect =
      () => rect(56, 20, 32, 6)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      content: { kind: 'icon-leading' },
      sampleText: { value: 'Settings', source: 'visible-text' }
    })
  })

  it('keeps an aria-hidden graphic wrapper but rejects a CSS-hidden graphic wrapper', async () => {
    const dom = new JSDOM(`
      <button id="action" style="width:120px;height:32px;padding:6px 8px;display:flex;gap:8px">
        <span aria-hidden="true" role="presentation" style="clip-path:inset(0)">
          <span role="none">
            <svg id="visible-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v12H2Z"/>
            </svg>
          </span>
        </span>
        <span id="label">Settings</span>
        <span style="display:none">
          <svg id="ghost-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 3h10v10H3Z"/>
          </svg>
        </span>
        <span style="clip-path:inset(50%)">
          <svg id="clipped-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 4h8v8H4Z"/>
          </svg>
        </span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#action')!.getBoundingClientRect =
      () => rect(120, 32)
    document.querySelector<HTMLElement>('#visible-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 8)
    document.querySelector<HTMLElement>('#label')!.getBoundingClientRect =
      () => rect(56, 20, 32, 6)
    document.querySelector<HTMLElement>('#ghost-icon')!.getBoundingClientRect =
      () => rect(16, 16, 96, 8)
    document.querySelector<HTMLElement>('#clipped-icon')!.getBoundingClientRect =
      () => rect(16, 16, 96, 8)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      content: { kind: 'icon-leading' },
      slots: {
        leading: { assetType: 'ui-icon', width: 16, height: 16 },
        trailing: null
      }
    })
  })

  it('keeps a child that explicitly overrides an inherited hidden visibility', async () => {
    const dom = new JSDOM(`
      <button id="action" style="width:120px;height:32px;padding:6px 8px;display:flex;gap:8px">
        <span style="visibility:hidden">
          <svg id="visible-icon" style="visibility:visible" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2Z"/>
          </svg>
        </span>
        <span id="label">Settings</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#action')!.getBoundingClientRect =
      () => rect(120, 32)
    document.querySelector<HTMLElement>('#visible-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 8)
    document.querySelector<HTMLElement>('#label')!.getBoundingClientRect =
      () => rect(56, 20, 32, 6)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      content: { kind: 'icon-leading' },
      slots: { leading: { assetType: 'ui-icon' }, trailing: null }
    })
  })

  it.each([
    ['offscreen', 'position:absolute;left:-10000px', rect(56, 20, -10000, 0)],
    ['zero-sized glyphs', 'font-size:0', rect(56, 20, 0, 0)],
    ['transparent glyphs', 'color:transparent', rect(56, 20, 0, 0)]
  ])('treats %s text as non-visual beside a rendered icon', async (_case, style, labelRect) => {
    const dom = new JSDOM(`
      <button id="settings" style="width:32px;height:32px;padding:8px;border:0">
        <svg id="settings-icon" aria-hidden="true" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2h12v12H2Z"/>
        </svg>
        <span id="label" style="${style}">Settings</span>
      </button>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#settings')!.getBoundingClientRect =
      () => rect(32, 32)
    document.querySelector<HTMLElement>('#settings-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 8)
    document.querySelector<HTMLElement>('#label')!.getBoundingClientRect =
      () => labelRect

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ content: { kind: 'icon-only' } })
    expect(tokens[0]).not.toHaveProperty('sampleText')
  })

  it('does not collect a whole control hidden from the accessibility and control boundary', async () => {
    const dom = new JSDOM(`
      <div aria-hidden="true">
        <button id="hidden-control" style="width:96px;height:32px;background:white;border:1px solid black">
          <span>Settings</span>
        </button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const control = dom.window.document.querySelector<HTMLElement>('#hidden-control')!
    control.getBoundingClientRect = () => rect(96, 32)

    expect(await collectControls(dom.window.document)).toEqual([])
  })

  it('preserves the observed width of a standalone input instead of shrinking to its placeholder', async () => {
    const dom = new JSDOM(`
      <input id="field" placeholder="Find an item..." style="
        width:288px;height:32px;padding:5px 12px;
        border:1px solid rgb(180,180,180);border-radius:6px;background:white
      "/>
    `, { pretendToBeVisual: true })
    const field = dom.window.document.querySelector<HTMLElement>('#field')!
    field.getBoundingClientRect = () => rect(288, 32)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'input',
      geometry: { height: 32, minWidth: 288 },
      sampleText: { value: 'Find an item...', source: 'placeholder' }
    })
  })

  it('keeps a tightly owned sibling icon and asymmetric input border evidence', async () => {
    const dom = new JSDOM(`
      <div id="field-shell" style="position:relative;width:400px;height:48px">
        <svg id="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="11" cy="11" r="7"/><path d="M16 16l5 5"/>
        </svg>
        <input id="field" placeholder="Search for articles..." style="
          width:400px;height:48px;padding:8px 12px 8px 40px;
          border:0;border-bottom:1px solid rgb(20,20,20);
          border-radius:0;background:transparent
        "/>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#field-shell')!.getBoundingClientRect =
      () => rect(400, 48)
    document.querySelector<HTMLElement>('#field')!.getBoundingClientRect =
      () => rect(400, 48)
    document.querySelector<SVGElement>('#search-icon')!.getBoundingClientRect =
      () => rect(24, 24, 8, 12)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'input',
      content: { kind: 'icon-leading' },
      geometry: {
        minWidth: 400,
        borderWidth: 1,
        borderWidths: { top: 0, right: 0, bottom: 1, left: 0 }
      },
      slots: { leading: { assetType: 'ui-icon', width: 24, height: 24 } }
    })
  })

  it('keeps a structural textarea and its actions available for a full composer composite', async () => {
    const dom = new JSDOM(`
      <div id="composer" style="
        width:640px;height:240px;padding:16px;
        display:flex;flex-direction:column;gap:16px;
        border:1px solid rgb(208,215,222);border-radius:16px;background:white
      ">
        <textarea id="prompt" placeholder="Ask anything" style="
          width:608px;height:152px;padding:0;border:0;background:transparent;
          color:rgb(31,35,40);font:400 16px/24px Arial
        "></textarea>
        <div id="actions" role="group" style="display:flex;justify-content:space-between;height:40px">
          <div style="display:flex;gap:8px">
            <button id="mode" style="width:112px;height:40px;border:1px solid rgb(208,215,222)">
              <svg id="mode-icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg><span>Ask</span>
            </button>
            <button id="add" style="width:40px;height:40px;border:1px solid rgb(208,215,222)">
              <svg id="add-icon" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>
            </button>
          </div>
          <button id="send" style="width:40px;height:40px;border:0;border-radius:20px;background:black;color:white">
            <svg id="send-icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>
          </button>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      composer: rect(640, 240),
      prompt: rect(608, 152, 16, 16),
      actions: rect(608, 40, 16, 184),
      mode: rect(112, 40, 16, 184),
      'mode-icon': rect(20, 20, 28, 194),
      add: rect(40, 40, 136, 184),
      'add-icon': rect(20, 20, 146, 194),
      send: rect(40, 40, 584, 184),
      'send-icon': rect(20, 20, 594, 194)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(4)
    const textarea = tokens.find(token => token.family === 'textarea')
    expect(textarea).toMatchObject({
      family: 'textarea',
      geometry: {
        height: 152,
        minWidth: 608,
        padding: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      content: { kind: 'text-only' },
      sampleText: { value: 'Ask anything', source: 'placeholder' }
    })
    expect(tokens.find(token => token.sampleText?.value === 'Ask')).toBeDefined()
  })

  it('resolves a same-origin SVG sprite use into a standalone UI vector', async () => {
    const dom = new JSDOM(`
      <div id="menu" role="menu" style="width:420px;padding:8px">
        <div id="row" tabindex="0" style="
          cursor:pointer;width:404px;height:36px;padding:6px 8px;
          display:flex;align-items:center;gap:6px
        ">
          <svg id="paperclip" width="20" height="20">
            <use href="/assets/icons.svg#paperclip" fill="currentColor"></use>
          </svg>
          <span id="primary">Add photos &amp; files</span>
          <span id="supporting">Upload from computer</span>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    Object.defineProperty(dom.window, 'fetch', {
      configurable: true,
      value: async () => new Response(`
        <svg xmlns="http://www.w3.org/2000/svg">
          <symbol id="paperclip" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 5a3 3 0 0 1 6 0v7a5 5 0 0 1-10 0V6h2v6a3 3 0 0 0 6 0V5a1 1 0 0 0-2 0v7a1 1 0 0 1-2 0V6h2v6"/>
          </symbol>
        </svg>
      `, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
    })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('#menu')!
    const row = document.querySelector<HTMLElement>('#row')!
    const icon = document.querySelector<HTMLElement>('#paperclip')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    menu.getBoundingClientRect = () => rect(420, 52)
    row.getBoundingClientRect = () => rect(404, 36, 8, 8)
    icon.getBoundingClientRect = () => rect(20, 20, 16, 16)
    primary.getBoundingClientRect = () => rect(132, 20, 42, 16)
    supporting.getBoundingClientRect = () => rect(150, 20, 186, 16)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.slots.leading).toMatchObject({
      width: 20,
      height: 20,
      assetType: 'ui-icon'
    })
    expect(tokens[0]?.slots.leading?.vectorSvg).toContain('<path')
    expect(tokens[0]?.slots.leading?.vectorSvg).not.toContain('<use')
    expect(tokens[0]?.slots.leading?.vectorSvg).not.toContain('href=')
  })

  it('keeps a filled action SVG as a real UI icon instead of treating its paint as identity evidence', async () => {
    const dom = new JSDOM(`
      <button id="row" style="width:120px;height:36px;padding:8px">
        <svg id="asset" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 3h14v14H3z"/>
        </svg>
        <span id="primary">Create item</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const asset = document.querySelector<HTMLElement>('#asset')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    row.getBoundingClientRect = () => rect(120, 36)
    asset.getBoundingClientRect = () => rect(20, 20, 8, 8)
    primary.getBoundingClientRect = () => rect(72, 18, 36, 9)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.slots.leading).toMatchObject({
      width: 20,
      height: 20,
      assetType: 'ui-icon'
    })
    expect(tokens[0]?.slots.leading?.vectorSvg).toContain('M3 3h14v14H3z')
  })

  it('keeps a selected compound option identity as an unknown slot while retaining the trailing UI marker', async () => {
    const dom = new JSDOM(`
      <button id="row" aria-selected="true" style="width:360px;height:52px;padding:6px 8px">
        <svg id="identity" role="img" viewBox="0 0 24 24" fill="none">
          <path d="M2 2h20v20H2z" stroke="currentColor"/>
        </svg>
        <span id="primary">Standard plan</span>
        <span id="supporting">General purpose</span>
        <svg id="check" viewBox="0 0 24 24" fill="none">
          <path d="M5 12l4 4L19 6" stroke="currentColor"/>
        </svg>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const identity = document.querySelector<HTMLElement>('#identity')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    const check = document.querySelector<HTMLElement>('#check')!
    row.getBoundingClientRect = () => rect(360, 52)
    identity.getBoundingClientRect = () => rect(20, 20, 8, 16)
    primary.getBoundingClientRect = () => rect(120, 18, 42, 7)
    supporting.getBoundingClientRect = () => rect(150, 18, 42, 29)
    check.getBoundingClientRect = () => rect(16, 16, 336, 18)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      state: 'selected',
      content: {
        kind: 'compound-row',
        textFlow: 'stacked',
        trailing: 'action'
      },
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'unknown'
        },
        trailing: {
          width: 16,
          height: 16,
          assetType: 'ui-icon'
        }
      }
    })
    expect(tokens[0]?.slots.leading).not.toHaveProperty('vectorSvg')
    expect(tokens[0]?.slots.trailing?.vectorSvg).toContain('M5 12l4 4L19 6')
    expect(JSON.stringify(tokens)).not.toContain('M2 2h20v20H2z')
  })

  it('keeps a compound-row identity as an unknown slot even when the site exposes selection only visually', async () => {
    const dom = new JSDOM(`
      <div role="menu">
        <div id="row" style="
          cursor:pointer;width:360px;height:52px;padding:6px 8px
        ">
          <svg id="identity" role="img" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 2h20v20H2z"/>
          </svg>
          <span id="primary">Standard plan</span>
          <span id="supporting">General purpose</span>
          <svg id="check" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l4 4L19 6" stroke="currentColor"/>
          </svg>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const identity = document.querySelector<HTMLElement>('#identity')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    const check = document.querySelector<HTMLElement>('#check')!
    row.getBoundingClientRect = () => rect(360, 52)
    identity.getBoundingClientRect = () => rect(20, 20, 8, 16)
    primary.getBoundingClientRect = () => rect(120, 18, 42, 7)
    supporting.getBoundingClientRect = () => rect(150, 18, 42, 29)
    check.getBoundingClientRect = () => rect(16, 16, 336, 18)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.slots.leading).toMatchObject({
      width: 20,
      height: 20,
      assetType: 'unknown'
    })
    expect(tokens[0]?.slots.leading).not.toHaveProperty('vectorSvg')
    expect(tokens[0]?.slots.trailing).toMatchObject({
      width: 16,
      height: 16,
      assetType: 'ui-icon'
    })
    expect(tokens[0]?.slots.trailing?.vectorSvg).toContain('M5 12l4 4L19 6')
    expect(JSON.stringify(tokens)).not.toContain('M2 2h20v20H2z')
  })

  it('keeps a nested menuitemradio identity as an unknown slot and the trailing marker as a UI icon', async () => {
    const dom = new JSDOM(`
      <div role="menu">
        <div id="row" role="menuitemradio" data-radix-collection-item style="
          cursor:pointer;width:298px;height:51px;padding:6px 10px
        ">
          <div id="content">
            <div id="leading-wrap">
              <svg id="identity" role="img" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 2h20v20H2z"/>
              </svg>
            </div>
            <div id="text-stack">
              <span id="primary">Standard plan</span>
              <div id="supporting">General purpose</div>
            </div>
          </div>
          <div id="trailing-wrap">
            <svg id="check" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l4 4L19 6" stroke="currentColor"/>
            </svg>
          </div>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const dimensions = [
      ['#row', 298, 51, 285, 101],
      ['#content', 164, 39, 295, 107],
      ['#leading-wrap', 20, 20, 295, 117],
      ['#identity', 20, 20, 295, 117],
      ['#text-stack', 138, 39, 321, 107],
      ['#primary', 138, 20, 321, 107],
      ['#supporting', 138, 17, 321, 127],
      ['#trailing-wrap', 16, 16, 557, 119],
      ['#check', 16, 16, 557, 119]
    ] as const
    for (const [selector, width, height, x, y] of dimensions) {
      document.querySelector<HTMLElement>(selector)!.getBoundingClientRect =
        () => rect(width, height, x, y)
    }

    const tokens = await collectControls(document)
    const token = tokens.find(candidate =>
      candidate.content.kind === 'compound-row'
    )

    expect(token).toMatchObject({
      content: {
        kind: 'compound-row',
        textFlow: 'stacked',
        trailing: 'action'
      },
      slots: {
        leading: {
          width: 20,
          height: 20,
          assetType: 'unknown'
        },
        trailing: {
          width: 16,
          height: 16,
          assetType: 'ui-icon'
        }
      }
    })
    expect(token?.slots.leading).not.toHaveProperty('vectorSvg')
    expect(token?.slots.trailing?.vectorSvg).toContain('M5 12l4 4L19 6')
    expect(token).not.toHaveProperty('sampleText')
    expect(token).not.toHaveProperty('supportingText')
    expect(JSON.stringify(tokens)).not.toContain('M2 2h20v20H2z')
    expect(JSON.stringify(tokens)).not.toContain('Standard plan')
    expect(JSON.stringify(tokens)).not.toContain('General purpose')
  })

  it('keeps an explicitly marked brand graphic as a brand slot even inside a selected compound option', async () => {
    const dom = new JSDOM(`
      <button id="row" aria-selected="true" style="width:360px;height:52px;padding:6px 8px">
        <svg id="asset" class="MuiAvatar-root" role="img" viewBox="0 0 24 24" fill="none">
          <path d="M2 2h20v20H2z" stroke="currentColor"/>
        </svg>
        <span id="primary">Standard plan</span>
        <span id="supporting">General purpose</span>
        <svg id="check" viewBox="0 0 24 24" fill="none">
          <path d="M5 12l4 4L19 6" stroke="currentColor"/>
        </svg>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const brand = document.querySelector<HTMLElement>('#asset')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    const check = document.querySelector<HTMLElement>('#check')!
    row.getBoundingClientRect = () => rect(360, 52)
    brand.getBoundingClientRect = () => rect(20, 20, 8, 16)
    primary.getBoundingClientRect = () => rect(120, 18, 42, 7)
    supporting.getBoundingClientRect = () => rect(150, 18, 42, 29)
    check.getBoundingClientRect = () => rect(16, 16, 336, 18)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.slots.leading).toMatchObject({
      width: 20,
      height: 20,
      assetType: 'brand-logo'
    })
    expect(tokens[0]?.slots.leading).not.toHaveProperty('vectorSvg')
  })

  it('keeps the structure of an identity row with a trailing action without serializing its copy', async () => {
    const dom = new JSDOM(`
      <button id="row" style="width:350px;height:52px;padding:6px 10px">
        <svg id="identity" class="MuiAvatar-root" role="img" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/>
        </svg>
        <span id="primary">Example member</span>
        <span id="supporting">Basic plan</span>
        <svg id="action" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="currentColor"/>
        </svg>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const identity = document.querySelector<HTMLElement>('#identity')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    const action = document.querySelector<HTMLElement>('#action')!
    row.getBoundingClientRect = () => rect(350, 52)
    identity.getBoundingClientRect = () => rect(24, 24, 10, 14)
    primary.getBoundingClientRect = () => rect(120, 18, 42, 7)
    supporting.getBoundingClientRect = () => rect(100, 18, 42, 29)
    action.getBoundingClientRect = () => rect(16, 16, 324, 18)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      content: {
        kind: 'compound-row',
        trailing: 'action'
      },
      slots: {
        leading: { assetType: 'brand-logo' },
        trailing: { assetType: 'ui-icon' }
      }
    })
    expect(tokens[0]).not.toHaveProperty('sampleText')
    expect(tokens[0]).not.toHaveProperty('supportingText')
    expect(JSON.stringify(tokens)).not.toMatch(/Example member|Basic plan/)
  })

  it('does not serialize a default entity row with private copy and no product action', async () => {
    const dom = new JSDOM(`
      <button id="row" style="width:350px;height:52px;padding:6px 8px">
        <img id="identity" alt="">
        <span id="primary">Example member</span>
        <span id="supporting">Basic plan</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const identity = document.querySelector<HTMLElement>('#identity')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    row.getBoundingClientRect = () => rect(350, 52)
    identity.getBoundingClientRect = () => rect(24, 24, 8, 14)
    primary.getBoundingClientRect = () => rect(120, 18, 42, 7)
    supporting.getBoundingClientRect = () => rect(100, 18, 42, 29)

    const tokens = await collectControls(document)

    expect(tokens).toEqual([])
    expect(JSON.stringify(tokens)).not.toContain('Example member')
    expect(JSON.stringify(tokens)).not.toContain('Basic plan')
  })

  it('recognizes a pointer-backed menu row even when the site omitted a button role', async () => {
    const dom = new JSDOM(`
      <div role="menu" id="menu">
        <div id="row" tabindex="0" style="
          cursor:pointer;width:360px;height:52px;padding:6px 8px;
          display:flex;align-items:center;gap:10px
        ">
          <svg id="paperclip" viewBox="0 0 24 24" fill="none">
            <path d="M8 12 16 4" stroke="currentColor"/>
          </svg>
          <span id="primary">Add photos &amp; files</span>
          <span id="supporting">Upload from computer</span>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('#menu')!
    const row = document.querySelector<HTMLElement>('#row')!
    const icon = document.querySelector<HTMLElement>('#paperclip')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    menu.getBoundingClientRect = () => rect(376, 68)
    row.getBoundingClientRect = () => rect(360, 52, 8, 8)
    icon.getBoundingClientRect = () => rect(24, 24, 16, 22)
    primary.getBoundingClientRect = () => rect(132, 20, 50, 24)
    supporting.getBoundingClientRect = () => rect(150, 20, 190, 24)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'button',
      content: {
        kind: 'compound-row',
        textFlow: 'inline'
      },
      sampleText: { value: 'Add photos & files' },
      supportingText: { value: 'Upload from computer' },
      slots: {
        leading: { assetType: 'ui-icon' }
      }
    })
  })

  it('does not turn an expanded listbox or its current option copy into controls with text', async () => {
    const dom = new JSDOM(`
      <div id="listbox" role="listbox" style="
        width:420px;height:544px;padding:12px;
        border:1px solid rgb(220,220,220)
      ">
        <div id="first" role="option">Personal project alpha</div>
        <div id="second" role="option">Private topic beta</div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const listbox = document.querySelector<HTMLElement>('#listbox')!
    const first = document.querySelector<HTMLElement>('#first')!
    const second = document.querySelector<HTMLElement>('#second')!
    listbox.getBoundingClientRect = () => rect(420, 544)
    first.getBoundingClientRect = () => rect(240, 32, 12, 220)
    second.getBoundingClientRect = () => rect(240, 32, 12, 260)

    const tokens = await collectControls(document)
    const serialized = JSON.stringify(tokens)

    expect(tokens.some(token =>
      token.family === 'select' && token.geometry.height === 544
    )).toBe(false)
    expect(tokens.every(token =>
      token.sampleText === undefined &&
      token.supportingText === undefined &&
      token.content.kind !== 'compound-row'
    )).toBe(true)
    expect(serialized).not.toContain('Personal project alpha')
    expect(serialized).not.toContain('Private topic beta')
  })

  it('keeps a combobox shell without serializing its current selection or supporting copy', async () => {
    const dom = new JSDOM(`
      <div id="combobox" role="combobox" style="
        width:320px;height:40px;padding:8px 12px;
        border:1px solid rgb(180,180,180);border-radius:8px
      ">
        <span id="current">Private workspace</span>
        <span id="detail">Personal account</span>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const combobox = document.querySelector<HTMLElement>('#combobox')!
    const current = document.querySelector<HTMLElement>('#current')!
    const detail = document.querySelector<HTMLElement>('#detail')!
    combobox.getBoundingClientRect = () => rect(320, 40)
    current.getBoundingClientRect = () => rect(130, 20, 12, 10)
    detail.getBoundingClientRect = () => rect(120, 20, 154, 10)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'select',
      content: { kind: 'text-only' }
    })
    expect(tokens[0]).not.toHaveProperty('sampleText')
    expect(tokens[0]).not.toHaveProperty('supportingText')
    expect(JSON.stringify(tokens)).not.toMatch(/Private workspace|Personal account/)
  })

  it('applies a compact geometry gate to ordinary controls while preserving tall textareas', async () => {
    const dom = new JSDOM(`
      <button id="tiny" style="width:120px;height:12px">Tiny</button>
      <button id="giant" style="width:420px;height:240px;padding:20px">Giant card</button>
      <input id="giant-input" placeholder="Private query" style="
        width:420px;height:120px;padding:12px;border:1px solid black
      " />
      <textarea id="textarea" placeholder="Write a message" style="
        width:420px;height:160px;padding:12px;border:1px solid black
      "></textarea>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const tiny = document.querySelector<HTMLElement>('#tiny')!
    const giant = document.querySelector<HTMLElement>('#giant')!
    const giantInput = document.querySelector<HTMLElement>('#giant-input')!
    const textarea = document.querySelector<HTMLElement>('#textarea')!
    tiny.getBoundingClientRect = () => rect(120, 12)
    giant.getBoundingClientRect = () => rect(420, 240)
    giantInput.getBoundingClientRect = () => rect(420, 120)
    textarea.getBoundingClientRect = () => rect(420, 160)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'textarea',
      geometry: { height: 160 },
      sampleText: { value: 'Write a message', source: 'placeholder' }
    })
  })

  it('does not infer compound copy from three or more text regions', async () => {
    const dom = new JSDOM(`
      <button id="row" style="
        width:360px;height:52px;padding:6px 8px;
        display:flex;align-items:center;gap:8px
      ">
        <svg id="icon" viewBox="0 0 20 20" fill="none">
          <path d="M2 10h16" stroke="currentColor"/>
        </svg>
        <span id="first">First</span>
        <span id="second">Second</span>
        <span id="third">Third</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const icon = document.querySelector<HTMLElement>('#icon')!
    const first = document.querySelector<HTMLElement>('#first')!
    const second = document.querySelector<HTMLElement>('#second')!
    const third = document.querySelector<HTMLElement>('#third')!
    row.getBoundingClientRect = () => rect(360, 52)
    icon.getBoundingClientRect = () => rect(20, 20, 8, 16)
    first.getBoundingClientRect = () => rect(40, 20, 36, 16)
    second.getBoundingClientRect = () => rect(52, 20, 84, 16)
    third.getBoundingClientRect = () => rect(40, 20, 144, 16)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.content.kind).toBe('icon-leading')
    expect(tokens[0]).not.toHaveProperty('sampleText')
    expect(tokens[0]).not.toHaveProperty('supportingText')
  })

  it('does not promote a generic pointer-backed content row outside a menu', async () => {
    const dom = new JSDOM(`
      <div id="row" tabindex="0" style="
        cursor:pointer;width:360px;height:52px;padding:6px 8px;
        display:flex;align-items:center;gap:10px
      ">
        <svg id="icon" viewBox="0 0 20 20" fill="none">
          <path d="M2 10h16" stroke="currentColor"/>
        </svg>
        <span id="primary">Personal project</span>
        <span id="supporting">Private topic</span>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const row = document.querySelector<HTMLElement>('#row')!
    const icon = document.querySelector<HTMLElement>('#icon')!
    const primary = document.querySelector<HTMLElement>('#primary')!
    const supporting = document.querySelector<HTMLElement>('#supporting')!
    row.getBoundingClientRect = () => rect(360, 52)
    icon.getBoundingClientRect = () => rect(20, 20, 8, 16)
    primary.getBoundingClientRect = () => rect(120, 20, 38, 16)
    supporting.getBoundingClientRect = () => rect(100, 20, 166, 16)

    expect(await collectControls(document)).toEqual([])
  })

  it('excludes file names and opaque user-content navigation from component samples', async () => {
    const dom = new JSDOM(`
      <button id="file" style="width:220px;height:18px">
        <span id="file-a">截屏2026-04</span><span id="file-b">-23 14.36.13</span>
      </button>
      <a href="/conversation/6a638223-e99c-83ea-8142-a2ed5fb302c3">
        <button id="title" style="width:180px;height:36px">AI穿搭</button>
      </a>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const file = document.querySelector<HTMLElement>('#file')!
    const fileA = document.querySelector<HTMLElement>('#file-a')!
    const fileB = document.querySelector<HTMLElement>('#file-b')!
    const title = document.querySelector<HTMLElement>('#title')!
    file.getBoundingClientRect = () => rect(220, 18)
    fileA.getBoundingClientRect = () => rect(90, 18, 0, 0)
    fileB.getBoundingClientRect = () => rect(90, 18, 90, 0)
    title.getBoundingClientRect = () => rect(180, 36)

    const tokens = await collectControls(document)

    expect(tokens).toEqual([])
  })

  it('excludes an unlabeled user entity row without relying on site names or routes', async () => {
    const dom = new JSDOM(`
      <div id="entity-row">
        <div>
          <button id="entity" style="width:180px;height:36px">AI穿搭</button>
          <button id="home" aria-label="Open project home" style="width:36px;height:36px">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M2 10h16" stroke="currentColor"/>
            </svg>
          </button>
        </div>
        <button id="options" aria-label="Open project options for AI穿搭" style="width:36px;height:36px">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M4 10h12" stroke="currentColor"/>
          </svg>
        </button>
      </div>
      <div id="suggestion-row">
        <button id="command" style="width:180px;height:36px">Create image</button>
        <button id="dismiss" aria-label="Dismiss Create image" style="width:36px;height:36px">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M4 4l12 12" stroke="currentColor"/>
          </svg>
        </button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    for (const [selector, width, height] of [
      ['#entity', 180, 36],
      ['#home', 36, 36],
      ['#options', 36, 36],
      ['#command', 180, 36],
      ['#dismiss', 36, 36]
    ] as const) {
      document.querySelector<HTMLElement>(selector)!.getBoundingClientRect =
        () => rect(width, height)
    }
    document.querySelector<HTMLElement>('#entity-row')!.getBoundingClientRect =
      () => rect(252, 36)
    document.body.getBoundingClientRect = () => rect(600, 300)

    const tokens = await collectControls(document)
    const serialized = JSON.stringify(tokens)

    expect(serialized).not.toContain('AI穿搭')
    expect(tokens.some(token => token.sampleText?.value === 'Create image')).toBe(true)
  })

  it('excludes English date-based file names and file-size metadata', async () => {
    const dom = new JSDOM(`
      <button id="dated" style="width:260px;height:36px">
        <span id="dated-primary">ChatGPT Image May 11, 2026, 11_28_06 AM(1)</span>
      </button>
      <button id="sized" style="width:180px;height:36px">
        <span id="sized-primary">Apr 29</span><span id="sized-supporting">448 KB</span>
      </button>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const dated = document.querySelector<HTMLElement>('#dated')!
    const datedPrimary = document.querySelector<HTMLElement>('#dated-primary')!
    const sized = document.querySelector<HTMLElement>('#sized')!
    const sizedPrimary = document.querySelector<HTMLElement>('#sized-primary')!
    const sizedSupporting = document.querySelector<HTMLElement>('#sized-supporting')!
    dated.getBoundingClientRect = () => rect(260, 36)
    datedPrimary.getBoundingClientRect = () => rect(250, 18)
    sized.getBoundingClientRect = () => rect(180, 36)
    sizedPrimary.getBoundingClientRect = () => rect(55, 18, 0, 0)
    sizedSupporting.getBoundingClientRect = () => rect(55, 18, 70, 0)

    expect(await collectControls(document)).toEqual([])
  })

  it('keeps truly different geometry and appearance as separate tokens', async () => {
    const dom = new JSDOM(`
      <button data-control style="height:40px;padding:8px 12px;background:rgb(0,0,0);color:rgb(255,255,255);font:400 14px/20px Arial">A</button>
      <button data-control style="height:48px;padding:8px 12px;background:rgb(0,0,0);color:rgb(255,255,255);font:400 14px/20px Arial">B</button>
      <button data-control style="height:40px;padding:8px 12px;background:rgb(255,255,255);color:rgb(0,0,0);font:400 14px/20px Arial">C</button>
    `, { pretendToBeVisual: true })
    dom.window.document.querySelectorAll<HTMLElement>('[data-control]').forEach((element, index) => {
      element.getBoundingClientRect = () => rect(120, index === 1 ? 48 : 40)
    })
    const tokens = await collectControls(dom.window.document)
    expect(tokens).toHaveLength(3)
    expect(new Set(tokens.map(token => token.id)).size).toBe(3)
  })

  it('uses a nearby visual shell instead of exporting a bare internal input', async () => {
    const dom = new JSDOM(`
      <div id="shell" style="
        height:36px;
        padding:6px 12px;
        border:1px solid rgb(180,180,180);
        border-radius:18px;
        background:rgb(255,255,255)
      ">
        <div><div><div><div>
          <input id="internal" placeholder="Search..." style="
            height:24px;
            padding:0;
            border:0;
            border-radius:0;
            background:transparent;
            color:rgb(20,20,20);
            font:400 16px/24px Arial
          " />
        </div></div></div></div>
      </div>
    `, { pretendToBeVisual: true })
    const shell = dom.window.document.querySelector<HTMLElement>('#shell')!
    const input = dom.window.document.querySelector<HTMLElement>('#internal')!
    shell.getBoundingClientRect = () => rect(240, 36)
    input.getBoundingClientRect = () => rect(214, 24, 13, 6)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      family: 'input',
      geometry: {
        height: 36,
        padding: { top: 6, right: 12, bottom: 6, left: 12 },
        radius: 18,
        borderWidth: 1
      },
      typography: {
        fontSizePx: 16,
        lineHeightPx: 24
      },
      sampleText: {
        value: 'Search...',
        source: 'placeholder'
      }
    })
  })

  it('prefers a painted parent surface over a padding-only button implementation node', async () => {
    const dom = new JSDOM(`
      <div id="surface" style="
        width:220px;
        height:52px;
        padding:8px 12px;
        border-radius:12px;
        background:rgb(242,242,242)
      ">
        <button id="control" style="
          height:36px;
          padding:6px 10px;
          border:0;
          border-radius:8px;
          background:transparent;
          color:rgb(20,20,20);
          font:400 14px/20px Arial
        ">Upgrade</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const surface = dom.window.document.querySelector<HTMLElement>('#surface')!
    const control = dom.window.document.querySelector<HTMLElement>('#control')!
    surface.getBoundingClientRect = () => rect(220, 52)
    control.getBoundingClientRect = () => rect(196, 36, 12, 8)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      geometry: {
        height: 52,
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
        radius: 12
      },
      appearance: {
        background: { r: 0.949, g: 0.949, b: 0.949, a: 1 }
      }
    })
  })

  it('keeps one tightly owned layout shell when a descendant gains hover paint', async () => {
    const dom = new JSDOM(`
      <div id="surface" style="
        width:160px;
        height:32px;
        padding:6px 8px;
        border-radius:6px;
        background:rgb(255,255,255)
      ">
        <button id="control" style="
          width:144px;
          height:20px;
          padding:0;
          border:0;
          border-radius:6px;
          background:transparent;
          color:rgb(31,35,40);
          font:400 14px/20px Arial
        ">Anonymous action</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const surface = dom.window.document.querySelector<HTMLElement>('#surface')!
    const control = dom.window.document.querySelector<HTMLElement>('#control')!
    surface.getBoundingClientRect = () => rect(160, 32)
    control.getBoundingClientRect = () => rect(144, 20, 8, 6)

    const [defaultToken] = await collectControls(dom.window.document)
    control.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
    control.style.backgroundColor = 'rgba(129, 139, 152, 0.1)'
    const [hoverToken] = await collectControls(dom.window.document)

    expect(defaultToken?.geometry).toMatchObject({
      height: 32,
      padding: { top: 6, right: 8, bottom: 6, left: 8 }
    })
    expect(hoverToken?.geometry).toMatchObject({
      height: 32,
      padding: { top: 6, right: 8, bottom: 6, left: 8 }
    })
    expect(hoverToken?.appearance.background.a).toBeGreaterThan(0)
  })

  it('does not promote an unrelated wrapper without matching positive insets', async () => {
    const dom = new JSDOM(`
      <div id="wrapper" style="width:200px;height:40px;background:rgb(245,245,245)">
        <button id="control" style="
          width:120px;height:32px;padding:6px 8px;border:0;
          background:rgb(238,238,238);color:rgb(31,35,40)
        ">Anonymous action</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const wrapper = dom.window.document.querySelector<HTMLElement>('#wrapper')!
    const control = dom.window.document.querySelector<HTMLElement>('#control')!
    wrapper.getBoundingClientRect = () => rect(200, 40)
    control.getBoundingClientRect = () => rect(120, 32, 32, 4)

    const [token] = await collectControls(dom.window.document)

    expect(token?.geometry).toMatchObject({
      height: 32,
      padding: { top: 6, right: 8, bottom: 6, left: 8 }
    })
  })

  it('does not export an unframed internal field as a complete control', async () => {
    const dom = new JSDOM(`
      <div role="dialog">
        <input id="internal" placeholder="Search..." style="
          height:24px;
          padding:0;
          border:0;
          border-radius:0;
          outline:0;
          background:transparent;
          color:rgb(20,20,20);
          font:400 16px/24px Arial
        " />
        <button style="width:24px;height:24px">Close</button>
      </div>
    `, { pretendToBeVisual: true })
    const input = dom.window.document.querySelector<HTMLElement>('#internal')!
    const button = dom.window.document.querySelector<HTMLElement>('button')!
    input.getBoundingClientRect = () => rect(420, 24)
    button.getBoundingClientRect = () => rect(24, 24)

    const tokens = await collectControls(dom.window.document)

    expect(tokens.some(token =>
      token.family === 'input' && token.sampleText?.value === 'Search...'
    )).toBe(false)
  })

  it('ignores invisible border and outline colors but preserves visible outline geometry', async () => {
    const dom = new JSDOM(`
      <button id="hidden" style="height:40px;border:0 solid rgb(0,0,255);outline:none;outline-color:rgb(255,0,0);outline-width:4px">Hidden</button>
      <button id="visible" style="height:40px;border:2px solid rgb(0,128,0);outline-style:solid;outline-width:3px;outline-color:rgb(10,100,220);outline-offset:2px">Visible</button>
    `, { pretendToBeVisual: true })
    dom.window.document.querySelectorAll<HTMLElement>('button').forEach(element => {
      element.getBoundingClientRect = () => rect(120, 40)
    })

    const tokens = await collectControls(dom.window.document)
    const hidden = tokens.find(token => token.geometry.borderWidth === 0)!
    const visible = tokens.find(token => token.geometry.borderWidth === 2)!

    expect(hidden.appearance.border.a).toBe(0)
    expect(hidden.appearance.outline.a).toBe(0)
    expect(hidden.appearance.outlineWidth).toBe(0)
    expect(hidden.appearance.outlineOffset).toBe(0)
    expect(visible.appearance.border).toMatchObject({ g: 0.502, a: 1 })
    expect(visible.appearance.outline).toMatchObject({ r: 0.0392, g: 0.3922, b: 0.8627, a: 1 })
    expect(visible.appearance.outlineWidth).toBe(3)
    expect(visible.appearance.outlineOffset).toBe(2)
  })

  it('keeps a non-vector role-img function glyph as an unknown slot instead of a brand logo', async () => {
    const dom = new JSDOM(`
      <button id="row" style="width:180px;height:36px">
        <span id="glyph" role="img">settings</span>
        <span id="label">Theme</span>
      </button>
    `, { pretendToBeVisual: true })
    const row = dom.window.document.querySelector<HTMLElement>('#row')!
    const glyph = dom.window.document.querySelector<HTMLElement>('#glyph')!
    const label = dom.window.document.querySelector<HTMLElement>('#label')!
    row.getBoundingClientRect = () => rect(180, 36)
    glyph.getBoundingClientRect = () => rect(20, 20, 8, 8)
    label.getBoundingClientRect = () => rect(70, 20, 36, 8)

    const tokens = await collectControls(dom.window.document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.slots.leading).toMatchObject({
      assetType: 'unknown',
      width: 20,
      height: 20
    })
    expect(tokens[0]?.slots.leading?.vectorSvg).toBeUndefined()
  })

  it('collects anonymous links only inside the active transient structure', async () => {
    const dom = new JSDOM(`
      <a id="outside" href="/outside" style="display:flex;width:180px;height:40px;padding:8px;background:rgb(245,245,245)">Outside</a>
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:196px;padding:0 8px">
        <div id="row-wrap" style="width:180px">
          <a id="inside" aria-label="Open target" href="/private/repository"
            style="display:flex;width:180px;height:40px;padding:8px;background:rgb(245,245,245)">Destination</a>
        </div>
        <a id="download" href="/archive.zip" download
          style="display:flex;width:180px;height:40px">Download</a>
        <a id="file" href="file:///tmp/example.txt"
          style="display:flex;width:180px;height:40px">File</a>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const transient = document.querySelector<HTMLElement>('#transient')!
    const rowWrap = document.querySelector<HTMLElement>('#row-wrap')!
    transient.getBoundingClientRect = () => rect(196, 120)
    rowWrap.getBoundingClientRect = () => rect(180, 40)
    for (const element of document.querySelectorAll<HTMLElement>('a')) {
      element.getBoundingClientRect = () => rect(180, 40)
    }

    const result = await collectControlsWithObservations(document)

    expect(result.observations).toHaveLength(1)
    expect(result.observations[0]?.ownership.interaction.id).toBe('inside')
    expect(result.controls[0]).toMatchObject({
      geometry: { minWidth: null },
      layout: { widthBehavior: 'hug' }
    })
    expect(result.controls[0]).not.toHaveProperty('sampleText')
    expect(result.controls[0]).not.toHaveProperty('supportingText')
    const serialized = JSON.stringify(result.controls[0])
    expect(serialized).not.toContain('/private/repository')
    expect(serialized).not.toContain('Open target')
  })

  it('keeps a safe nested UI glyph when a transient link is wrapped by an external menu item', async () => {
    const dom = new JSDOM(`
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <li id="option" role="menuitem" style="width:304px;height:32px">
          <a id="inside" href="/private/repository" style="
            display:flex;width:304px;height:32px;align-items:center;gap:8px
          ">
            <span id="visual">
              <svg id="repo-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 2h12v12H2Z"/>
              </svg>
            </span>
            <span id="private-label">private-repository-name</span>
          </a>
        </li>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#transient')!.getBoundingClientRect =
      () => rect(320, 48)
    document.querySelector<HTMLElement>('#option')!.getBoundingClientRect =
      () => rect(304, 32, 8, 8)
    document.querySelector<HTMLElement>('#inside')!.getBoundingClientRect =
      () => rect(304, 32, 8, 8)
    document.querySelector<HTMLElement>('#visual')!.getBoundingClientRect =
      () => rect(16, 16, 8, 16)
    document.querySelector<HTMLElement>('#repo-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 16)
    document.querySelector<HTMLElement>('#private-label')!.getBoundingClientRect =
      () => rect(180, 20, 32, 14)

    const result = await collectControlsWithObservations(document)

    const inside = result.observations.find(observation =>
      observation.ownership.interaction.id === 'inside'
    )
    expect(inside?.token.slots.leading).toMatchObject({
      assetType: 'ui-icon',
      width: 16,
      height: 16,
      vectorSvg: expect.stringContaining('<path')
    })
    expect(inside?.token).not.toHaveProperty('sampleText')
    expect(inside?.token).not.toHaveProperty('supportingText')
    expect(JSON.stringify(inside?.token)).not.toContain('private-repository-name')
    expect(JSON.stringify(inside?.token)).not.toContain('/private/repository')
  })

  it('keeps a tightly owned sibling UI glyph for an anonymous transient link row', async () => {
    const dom = new JSDOM(`
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <div id="row" style="
          display:flex;width:304px;height:32px;padding:0 8px;
          align-items:center;gap:8px
        ">
          <span id="visual">
            <svg id="repo-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v12H2Z"/>
            </svg>
          </span>
          <a id="inside" href="/private/repository" style="
            display:flex;width:264px;height:32px;align-items:center
          ">
            <span id="private-label">private-repository-name</span>
          </a>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#transient')!.getBoundingClientRect =
      () => rect(320, 48)
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect =
      () => rect(304, 32, 8, 8)
    document.querySelector<HTMLElement>('#inside')!.getBoundingClientRect =
      () => rect(264, 32, 40, 8)
    document.querySelector<HTMLElement>('#visual')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    document.querySelector<HTMLElement>('#repo-icon')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    document.querySelector<HTMLElement>('#private-label')!.getBoundingClientRect =
      () => rect(180, 20, 40, 14)

    const result = await collectControlsWithObservations(document)

    const inside = result.observations.find(observation =>
      observation.ownership.interaction.id === 'inside'
    )
    expect(inside?.ownership.layout.id).toBe('row')
    expect(inside?.token).toMatchObject({
      geometry: { minWidth: 304 },
      slots: {
        leading: {
          assetType: 'ui-icon',
          width: 16,
          height: 16,
          vectorSvg: expect.stringContaining('<path')
        }
      },
      content: { kind: 'icon-leading' },
      layout: { widthBehavior: 'fill', contentAlignment: 'start' }
    })
    expect(inside?.token).not.toHaveProperty('sampleText')
    expect(inside?.token).not.toHaveProperty('supportingText')
    expect(JSON.stringify(result.controls)).not.toContain('private-repository-name')
    expect(JSON.stringify(result.controls)).not.toContain('/private/repository')
  })

  it('keeps a tightly packed sibling UI glyph when the transient row declares zero padding', async () => {
    const dom = new JSDOM(`
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <div id="row" style="
          display:flex;width:304px;height:32px;padding:0;
          align-items:center;gap:8px
        ">
          <span id="visual">
            <svg id="repo-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v12H2Z"/>
            </svg>
          </span>
          <a id="inside" href="/private/repository" style="
            display:flex;width:280px;height:32px;align-items:center
          ">
            <span id="private-label">private-repository-name</span>
          </a>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#transient')!.getBoundingClientRect =
      () => rect(320, 48)
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect =
      () => rect(304, 32, 8, 8)
    document.querySelector<HTMLElement>('#inside')!.getBoundingClientRect =
      () => rect(280, 32, 32, 8)
    document.querySelector<HTMLElement>('#visual')!.getBoundingClientRect =
      () => rect(16, 16, 8, 16)
    document.querySelector<HTMLElement>('#repo-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 16)
    document.querySelector<HTMLElement>('#private-label')!.getBoundingClientRect =
      () => rect(180, 20, 32, 14)

    const result = await collectControlsWithObservations(document)

    const inside = result.observations.find(observation =>
      observation.ownership.interaction.id === 'inside'
    )
    expect(inside?.ownership.layout.id).toBe('row')
    expect(inside?.token).toMatchObject({
      geometry: { minWidth: 304 },
      slots: {
        leading: {
          assetType: 'ui-icon',
          width: 16,
          height: 16,
          vectorSvg: expect.stringContaining('<path')
        }
      },
      content: { kind: 'icon-leading' },
      layout: { widthBehavior: 'fill', contentAlignment: 'start' }
    })
    expect(inside?.token).not.toHaveProperty('sampleText')
    expect(JSON.stringify(result.controls)).not.toContain('private-repository-name')
    expect(JSON.stringify(result.controls)).not.toContain('/private/repository')
  })

  it('does not promote a much wider transient row from sibling-graphic evidence alone', async () => {
    const dom = new JSDOM(`
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <div id="row" style="
          display:flex;width:289px;height:32px;padding:0 16px 0 0;
          align-items:center;gap:10px
        ">
          <span id="visual">
            <svg id="repo-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v12H2Z"/>
            </svg>
          </span>
          <div id="copy-owner"><div><div>
            <a id="inside" href="/private/repository" style="
              display:inline-flex;width:120px;height:21px;align-items:center
            ">
              <span id="private-label">private-repository-name</span>
            </a>
          </div></div></div>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#transient')!.getBoundingClientRect =
      () => rect(320, 510)
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect =
      () => rect(289, 32, 8, 8)
    document.querySelector<HTMLElement>('#copy-owner')!.getBoundingClientRect =
      () => rect(247, 32, 42, 8)
    document.querySelector<HTMLElement>('#inside')!.getBoundingClientRect =
      () => rect(120, 21, 42, 13.5)
    document.querySelector<HTMLElement>('#visual')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    document.querySelector<HTMLElement>('#repo-icon')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    document.querySelector<HTMLElement>('#private-label')!.getBoundingClientRect =
      () => rect(120, 20, 42, 14)

    const result = await collectControlsWithObservations(document)

    const interaction = document.querySelector<HTMLElement>('#inside')!
    const row = document.querySelector<HTMLElement>('#row')!
    const inside = result.observations.find(observation =>
      observation.ownership.interaction === interaction
    )
    expect(inside?.ownership).toEqual({
      interaction,
      layout: interaction,
      paint: interaction,
      slots: row,
      compositeAnchor: row
    })
    expect(inside?.token).toMatchObject({
      geometry: { height: 21, minWidth: null },
      slots: {
        leading: { assetType: 'ui-icon', width: 16, height: 16 },
        trailing: null
      },
      content: { kind: 'icon-leading' },
      layout: { widthBehavior: 'hug', contentAlignment: 'start' }
    })
    expect(inside?.token).not.toHaveProperty('sampleText')
    expect(JSON.stringify(result.controls)).not.toContain('private-repository-name')
    expect(JSON.stringify(result.controls)).not.toContain('/private/repository')
  })

  it('ignores an invisible non-file selection input when resolving a safe row slot', async () => {
    const dom = new JSDOM(`
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <div id="row" style="
          display:flex;width:289px;height:32px;padding:0 16px 0 0;
          align-items:center;gap:10px
        ">
          <input id="selection" type="radio" hidden />
          <svg id="repo-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2Z"/>
          </svg>
          <div><div><div>
            <a id="inside" href="/private/repository" style="
              display:inline-flex;width:120px;height:21px;align-items:center
            "><span id="private-label">private-repository-name</span></a>
          </div></div></div>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#transient')!.getBoundingClientRect =
      () => rect(320, 510)
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect =
      () => rect(289, 32, 8, 8)
    document.querySelector<HTMLElement>('#selection')!.getBoundingClientRect =
      () => rect(0, 0)
    document.querySelector<HTMLElement>('#inside')!.getBoundingClientRect =
      () => rect(120, 21, 42, 13.5)
    document.querySelector<HTMLElement>('#repo-icon')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    document.querySelector<HTMLElement>('#private-label')!.getBoundingClientRect =
      () => rect(120, 20, 42, 14)

    const result = await collectControlsWithObservations(document)
    const inside = result.observations.find(observation =>
      observation.ownership.interaction.id === 'inside'
    )

    expect(inside?.ownership.layout.id).toBe('inside')
    expect(inside?.token).toMatchObject({
      geometry: { height: 21, minWidth: null },
      slots: {
        leading: { assetType: 'ui-icon', width: 16, height: 16 },
        trailing: null
      },
      content: { kind: 'icon-leading' },
      layout: { widthBehavior: 'hug', contentAlignment: 'start' }
    })
    expect(JSON.stringify(inside?.token)).not.toContain('/private/repository')
  })

  it('does not promote a zero-padding transient row when the safe control is not a link', async () => {
    const dom = new JSDOM(`
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <div id="row" style="
          display:flex;width:289px;height:32px;padding:0;
          align-items:center;gap:10px
        ">
          <input id="selection" type="radio" hidden />
          <svg id="repo-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2Z"/>
          </svg>
          <button id="inside" role="menuitemradio" style="
            display:inline-flex;width:247px;height:32px;padding:0;border:0;
            align-items:center;background:transparent
          "><span id="private-label">private-repository-name</span></button>
          <button id="other" style="width:24px;height:24px">Other</button>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#transient')!.getBoundingClientRect =
      () => rect(320, 510)
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect =
      () => rect(289, 32, 8, 8)
    document.querySelector<HTMLElement>('#selection')!.getBoundingClientRect =
      () => rect(0, 0)
    document.querySelector<HTMLElement>('#repo-icon')!.getBoundingClientRect =
      () => rect(16, 16, 8, 16)
    document.querySelector<HTMLElement>('#inside')!.getBoundingClientRect =
      () => rect(247, 32, 42, 8)
    document.querySelector<HTMLElement>('#other')!.getBoundingClientRect =
      () => rect(24, 24, 265, 12)
    document.querySelector<HTMLElement>('#private-label')!.getBoundingClientRect =
      () => rect(160, 20, 42, 14)

    const result = await collectControlsWithObservations(document)
    const inside = result.observations.find(observation =>
      observation.ownership.interaction.id === 'inside'
    )

    expect(inside?.ownership.compositeAnchor.id).toBe('inside')
    expect(inside?.token).toMatchObject({
      geometry: { height: 32, minWidth: null },
      slots: { leading: null, trailing: null },
      content: { kind: 'text-only' },
      layout: { widthBehavior: 'hug', contentAlignment: 'center' }
    })
    expect(inside?.token).not.toHaveProperty('sampleText')
    expect(JSON.stringify(inside?.token)).not.toContain('private-repository-name')
  })

  it('keeps a zero-padding transient product command slot without promoting layout', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <div id="row" style="
          display:flex;width:289px;height:32px;padding:0;
          align-items:center;gap:10px
        ">
          <svg id="command-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2Z"/>
          </svg>
          <button id="inside" role="menuitem" style="
            display:inline-flex;width:120px;height:21px;padding:0;border:0;
            align-items:center;background:transparent
          "><span id="private-label">private-command-name</span></button>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const interaction = document.querySelector<HTMLElement>('#inside')!
    const row = document.querySelector<HTMLElement>('#row')!
    row.getBoundingClientRect = () => rect(289, 32, 8, 8)
    document.querySelector<HTMLElement>('#command-icon')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    interaction.getBoundingClientRect = () => rect(120, 21, 42, 13.5)
    document.querySelector<HTMLElement>('#private-label')!.getBoundingClientRect =
      () => rect(120, 20, 42, 14)

    const result = await collectControlsWithObservations(document)
    const inside = result.observations.find(observation =>
      observation.ownership.interaction === interaction
    )

    expect(inside?.ownership).toEqual({
      interaction,
      layout: interaction,
      paint: interaction,
      slots: row,
      compositeAnchor: row
    })
    expect(inside?.token).toMatchObject({
      geometry: { height: 21, minWidth: null },
      slots: {
        leading: { assetType: 'ui-icon', width: 16, height: 16 },
        trailing: null
      },
      content: { kind: 'icon-leading' },
      layout: { widthBehavior: 'hug', contentAlignment: 'center' }
    })
    expect(inside?.token).not.toHaveProperty('sampleText')
    expect(JSON.stringify(result.controls)).not.toContain('private-command-name')
  })

  it('does not promote a transient row that contains a native file input', async () => {
    const dom = new JSDOM(`
      <div id="transient" data-smart-scan-transient-structure="true" role="menu"
        style="width:320px;padding:8px">
        <div id="row" style="display:flex;width:289px;height:32px;align-items:center;gap:10px">
          <input id="file" type="file" hidden />
          <svg id="upload-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2Z"/>
          </svg>
          <a id="inside" href="/safe/action" style="display:inline-flex;width:120px;height:21px">
            <span id="label">Safe action</span>
          </a>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#transient')!.getBoundingClientRect =
      () => rect(320, 48)
    document.querySelector<HTMLElement>('#row')!.getBoundingClientRect =
      () => rect(289, 32, 8, 8)
    document.querySelector<HTMLElement>('#file')!.getBoundingClientRect =
      () => rect(0, 0)
    document.querySelector<HTMLElement>('#inside')!.getBoundingClientRect =
      () => rect(120, 21, 42, 13.5)
    document.querySelector<HTMLElement>('#upload-icon')!.getBoundingClientRect =
      () => rect(16, 16, 16, 16)
    document.querySelector<HTMLElement>('#label')!.getBoundingClientRect =
      () => rect(80, 20, 42, 14)

    const result = await collectControlsWithObservations(document)
    const inside = result.observations.find(observation =>
      observation.ownership.interaction.id === 'inside'
    )

    expect(inside?.ownership.compositeAnchor.id).toBe('inside')
    expect(inside?.token.slots.leading).toBeNull()
  })

  it('records measured start alignment for a full-width menu row', async () => {
    const dom = new JSDOM(`
      <div id="menu" style="width:240px;padding:8px">
        <button id="row" style="
          display:flex;justify-content:flex-start;align-items:center;
          width:224px;height:32px;padding:6px 8px;gap:8px
        ">
          <svg id="icon" viewBox="0 0 16 16" fill="none">
            <path d="M2 8h12" stroke="currentColor" stroke-width="2"/>
          </svg>
          <span id="label">Safe action</span>
        </button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('menu')!.getBoundingClientRect = () => rect(240, 48)
    document.getElementById('row')!.getBoundingClientRect = () => rect(224, 32, 8, 8)
    document.getElementById('icon')!.getBoundingClientRect = () => rect(16, 16, 16, 16)
    document.getElementById('label')!.getBoundingClientRect = () => rect(80, 20, 40, 14)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.layout).toEqual({
      widthBehavior: 'fill',
      contentAlignment: 'start'
    })
  })

  it('measures width and alignment from the promoted visual root', async () => {
    const dom = new JSDOM(`
      <div id="menu" style="width:196px;padding:8px">
        <div id="surface" style="
          display:flex;justify-content:flex-start;align-items:center;
          width:180px;height:40px;padding:4px 8px;gap:8px;
          border-radius:8px;background:rgb(245,245,245)
        ">
          <svg id="icon" viewBox="0 0 16 16" fill="none">
            <path d="M2 8h12" stroke="currentColor" stroke-width="2"/>
          </svg>
          <button id="row" style="
            display:flex;justify-content:center;align-items:center;
            width:120px;height:32px;padding:0;border:0;background:transparent
          "><span id="label">Safe action</span></button>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('menu')!.getBoundingClientRect = () => rect(196, 56)
    document.getElementById('surface')!.getBoundingClientRect = () => rect(180, 40, 8, 8)
    document.getElementById('icon')!.getBoundingClientRect = () => rect(16, 16, 16, 20)
    document.getElementById('row')!.getBoundingClientRect = () => rect(120, 32, 40, 12)
    document.getElementById('label')!.getBoundingClientRect = () => rect(40, 20, 80, 18)

    const tokens = await collectControls(document)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      geometry: { height: 40, minWidth: 180 },
      slots: { leading: { width: 16, height: 16 } },
      layout: {
        widthBehavior: 'fill',
        contentAlignment: 'start'
      }
    })
  })
})
