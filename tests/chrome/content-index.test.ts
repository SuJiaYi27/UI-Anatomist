import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import {
  createControlStateNormalizer,
  inspectDocument,
  registerInspectionListener
} from '../../src/chrome/content/index'
import { collectControlsWithObservations } from '../../src/chrome/content/controls'
import {
  HOVER_PROBE_ATTRIBUTE,
  HOVER_TARGET_ATTRIBUTE
} from '../../src/chrome/content/hover-state-explorer'
import { anonymousControlLogicalId } from '../../src/chrome/content/control-identity'
import { createControlDiagnosticRecorder } from '../../src/chrome/content/control-diagnostics'
import {
  INTERACTION_RESTORE_ABORT_CODE,
  InteractionRestoreError,
  isInteractionRestoreError
} from '../../src/chrome/interaction-restore-error'

describe('inspectDocument', () => {
  it('uses one fixed typed code for interaction restoration aborts', () => {
    const error = new InteractionRestoreError()

    expect(error).toMatchObject({
      name: 'InteractionRestoreError',
      code: INTERACTION_RESTORE_ABORT_CODE
    })
    expect(isInteractionRestoreError(error)).toBe(true)
    expect(isInteractionRestoreError({ code: INTERACTION_RESTORE_ABORT_CODE })).toBe(true)
    expect(isInteractionRestoreError(new Error(INTERACTION_RESTORE_ABORT_CODE))).toBe(false)
  })

  it('exports only anonymous disclosure pipeline evidence', async () => {
    const dom = new JSDOM(`
      <input id="private-file-target" type="file" hidden>
      <button id="blocked" aria-haspopup="dialog" aria-controls="private-file-target">
        Upload confidential-roadmap.pdf
      </button>
      <button id="safe" aria-label="Private account tools"
        aria-haspopup="menu" aria-expanded="false">
        Menu
      </button>
    `, { url: 'https://example.com/private/account?token=secret', pretendToBeVisual: true })
    const document = dom.window.document
    const safe = document.querySelector<HTMLButtonElement>('#safe')!
    const expectedCandidateId = await anonymousControlLogicalId(document, safe)
    safe.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 32,
      top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({})
    })
    safe.addEventListener('click', () => {
      const existing = document.querySelector('[role="menu"]')
      if (existing) {
        existing.remove()
        safe.setAttribute('aria-expanded', 'false')
      } else {
        const menu = document.createElement('div')
        menu.setAttribute('role', 'menu')
        document.body.append(menu)
        safe.setAttribute('aria-expanded', 'true')
      }
    })

    const result = await inspectDocument(document, {
      stability: { minimumWaitMs: 0, quietPeriodMs: 0, maximumWaitMs: 50 }
    })
    const stages = result.diagnostics?.disclosures.map(row => row.stage) ?? []

    expect(stages).toEqual(expect.arrayContaining([
      'rejected-file-picker',
      'classified',
      'activation-attempted',
      'opened-transient',
      'sampled',
      'restored'
    ]))
    expect(result.diagnostics?.disclosures).toContainEqual(expect.objectContaining({
      candidateId: expectedCandidateId,
      stage: 'activation-attempted'
    }))
    const serialized = JSON.stringify(result.diagnostics)
    expect(serialized).not.toContain('confidential-roadmap')
    expect(serialized).not.toContain('Private account tools')
    expect(serialized).not.toContain('private-file-target')
    expect(serialized).not.toContain('/private/account')
    expect(serialized).not.toContain('token=secret')
  })

  it('exports anonymous Composite rejection evidence linked only by stable Control IDs', async () => {
    const dom = new JSDOM(`
      <div id="private-holder" data-smart-scan-transient-owner="sha256:${'7'.repeat(64)}">
        <button id="private-action" style="width:240px;height:40px">
          Confidential repository action
        </button>
      </div>
    `, { url: 'https://example.com/private/repository?token=secret', pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('private-holder')!.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 256, height: 56,
      top: 0, right: 256, bottom: 56, left: 0, toJSON: () => ({})
    })
    document.getElementById('private-action')!.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 240, height: 40,
      top: 8, right: 248, bottom: 48, left: 8, toJSON: () => ({})
    })

    const result = await inspectDocument(document, {
      stability: { minimumWaitMs: 0, quietPeriodMs: 0, maximumWaitMs: 50 }
    })
    const control = result.controls.find(item => item.geometry.height === 40)!

    expect(result.diagnostics?.composites).toContainEqual(expect.objectContaining({
      candidateId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      pageId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      controlIds: [control.id],
      reason: 'no-semantic-or-surface'
    }))
    const serialized = JSON.stringify(result.diagnostics?.composites)
    expect(serialized).not.toContain('Confidential repository action')
    expect(serialized).not.toContain('private-holder')
    expect(serialized).not.toContain('/private/repository')
    expect(serialized).not.toContain('token=secret')
  })

  it('exports only anonymous rejection stages for transient editing controls', async () => {
    const dom = new JSDOM(`
      <div data-smart-scan-transient-structure="true" role="dialog">
        <input id="private-filter" placeholder="Private repository filter" value="secret">
      </div>
    `, { url: 'https://example.com/private/repository?token=secret', pretendToBeVisual: true })
    const document = dom.window.document
    const input = document.querySelector<HTMLInputElement>('#private-filter')!
    input.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 240, height: 32,
      top: 8, right: 248, bottom: 40, left: 8, toJSON: () => ({})
    })

    const result = await inspectDocument(document, {
      stability: { minimumWaitMs: 0, quietPeriodMs: 0, maximumWaitMs: 50 }
    })

    expect(result.diagnostics?.controls).toContainEqual(expect.objectContaining({
      candidateId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      pageId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      family: 'input',
      stage: 'rejected-no-painted-frame'
    }))
    const serialized = JSON.stringify(result.diagnostics?.controls)
    expect(serialized).not.toContain('Private repository filter')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('private-filter')
    expect(serialized).not.toContain('/private/repository')
    expect(serialized).not.toContain('token=secret')
  })

  it('records an anonymous rejected input beside a transient list without collecting it', async () => {
    const dom = new JSDOM(`
      <section id="panel" style="width:320px;height:576px;background:white">
        <div id="list" role="listbox" data-smart-scan-transient-structure="true" style="
          width:320px;height:384px
        "></div>
        <input id="footer" style="width:288px;height:40px" />
      </section>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('panel')!.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 320, height: 576,
      top: 0, right: 320, bottom: 576, left: 0, toJSON: () => ({})
    })
    document.getElementById('list')!.getBoundingClientRect = () => ({
      x: 0, y: 96, width: 320, height: 384,
      top: 96, right: 320, bottom: 480, left: 0, toJSON: () => ({})
    })
    document.getElementById('footer')!.getBoundingClientRect = () => ({
      x: 16, y: 520, width: 288, height: 40,
      top: 520, right: 304, bottom: 560, left: 16, toJSON: () => ({})
    })
    const recorder = createControlDiagnosticRecorder(document)

    const collected = await collectControlsWithObservations(document, { diagnostics: recorder })
    const diagnostics = await recorder.finalize()

    expect(collected.controls).toEqual([])
    expect(diagnostics).toContainEqual(expect.objectContaining({
      candidateId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      pageId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      family: 'input',
      stage: 'rejected-no-painted-frame',
      occurrences: 1
    }))
    const serialized = JSON.stringify(diagnostics)
    expect(serialized).not.toContain('footer')
    expect(serialized).not.toContain('panel')
    expect(serialized).not.toContain('example.com')
  })

  it('exports only anonymous final rejection stages for transient links', async () => {
    const dom = new JSDOM(`
      <div id="menu" data-smart-scan-transient-structure="true" role="menu" style="display:block;width:296px;height:48px">
        <a id="private-row" href="/private/repository" style="display:flex;width:280px;height:32px;color:rgb(31,35,40)"></a>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('#menu')!
    const row = document.querySelector<HTMLElement>('#private-row')!
    menu.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 296, height: 48,
      top: 0, right: 296, bottom: 48, left: 0, toJSON: () => ({})
    })
    row.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 280, height: 32,
      top: 8, right: 288, bottom: 40, left: 8, toJSON: () => ({})
    })

    const recorder = createControlDiagnosticRecorder(document)
    await collectControlsWithObservations(document, { diagnostics: recorder })
    const diagnostics = await recorder.finalize()

    expect(diagnostics).toContainEqual(expect.objectContaining({
      candidateId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      pageId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      family: 'button',
      stage: 'rejected-empty-control'
    }))
    const serialized = JSON.stringify(diagnostics)
    expect(serialized).not.toContain('private-repository-name')
    expect(serialized).not.toContain('private-row')
    expect(serialized).not.toContain('/private/repository')
  })

  it('returns one ordered composite for a painted menu that owns several controls', async () => {
    const dom = new JSDOM(`
      <div id="menu" role="menu" style="
        display:flex;
        flex-direction:column;
        gap:4px;
        padding:8px;
        border-radius:12px;
        background:rgb(250,250,250)
      ">
        <button style="height:40px">Create an image</button>
        <button style="height:40px">Write or edit</button>
        <button style="height:40px">Search the web</button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const menu = dom.window.document.querySelector<HTMLElement>('#menu')!
    menu.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 240, height: 144,
      top: 0, right: 240, bottom: 144, left: 0, toJSON: () => ({})
    })
    dom.window.document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => ({
        x: 8, y: 8 + index * 44, width: 224, height: 40,
        top: 8 + index * 44, right: 232, bottom: 48 + index * 44, left: 8,
        toJSON: () => ({})
      })
    })

    const result = await inspectDocument(dom.window.document)
    const composites = (result as unknown as {
      composites: Array<{ kind: string; children: Array<{ kind: string }> }>
    }).composites ?? []

    expect(composites).toHaveLength(1)
    expect(composites[0]).toMatchObject({
      kind: 'menu',
      children: [{ kind: 'control' }, { kind: 'control' }, { kind: 'control' }]
    })
  })

  it('collects a complete native details holder without activating its file row', async () => {
    const dom = new JSDOM(`
      <details id="holder" style="
        display:block;width:320px;height:136px
      ">
        <summary id="summary">Arbitrary tools</summary>
        <div id="menu" role="menu" hidden style="
          display:flex;flex-direction:column;width:320px;height:96px;padding:8px;
          background:white;border:1px solid rgb(220,220,220);
          border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.12)
        ">
          <button id="ordinary-row" style="width:304px;height:40px">Ordinary action</button>
          <label id="file-row" role="menuitem" for="native-file"
            style="display:block;width:304px;height:40px">
            Upload item
            <input id="native-file" type="file" hidden>
          </label>
        </div>
      </details>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const details = document.querySelector<HTMLDetailsElement>('#holder')!
    const summary = document.querySelector<HTMLElement>('#summary')!
    const menu = document.querySelector<HTMLElement>('#menu')!
    let fileRowClicks = 0
    summary.addEventListener('click', () => {
      menu.toggleAttribute('hidden', details.open)
    })
    document.querySelector('#file-row')!.addEventListener('click', () => {
      fileRowClicks += 1
    })
    details.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 320, height: 136,
      top: 0, right: 320, bottom: 136, left: 0, toJSON: () => ({})
    })
    summary.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 304, height: 40,
      top: 8, right: 312, bottom: 48, left: 8, toJSON: () => ({})
    })
    menu.getBoundingClientRect = () => ({
      x: 0, y: 40, width: 320, height: 96,
      top: 40, right: 320, bottom: 136, left: 0, toJSON: () => ({})
    })
    document.querySelector<HTMLElement>('#ordinary-row')!.getBoundingClientRect = () => ({
      x: 8, y: 48, width: 304, height: 40,
      top: 48, right: 312, bottom: 88, left: 8, toJSON: () => ({})
    })
    document.querySelector<HTMLElement>('#file-row')!.getBoundingClientRect = () => ({
      x: 8, y: 88, width: 304, height: 40,
      top: 88, right: 312, bottom: 128, left: 8, toJSON: () => ({})
    })

    const result = await inspectDocument(document)

    expect(result.revealedStates).toBe(1)
    expect(result.composites).toContainEqual(expect.objectContaining({
      kind: 'menu',
      geometry: expect.objectContaining({
        width: 320,
        height: 96,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        radius: 12
      }),
      appearance: expect.objectContaining({
        background: expect.objectContaining({ a: 1 }),
        shadows: expect.arrayContaining([
          expect.objectContaining({ kind: 'outer' })
        ])
      }),
      children: expect.arrayContaining([
        expect.objectContaining({ kind: 'control' })
      ])
    }))
    expect(fileRowClicks).toBe(0)
    expect(details.open).toBe(false)
  })

  it('rejects a top-level HTTP error document before sampling it as page UI', async () => {
    const dom = new JSDOM(
      '<main role="main"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg></main>',
      {
        url: 'https://example.com/',
        pretendToBeVisual: true
      }
    )
    Object.defineProperty(dom.window.performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ responseStatus: 503 }]
    })

    await expect(inspectDocument(dom.window.document))
      .rejects.toThrow('UI-Anatomist cannot inspect an HTTP 503 page')
  })

  it('samples a deterministic default state and restores the page focus afterward', async () => {
    const dom = new JSDOM(
      '<input aria-label="Search" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:white">',
      {
      url: 'https://example.com/',
      pretendToBeVisual: true
      }
    )
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 240, height: 40,
      top: 0, right: 240, bottom: 40, left: 0, toJSON: () => ({})
    })
    const input = dom.window.document.querySelector('input')!
    input.focus()

    const result = await inspectDocument(dom.window.document)

    expect(result.controls).toHaveLength(1)
    expect(result.controls[0]?.state).toBe('default')
    expect(dom.window.document.activeElement).toBe(input)
  })

  it('restores the exact focused descendant inside an open shadow root', async () => {
    const dom = new JSDOM('<div id="host"></div>', {
      url: 'https://example.com/',
      pretendToBeVisual: true
    })
    const document = dom.window.document
    const host = document.querySelector<HTMLElement>('#host')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<input id="first"><input id="second">'
    const second = shadow.querySelector<HTMLInputElement>('#second')!
    second.focus()
    const blur = vi.spyOn(second, 'blur')
    const focus = vi.spyOn(second, 'focus')

    await inspectDocument(document, {
      stability: { minimumWaitMs: 0, quietPeriodMs: 0, maximumWaitMs: 0 }
    })

    expect(blur).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalled()
    expect(document.activeElement).toBe(host)
    expect(shadow.activeElement).toBe(second)
  })

  it('attributes an active control visual change to Focus without using activeElement alone', async () => {
    const dom = new JSDOM(
      '<button style="width:120px;height:32px;background:white">Choice</button>',
      { url: 'https://example.com/', pretendToBeVisual: true }
    )
    const document = dom.window.document
    const button = document.querySelector<HTMLButtonElement>('button')!
    button.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 32,
      top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({})
    })
    const normalize = createControlStateNormalizer()
    const baseline = await collectControlsWithObservations(document)
    await normalize(baseline)
    const baselineToken = baseline.controls[0]!
    const focusedToken = {
      ...baselineToken,
      id: `sha256:${'f'.repeat(64)}`,
      appearance: {
        ...baselineToken.appearance,
        outline: { r: 0.03, g: 0.41, b: 0.85, a: 1 },
        outlineWidth: 2,
        outlineOffset: -1
      }
    }
    button.focus()

    const focused = await normalize({
      controls: [focusedToken],
      observations: baseline.observations.map(observation => ({
        ...observation,
        token: focusedToken
      }))
    })

    expect(document.activeElement).toBe(button)
    expect(focused.controls.map(token => token.state)).toEqual(['focus'])
  })

  it('attributes a first-seen painted focus ring to Focus', async () => {
    const dom = new JSDOM(
      '<button style="width:120px;height:32px;background:white">Choice</button>',
      { url: 'https://example.com/', pretendToBeVisual: true }
    )
    const document = dom.window.document
    const button = document.querySelector<HTMLButtonElement>('button')!
    button.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 32,
      top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({})
    })
    const normalize = createControlStateNormalizer()
    const firstSeen = await collectControlsWithObservations(document)
    const firstSeenToken = firstSeen.controls[0]!
    const focusedToken = {
      ...firstSeenToken,
      id: `sha256:${'a'.repeat(64)}`,
      appearance: {
        ...firstSeenToken.appearance,
        outline: { r: 0.03, g: 0.41, b: 0.85, a: 1 },
        outlineWidth: 2,
        outlineOffset: -1
      }
    }
    button.focus()

    const focused = await normalize({
      controls: [focusedToken],
      observations: firstSeen.observations.map(observation => ({
        ...observation,
        token: focusedToken
      }))
    })

    expect(document.activeElement).toBe(button)
    expect(focused.controls.map(token => token.state)).toEqual(['focus'])
  })

  it('attributes a focused visual change on an already selected control to Focus', async () => {
    const dom = new JSDOM(
      '<button aria-selected="true" style="width:68px;height:32px;background:white">Choice</button>',
      { url: 'https://example.com/', pretendToBeVisual: true }
    )
    const document = dom.window.document
    const button = document.querySelector<HTMLButtonElement>('button')!
    button.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 68, height: 32,
      top: 0, right: 68, bottom: 32, left: 0, toJSON: () => ({})
    })
    const normalize = createControlStateNormalizer()
    const baseline = await collectControlsWithObservations(document)
    expect(baseline.controls.map(token => token.state)).toEqual(['selected'])
    await normalize(baseline)
    const selectedToken = baseline.controls[0]!
    const focusedToken = {
      ...selectedToken,
      id: `sha256:${'d'.repeat(64)}`,
      appearance: {
        ...selectedToken.appearance,
        outline: { r: 0.03, g: 0.41, b: 0.85, a: 1 },
        outlineWidth: 2,
        outlineOffset: 0
      }
    }
    button.focus()

    const focused = await normalize({
      controls: [focusedToken],
      observations: baseline.observations.map(observation => ({
        ...observation,
        token: focusedToken
      }))
    })

    expect(document.activeElement).toBe(button)
    expect(focused.controls.map(token => token.state)).toEqual(['focus'])
  })

  it('does not attribute a sibling action focus to another control sharing its visual shell', async () => {
    const dom = new JSDOM(`
      <div id="shell">
        <button id="control" style="width:120px;height:32px;background:white">Choice</button>
        <button id="action">More</button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const shell = document.querySelector<HTMLElement>('#shell')!
    const control = document.querySelector<HTMLButtonElement>('#control')!
    const action = document.querySelector<HTMLButtonElement>('#action')!
    control.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 32,
      top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({})
    })
    const normalize = createControlStateNormalizer()
    const baseline = await collectControlsWithObservations(document)
    const controlObservation = baseline.observations.find(observation =>
      observation.ownership.interaction === control
    )!
    await normalize({
      controls: [controlObservation.token],
      observations: [{
        ...controlObservation,
        ownership: {
          ...controlObservation.ownership,
          layout: shell,
          paint: shell,
          slots: shell,
          compositeAnchor: shell
        }
      }]
    })
    const changedToken = {
      ...controlObservation.token,
      id: `sha256:${'e'.repeat(64)}`,
      appearance: {
        ...controlObservation.token.appearance,
        outline: { r: 0.03, g: 0.41, b: 0.85, a: 1 },
        outlineWidth: 2,
        outlineOffset: -1
      }
    }
    action.focus()

    const changed = await normalize({
      controls: [changedToken],
      observations: [{
        ...controlObservation,
        ownership: {
          ...controlObservation.ownership,
          layout: shell,
          paint: shell,
          slots: shell,
          compositeAnchor: shell
        },
        token: changedToken
      }]
    })

    expect(document.activeElement).toBe(action)
    expect(changed.controls.map(token => token.state)).toEqual(['default'])
  })

  it('returns each discovered candidate once across rendered state samples', async () => {
    const dom = new JSDOM(`
      <style>
        a:hover, button:hover { background: rgb(238, 238, 238); }
      </style>
      <nav>
        <a href="/docs">Docs</a>
        <button>Delete</button>
      </nav>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 40,
      top: 0, right: 120, bottom: 40, left: 0, toJSON: () => ({})
    })

    const result = await inspectDocument(dom.window.document)

    expect(result.candidates).toHaveLength(2)
    expect(new Set(result.candidates.map(candidate => JSON.stringify(candidate))).size)
      .toBe(2)
  })

  it('uses one forced CSS hover state for every design-system collector', async () => {
    const dom = new JSDOM(`
      <style>
        .add:hover {
          background: rgb(238, 238, 238);
          border-radius: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,.2);
        }
      </style>
      <button class="add" aria-label="Add files">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 12h16"/>
        </svg>
      </button>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const button = dom.window.document.querySelector('button')!
    const svg = dom.window.document.querySelector('svg')!
    button.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 32, height: 32,
      top: 0, right: 32, bottom: 32, left: 0, toJSON: () => ({})
    })
    svg.getBoundingClientRect = () => ({
      x: 4, y: 4, width: 24, height: 24,
      top: 4, right: 28, bottom: 28, left: 4, toJSON: () => ({})
    })

    const result = await inspectDocument(dom.window.document)

    expect(result.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'button', state: 'hover' })
    ]))
    expect(result.icons[0]?.interactionSurfaces).toEqual([
      expect.objectContaining({
        state: 'hover',
        width: 32,
        height: 32,
        radii: {
          topLeft: 4,
          topRight: 4,
          bottomRight: 4,
          bottomLeft: 4
        }
      })
    ])
    expect(result.shadows.some(token => token.layers[0]?.blur === 12)).toBe(true)
    expect(dom.window.document.querySelector('[data-smart-scan-hover-probe]')).toBeNull()
  })

  it('attributes an ancestor-hover descendant visual change to Hover', async () => {
    const dom = new JSDOM(`
      <div id="trigger" role="button" style="width:120px;height:40px">
        <button id="code" style="width:80px;height:32px;background:rgb(31,136,61)">
          Code
        </button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const trigger = document.querySelector<HTMLElement>('#trigger')!
    const code = document.querySelector<HTMLButtonElement>('#code')!
    trigger.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 40,
      top: 0, right: 120, bottom: 40, left: 0, toJSON: () => ({})
    })
    code.getBoundingClientRect = () => ({
      x: 0, y: 4, width: 80, height: 32,
      top: 4, right: 80, bottom: 36, left: 0, toJSON: () => ({})
    })
    trigger.addEventListener('pointerenter', () => {
      code.style.background = 'rgb(26, 127, 55)'
    })
    trigger.addEventListener('pointerleave', () => {
      code.style.background = 'rgb(31, 136, 61)'
    })

    const result = await inspectDocument(document, {
      stability: {
        minimumWaitMs: 0,
        quietPeriodMs: 0,
        maximumWaitMs: 50
      }
    })
    const codeTokens = result.controls.filter(token =>
      token.sampleText?.value === 'Code' &&
      token.appearance.background.a > 0
    )

    expect(codeTokens.map(token => token.state)).toEqual(['default', 'hover'])
    expect(codeTokens).toHaveLength(2)
    expect(codeTokens[0]?.appearance.background).toEqual({
      r: 0.1216,
      g: 0.5333,
      b: 0.2392,
      a: 1
    })
    expect(codeTokens[1]?.appearance.background).toEqual({
      r: 0.102,
      g: 0.498,
      b: 0.2157,
      a: 1
    })
  })

  it('normalizes a contextual descendant visual directly as Hover', async () => {
    const dom = new JSDOM(`
      <div id="trigger" role="button" style="width:120px;height:40px">
        <button id="code" style="width:80px;height:32px;background:rgb(31,136,61)">
          Code
        </button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const trigger = document.querySelector<HTMLElement>('#trigger')!
    const code = document.querySelector<HTMLButtonElement>('#code')!
    trigger.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 40,
      top: 0, right: 120, bottom: 40, left: 0, toJSON: () => ({})
    })
    code.getBoundingClientRect = () => ({
      x: 0, y: 4, width: 80, height: 32,
      top: 4, right: 80, bottom: 36, left: 0, toJSON: () => ({})
    })
    const normalize = createControlStateNormalizer()
    const baseline = await normalize(await collectControlsWithObservations(document))

    trigger.setAttribute(HOVER_PROBE_ATTRIBUTE, 'true')
    trigger.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
    code.style.background = 'rgb(26, 127, 55)'
    expect(document.defaultView?.getComputedStyle(code).backgroundColor)
      .toBe('rgb(26, 127, 55)')
    const collectedContextual = await collectControlsWithObservations(document)
    const contextualObservation = collectedContextual.observations.find(observation =>
      observation.ownership.interaction === code
    )
    expect(contextualObservation?.ownership.interaction.closest(`[${HOVER_PROBE_ATTRIBUTE}]`))
      .toBe(trigger)
    expect(contextualObservation?.token.appearance.background).toEqual({
      r: 0.102,
      g: 0.498,
      b: 0.2157,
      a: 1
    })
    const contextual = await normalize(collectedContextual)

    expect(baseline.controls.filter(token =>
      token.sampleText?.value === 'Code' && token.appearance.background.a > 0
    )
      .map(token => token.state)).toEqual(['default'])
    expect(contextual.controls.filter(token =>
      token.sampleText?.value === 'Code' && token.appearance.background.a > 0
    )
      .map(token => token.state)).toEqual(['hover'])

    const repeated = await normalize(await collectControlsWithObservations(document))
    expect(repeated.controls.filter(token =>
      token.sampleText?.value === 'Code' && token.appearance.background.a > 0
    )
      .map(token => token.state)).toEqual(['hover'])
  })

  it('keeps ancestor Hover causality when that visual was already seen as Expanded', async () => {
    const dom = new JSDOM(`
      <div id="trigger" role="button" style="width:120px;height:40px">
        <button id="code" aria-expanded="false"
          style="width:80px;height:32px;background:rgb(31,136,61)">
          Code
        </button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const trigger = document.querySelector<HTMLElement>('#trigger')!
    const code = document.querySelector<HTMLButtonElement>('#code')!
    trigger.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 40,
      top: 0, right: 120, bottom: 40, left: 0, toJSON: () => ({})
    })
    code.getBoundingClientRect = () => ({
      x: 0, y: 4, width: 80, height: 32,
      top: 4, right: 80, bottom: 36, left: 0, toJSON: () => ({})
    })
    const normalize = createControlStateNormalizer()
    await normalize(await collectControlsWithObservations(document))

    code.setAttribute('aria-expanded', 'true')
    code.style.background = 'rgb(26, 127, 55)'
    const expanded = await normalize(await collectControlsWithObservations(document))
    expect(expanded.controls.filter(token =>
      token.sampleText?.value === 'Code' && token.appearance.background.a > 0
    ).map(token => token.state)).toEqual(['expanded'])

    code.setAttribute('aria-expanded', 'false')
    trigger.setAttribute(HOVER_PROBE_ATTRIBUTE, 'true')
    trigger.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')
    const contextual = await normalize(await collectControlsWithObservations(document))

    expect(contextual.controls.filter(token =>
      token.sampleText?.value === 'Code' && token.appearance.background.a > 0
    ).map(token => token.state)).toEqual(['hover'])
  })

  it('preserves Expanded evidence even when its control visual is unchanged', async () => {
    const dom = new JSDOM(`
      <button id="disclosure" aria-expanded="false"
        style="width:120px;height:32px;background:white">
        Open
      </button>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const disclosure = document.querySelector<HTMLButtonElement>('#disclosure')!
    disclosure.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 32,
      top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({})
    })
    const normalize = createControlStateNormalizer()
    const baseline = await normalize(await collectControlsWithObservations(document))
    disclosure.setAttribute('aria-expanded', 'true')
    const expanded = await normalize(await collectControlsWithObservations(document))

    expect(baseline.controls.map(token => token.state)).toEqual(['default'])
    expect(expanded.controls.map(token => token.state)).toEqual(['expanded'])
  })

  it('does not export a Hover variant when the control presentation is unchanged', async () => {
    const dom = new JSDOM(`
      <button id="settings" style="width:120px;height:32px;background:transparent">
        <span>Settings</span><span id="decoration"></span>
      </button>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const settings = document.querySelector<HTMLButtonElement>('#settings')!
    const decoration = document.querySelector<HTMLElement>('#decoration')!
    settings.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 32,
      top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({})
    })
    decoration.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({})
    })
    settings.addEventListener('pointerenter', () => {
      decoration.style.opacity = '0.5'
    })
    settings.addEventListener('pointerleave', () => {
      decoration.style.opacity = '1'
    })

    const result = await inspectDocument(document, {
      stability: {
        minimumWaitMs: 0,
        quietPeriodMs: 0,
        maximumWaitMs: 50
      }
    })
    const tokens = result.controls.filter(token =>
      token.sampleText?.value === 'Settings'
    )

    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.state).toBe('default')
  })

  it('exports a visually distinct open disclosure as Expanded instead of a second Default', async () => {
    const dom = new JSDOM(`
      <style>
        #code { background:rgb(31,136,61); }
        #code[aria-expanded="true"] {
          background:rgb(26,127,55);
          box-shadow:inset 0 0 0 1px rgba(0,0,0,.15);
        }
      </style>
      <button id="code" aria-expanded="false" aria-controls="menu"
        style="width:80px;height:32px">
        Code
      </button>
      <div id="menu" role="menu" hidden>
        <button style="width:120px;height:32px">Local</button>
        <button style="width:120px;height:32px">Codespaces</button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const code = document.querySelector<HTMLButtonElement>('#code')!
    const menu = document.querySelector<HTMLElement>('#menu')!
    code.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 80, height: 32,
      top: 0, right: 80, bottom: 32, left: 0, toJSON: () => ({})
    })
    menu.getBoundingClientRect = () => ({
      x: 0, y: 40, width: 136, height: 80,
      top: 40, right: 136, bottom: 120, left: 0, toJSON: () => ({})
    })
    menu.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => ({
        x: 8, y: 48 + index * 32, width: 120, height: 32,
        top: 48 + index * 32, right: 128, bottom: 80 + index * 32, left: 8,
        toJSON: () => ({})
      })
    })
    code.addEventListener('click', () => {
      const expanded = code.getAttribute('aria-expanded') !== 'true'
      code.setAttribute('aria-expanded', String(expanded))
      menu.hidden = !expanded
    })

    const result = await inspectDocument(document, {
      stability: {
        minimumWaitMs: 0,
        quietPeriodMs: 0,
        maximumWaitMs: 50
      }
    })
    const codeTokens = result.controls.filter(token =>
      token.sampleText?.value === 'Code'
    )

    expect(codeTokens.map(token => token.state)).toEqual(['default', 'expanded'])
    expect(code.getAttribute('aria-expanded')).toBe('false')
    expect(menu.hidden).toBe(true)
  })

  it('keeps composite child references valid when a no-op Hover state is collapsed', async () => {
    const dom = new JSDOM(`
      <style>
        .settings:hover .decoration { opacity:.5; }
      </style>
      <div id="menu" role="menu" style="
        display:flex;flex-direction:column;padding:8px;gap:4px;background:white
      ">
        <button class="settings" style="width:120px;height:32px">
          Settings<span class="decoration"></span>
        </button>
        <button style="width:120px;height:32px">Help</button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('#menu')!
    menu.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 136, height: 84,
      top: 0, right: 136, bottom: 84, left: 0, toJSON: () => ({})
    })
    menu.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => ({
        x: 8, y: 8 + index * 36, width: 120, height: 32,
        top: 8 + index * 36, right: 128, bottom: 40 + index * 36, left: 8,
        toJSON: () => ({})
      })
    })
    document.querySelector<HTMLElement>('.decoration')!.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({})
    })

    const result = await inspectDocument(document, {
      stability: {
        minimumWaitMs: 0,
        quietPeriodMs: 0,
        maximumWaitMs: 50
      }
    })
    const controlReferences = new Set(result.controls.map(token =>
      `${token.id}|${token.instanceId ?? token.id}|${token.state}`
    ))
    const unresolved = (result.composites ?? []).flatMap(composite =>
      composite.children.filter(child =>
        child.kind === 'control' &&
        !controlReferences.has(`${child.controlId}|${child.instanceId}|${child.state}`)
      )
    )

    expect(result.composites?.length).toBeGreaterThan(0)
    expect(unresolved).toEqual([])
  })

  it('waits for late hydration before fixing the safe-state candidate set', async () => {
    const dom = new JSDOM('<main id="root"></main>', {
      url: 'https://example.com/',
      pretendToBeVisual: true
    })
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 40,
      top: 0, right: 120, bottom: 40, left: 0, toJSON: () => ({})
    })
    dom.window.setTimeout(() => {
      const root = dom.window.document.querySelector('#root')!
      root.innerHTML = `
        <button aria-expanded="false" aria-controls="late-panel">Search</button>
        <section id="late-panel" hidden style="background:rgb(18,52,86)">Private</section>
      `
      const button = root.querySelector('button')!
      const panel = root.querySelector<HTMLElement>('section')!
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true'
        button.setAttribute('aria-expanded', String(open))
        panel.toggleAttribute('hidden', !open)
      })
    }, 700)

    const inspectWithStability = inspectDocument as unknown as (
      document: Document,
      options: { stability: { minimumWaitMs: number; quietPeriodMs: number; maximumWaitMs: number } }
    ) => ReturnType<typeof inspectDocument>
    const result = await inspectWithStability(dom.window.document, {
      stability: { minimumWaitMs: 850, quietPeriodMs: 50, maximumWaitMs: 1_200 }
    })

    expect(result.revealedStates).toBe(1)
    expect(result.colors.primitives.some(token =>
      token.value.r === 0.0706 && token.value.g === 0.2039 && token.value.b === 0.3373
    )).toBe(true)
  })

  it('collects a field revealed by a custom pointer-only disclosure and restores it', async () => {
    const dom = new JSDOM(`
      <div id="trigger" role="button" aria-haspopup="dialog" aria-expanded="false">
        Open finder
      </div>
      <section id="finder" role="dialog" hidden style="padding:16px;background:#fff">
        <input placeholder="Filter items" style="width:280px;height:36px;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px">
      </section>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const trigger = document.querySelector<HTMLElement>('#trigger')!
    const dialog = document.querySelector<HTMLElement>('#finder')!
    const input = document.querySelector<HTMLInputElement>('input')!
    trigger.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 36,
      top: 0, right: 120, bottom: 36, left: 0, toJSON: () => ({})
    })
    dialog.getBoundingClientRect = () => ({
      x: 0, y: 44, width: 312, height: 68,
      top: 44, right: 312, bottom: 112, left: 0, toJSON: () => ({})
    })
    input.getBoundingClientRect = () => ({
      x: 16, y: 60, width: 280, height: 36,
      top: 60, right: 296, bottom: 96, left: 16, toJSON: () => ({})
    })
    let clickAttempts = 0
    let pointerPresses = 0
    trigger.addEventListener('click', () => {
      clickAttempts += 1
    })
    trigger.addEventListener('pointerdown', () => {
      pointerPresses += 1
      const open = dialog.hidden
      dialog.hidden = !open
      trigger.setAttribute('aria-expanded', String(open))
    })

    const result = await inspectDocument(document, {
      stability: {
        minimumWaitMs: 0,
        quietPeriodMs: 0,
        maximumWaitMs: 50
      }
    })
    const serialized = JSON.stringify(result)

    expect(result.revealedStates).toBe(1)
    expect(result.controls).toContainEqual(expect.objectContaining({
      family: 'input',
      sampleText: { value: 'Filter items', source: 'placeholder' }
    }))
    expect(clickAttempts).toBe(1)
    expect(pointerPresses).toBe(2)
    expect(dialog.hidden).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(serialized).not.toContain('controlOwnership')
    expect(serialized).not.toContain('compositeAnchor')
    expect(serialized).not.toContain('slotRoot')
    expect(serialized).not.toContain('aria-haspopup')
    expect(serialized).not.toContain('https://example.com/')
  })

  it('collects base and reversible-state evidence without returning page body content', async () => {
    const dom = new JSDOM(`
      <a href="/plugins">Plugins</a>
      <button aria-label="Open sidebar">Open sidebar</button>
      <aside role="menu" hidden><a href="/projects">Projects</a></aside>
      <button aria-expanded="false" aria-controls="search-panel" style="border-radius:8px">Search</button>
      <section id="search-panel" hidden style="padding:24px;gap:12px;border-radius:24px;background:rgb(18,52,86);box-shadow:0 8px 24px rgba(0,0,0,.2)"><p style="font-size:31px;line-height:38px;border-radius:16px;color:white">Private search result</p></section>
      <button aria-label="Search chats"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4z"/></svg></button>
      <p style="padding:8px;font-size:16px;line-height:24px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.15);color:#111;background:#fff;border:1px solid #ddd">Private project Alpha</p>
      <div style="border-radius:28px">Private pill</div>
      <img src="logo.png" alt="Brand">
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 56, height: 56, top: 0, right: 56, bottom: 56, left: 0, toJSON: () => ({})
    })
    dom.window.SVGElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 20, height: 20, top: 0, right: 20, bottom: 20, left: 0, toJSON: () => ({})
    })
    const button = dom.window.document.querySelector('button')!
    const sidebar = dom.window.document.querySelector<HTMLElement>('[role="menu"]')!
    const panel = dom.window.document.querySelector('section')!
    button.addEventListener('click', () => sidebar.toggleAttribute('hidden'))
    const searchButton = dom.window.document.querySelectorAll('button')[1]!
    searchButton.addEventListener('click', () => {
      const open = searchButton.getAttribute('aria-expanded') !== 'true'
      searchButton.setAttribute('aria-expanded', String(open))
      panel.toggleAttribute('hidden', !open)
    })

    const result = await inspectDocument(dom.window.document)
    const serialized = JSON.stringify(result)
    expect(result.revealedStates).toBe(2)
    expect(result.typography.some(item => item.fontSizePx === 31)).toBe(true)
    expect(result.borderRadii.some(item => item.kind === 'px' && item.value === 24)).toBe(true)
    expect(result.borderRadii.some(item => item.kind === 'full')).toBe(true)
    expect(result.shadows.find(token => token.layers[0]?.blur === 12)).toMatchObject({
      occurrences: 3,
      layers: [{ kind: 'outer', offsetY: 4, blur: 12 }]
    })
    expect(result.shadows.some(token => token.layers[0]?.blur === 24)).toBe(true)
    expect(result.colors.primitives.length).toBeGreaterThan(0)
    expect(result.colors.primitives.some(token =>
      token.value.r === 0.0706 && token.value.g === 0.2039 && token.value.b === 0.3373
    )).toBe(true)
    expect(result.colors.semantic.some(token => token.group === 'background')).toBe(true)
    expect(result.colors.semantic.some(token => token.group === 'text')).toBe(true)
    expect(result.colors.semantic.some(token => token.group === 'border')).toBe(true)
    expect(result.colors.primitives.every(token => token.provenance !== 'declared')).toBe(true)
    expect(result.colors.semantic.every(token => token.provenance === 'observed')).toBe(true)
    expect(result.colors.interactive.every(token => token.provenance === 'observed')).toBe(true)
    expect(result.spacing.map(token => token.value)).toEqual(expect.arrayContaining([8, 12, 24]))
    expect(result.controls.some(token => token.family === 'button')).toBe(true)
    expect(result.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: expect.stringMatching(/^icon-[a-f0-9]{6}$/),
        nameSource: 'geometry',
        occurrences: 3,
        stateOccurrences: 3
      })
    ]))
    expect(JSON.stringify(result.icons)).not.toContain('search-chats')
    expect(result.candidates).toContainEqual({
      target: 'navigate',
      url: 'https://example.com/plugins',
      risk: 'safe'
    })
    expect(result.candidates).toContainEqual({
      target: 'navigate',
      url: 'https://example.com/projects',
      risk: 'safe'
    })
    expect(result.filtered.brandAssets).toBe(2)
    expect(result.filtered.personalTextNodes).toBeGreaterThan(0)
    expect(serialized).not.toContain('Private')
    expect(serialized).not.toContain('logo.png')
    expect(serialized).not.toContain('Private project')
    expect(serialized).toContain('Open sidebar')
  })

  it('applies bounded vertical sampling inside each reversible state', async () => {
    const dom = new JSDOM(`
      <button aria-expanded="false" aria-controls="panel">Open panel</button>
      <section
        id="panel"
        hidden
        role="dialog"
        style="overflow-y:auto;box-shadow:0 7px 19px rgba(0,0,0,.25)"
      >Panel</section>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 40,
      top: 0, right: 200, bottom: 40, left: 0, toJSON: () => ({})
    })
    const button = dom.window.document.querySelector('button')!
    const panel = dom.window.document.querySelector<HTMLElement>('#panel')!
    Object.defineProperties(panel, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 }
    })
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true'
      button.setAttribute('aria-expanded', String(open))
      panel.toggleAttribute('hidden', !open)
    })

    const result = await inspectDocument(dom.window.document)
    const panelShadow = result.shadows.find(token => token.layers[0]?.blur === 19)

    expect(result.revealedStates).toBe(1)
    expect(panelShadow?.occurrences).toBe(3)
    expect(panel.scrollTop).toBe(0)
  })

  it('registers only one listener when the bundle is injected twice in one document', () => {
    const dom = new JSDOM('<p>Page</p>', { url: 'https://example.com/' })
    const addListener = vi.fn()
    const marker: Record<string, unknown> = {}
    const runtime = { onMessage: { addListener } }

    expect(registerInspectionListener(runtime, dom.window.document, marker)).toBe(true)
    expect(registerInspectionListener(runtime, dom.window.document, marker)).toBe(false)
    expect(addListener).toHaveBeenCalledOnce()
  })

  it('sends only the fixed recovery-abort code when interaction restoration fails', async () => {
    const dom = new JSDOM('<p>Page</p>', {
      url: 'https://example.com/private/repository?token=secret'
    })
    let listener: ((
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void
    ) => boolean) | undefined
    const runtime = {
      onMessage: {
        addListener(value: typeof listener) {
          listener = value
        }
      }
    }
    const privateFailure = Object.assign(
      new Error('Could not restore #private-menu at /private/repository?token=secret'),
      {
        code: 'interaction-restore-abort',
        domId: 'private-menu'
      }
    )
    Object.defineProperty(dom.window.performance, 'getEntriesByType', {
      configurable: true,
      value: () => { throw privateFailure }
    })

    registerInspectionListener(
      runtime,
      dom.window.document,
      {}
    )
    const response = await new Promise<unknown>(resolve => {
      expect(listener?.({ type: 'INSPECT_PAGE' }, {}, resolve)).toBe(true)
    })

    expect(response).toEqual({
      ok: false,
      code: 'interaction-restore-abort',
      reason: 'unknown'
    })
    expect(JSON.stringify(response)).not.toContain('private')
    expect(JSON.stringify(response)).not.toContain('token')
    expect(JSON.stringify(response)).not.toContain('domId')
  })

  it('upgrades a declared primitive to observed when a safe reveal actually uses it', async () => {
    const dom = new JSDOM(`<!doctype html><html><head><style>
      :root { --surface-primary: #ffffff; }
    </style></head><body>
      <button aria-expanded="false" aria-controls="panel">Open panel</button>
      <section id="panel" hidden style="background:#ffffff">Panel</section>
    </body></html>`, { url: 'https://example.com/', pretendToBeVisual: true })
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 100, height: 20,
      top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({})
    })
    const button = dom.window.document.querySelector('button')!
    const panel = dom.window.document.querySelector('section')!
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true'
      button.setAttribute('aria-expanded', String(open))
      panel.toggleAttribute('hidden', !open)
    })

    const result = await inspectDocument(dom.window.document)
    const white = result.colors.primitives.find(token => token.value.r === 1 && token.value.g === 1 && token.value.b === 1)
    expect(white?.provenance).toBe('observed')
  })
})
