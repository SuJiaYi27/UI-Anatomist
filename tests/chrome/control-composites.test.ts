import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import {
  collectControlCompositePedigree,
  collectControlComposites
} from '../../src/chrome/content/control-composites'
import { createCompositeDiagnosticRecorder } from '../../src/chrome/content/composite-diagnostics'
import {
  createStaticStructureDiagnosticRecorder,
  staticPrivacyBlockedWithinParent,
  type StaticStructureDiagnosticRecorder
} from '../../src/chrome/content/static-structure-diagnostics'
import { collectControlsWithObservations } from '../../src/chrome/content/controls'
import { createControlStateNormalizer } from '../../src/chrome/content/index'
import { collectTypography } from '../../src/chrome/content/typography'
import {
  HOVER_PROBE_ATTRIBUTE,
  HOVER_TARGET_ATTRIBUTE
} from '../../src/chrome/content/hover-state-explorer'

function rect(width: number, height: number, x = 0, y = 0): DOMRect {
  return {
    x, y, width, height, top: y, right: x + width, bottom: y + height, left: x,
    toJSON: () => ({})
  }
}

describe('collectControlComposites', () => {
  it('shares one List pedigree between selected normalization and final Composite children', async () => {
    const dom = new JSDOM(`
      <section role="dialog" data-smart-scan-transient-structure="true" style="display:block;width:320px;height:320px;background:white">
        <button id="header" style="width:280px;height:32px">Header</button>
        <div id="list" role="listbox" style="width:320px;height:192px">
          <div role="button" id="first" style="width:288px;height:48px">First</div>
          <div role="button" id="target" style="width:288px;height:48px;background:rgb(230,230,230)">Target <div role="button" id="nested" style="width:24px;height:24px;background:rgb(230,230,230)">Action</div></div>
          <div role="button" id="third" style="width:288px;height:48px">Third</div>
        </div>
        <input id="search" placeholder="Search" style="width:288px;height:48px">
        <button id="community" style="width:280px;height:32px">Community</button>
      </section>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const element = (id: string) => document.getElementById(id) as HTMLElement
    const panel = document.querySelector<HTMLElement>('section')!
    panel.getBoundingClientRect = () => rect(320, 320)
    element('header').getBoundingClientRect = () => rect(280, 32, 16, 0)
    element('list').getBoundingClientRect = () => rect(320, 192, 0, 40)
    element('first').getBoundingClientRect = () => rect(288, 48, 16, 40)
    element('target').getBoundingClientRect = () => rect(288, 48, 16, 88)
    element('nested').getBoundingClientRect = () => rect(24, 24, 264, 100)
    element('third').getBoundingClientRect = () => rect(288, 48, 16, 136)
    element('search').getBoundingClientRect = () => rect(288, 48, 16, 240)
    element('community').getBoundingClientRect = () => rect(280, 32, 16, 288)

    const raw = await collectControlsWithObservations(document)
    const pedigree = await collectControlCompositePedigree(document, raw.observations)
    const normalized = await createControlStateNormalizer()(raw, pedigree)
    const composites = await collectControlComposites(document, normalized.observations, { pedigree })
    const list = composites.find(composite => composite.kind === 'list')!
    const rawTarget = raw.observations.find(observation =>
      observation.ownership.interaction === element('target')
    )!
    const target = normalized.observations.find(observation =>
      observation.ownership.interaction === element('target')
    )!

    const directPeers = pedigree.directOptionsByObservation.get(rawTarget)!
    expect(directPeers.map(observation => observation.ownership.interaction)).toEqual(
      expect.arrayContaining([element('first'), element('target'), element('third')])
    )
    expect(directPeers).toHaveLength(3)
    const peerInteractions = directPeers.map(observation => observation.ownership.interaction)
    expect(peerInteractions).not.toContain(element('nested'))
    expect(peerInteractions).not.toContain(element('header'))
    expect(peerInteractions).not.toContain(element('search'))
    expect(peerInteractions).not.toContain(element('community'))
    expect(list.children.filter(child => child.kind === 'control')).toHaveLength(3)
    const listEntry = pedigree.entries.find(entry => entry.candidate.element === element('list'))!
    const finalInteractions = list.children
      .filter((child): child is Extract<typeof child, { kind: 'control' }> => child.kind === 'control')
      .map(child => normalized.observations.find(observation =>
        observation.token.id === child.controlId &&
        (observation.token.instanceId ?? observation.token.id) === child.instanceId &&
        observation.token.state === child.state
      )?.ownership.interaction)
    expect(finalInteractions).toEqual(listEntry.directControlInteractions)
    expect(target.token.state).toBe('selected')
  })

  it('fails closed when a supplied raw pedigree did not accept a later Composite candidate', async () => {
    const dom = new JSDOM(`
      <section data-smart-scan-transient-structure="true" style="display:block;width:320px;height:160px;background:white">
        <div id="list" role="listbox" style="width:320px;height:120px">
          <button id="first" style="width:288px;height:48px">First</button>
          <button id="second" style="width:288px;height:48px">Second</button>
        </div>
      </section>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const panel = document.querySelector<HTMLElement>('section')!
    const list = document.querySelector<HTMLElement>('#list')!
    const first = document.querySelector<HTMLElement>('#first')!
    const second = document.querySelector<HTMLElement>('#second')!
    panel.getBoundingClientRect = () => rect(320, 160)
    list.getBoundingClientRect = () => rect(320, 120)
    first.getBoundingClientRect = () => rect(288, 48, 16, 0)
    second.getBoundingClientRect = () => rect(288, 48, 16, 48)

    const collected = await collectControlsWithObservations(document)
    const pedigree = await collectControlCompositePedigree(document, collected.observations)
    expect(pedigree.entries.length).toBeGreaterThan(0)

    // This models a candidate that was not accepted by the pre-normalization
    // structural pass. The final materializer must not rediscover it from the
    // later DOM/observation input.
    const composites = await collectControlComposites(document, collected.observations, {
      pedigree: { ...pedigree, entries: [] }
    })

    expect(composites).toEqual([])
  })

  it('adds an eligible header region ahead of list and search without creating a Control', async () => {
    const dom = new JSDOM(`
      <section role="dialog" data-smart-scan-transient-structure="true" style="display:block;width:309px;height:577px;background:white;border-radius:16px">
        <div style="height:59px;padding:20px 24px;border-bottom:1px solid rgb(0 0 0 / 0.1)"><span style="font-size:18px;font-weight:500;line-height:18px">Safe menu title</span></div>
        <div role="listbox" style="width:309px;height:437px"><button style="width:277px;height:48px">First</button><button style="width:277px;height:48px">Second</button></div>
        <div role="group" style="width:309px;height:81px;padding:16px;background:white;border-top:1px solid rgb(220,220,220)"><input placeholder="Search" style="width:277px;height:48px;padding:12px 16px;border:1px solid rgb(220,220,220);border-radius:24px;background:rgb(240,240,240)"></div>
      </section>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const panel = document.querySelector<HTMLElement>('section')!
    const header = panel.children.item(0) as HTMLElement
    const title = header.children.item(0) as HTMLElement
    const list = panel.children.item(1) as HTMLElement
    const group = panel.children.item(2) as HTMLElement
    const [first, second] = Array.from(list.children) as HTMLElement[]
    const search = group.children.item(0) as HTMLElement
    panel.getBoundingClientRect = () => rect(309, 577)
    header.getBoundingClientRect = () => rect(309, 59)
    title.getBoundingClientRect = () => rect(261, 18, 24, 20)
    list.getBoundingClientRect = () => rect(309, 437, 0, 59)
    first!.getBoundingClientRect = () => rect(277, 48, 16, 75)
    second!.getBoundingClientRect = () => rect(277, 48, 16, 123)
    group.getBoundingClientRect = () => rect(309, 81, 0, 496)
    search.getBoundingClientRect = () => rect(277, 48, 16, 513)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations, {
      typography: await collectTypography(document)
    })
    const parent = composites.find(composite => composite.geometry.height === 577)

    expect(parent?.children).toMatchObject([
      {
        kind: 'static-text-region',
        placement: { x: 0, y: 0, width: 309, height: 59 },
        geometry: { padding: { top: 20, right: 24, bottom: 20, left: 24 } },
        text: { source: 'visible-static-ui', placement: { x: 24, y: 20, width: 261, height: 18 } }
      },
      { kind: 'composite', placement: { x: 0, y: 59, width: 309, height: 437 } },
      { kind: 'composite', placement: { x: 0, y: 496, width: 309, height: 81 } }
    ])
    expect(parent?.geometry.padding.top).toBe(0)
    expect(collected.controls.some(control => control.sampleText?.value === 'Safe menu title')).toBe(false)
  })

  it('emits an anonymous top-band trace without exporting static text or DOM identity', async () => {
    const dom = new JSDOM(`
      <section id="private-panel" role="dialog" data-smart-scan-transient-structure="true" style="
        display:block;width:309px;height:577px;background:white;border-radius:16px
      ">
        <div id="private-header" style="height:59px;border-bottom:1px solid rgb(220,220,220)">
          <span id="private-label" style="font-size:18px;line-height:18px">Short static label</span>
        </div>
        <div id="list" role="listbox" style="width:309px;height:437px">
          <button id="first" style="width:277px;height:48px">First</button>
          <button id="second" style="width:277px;height:48px">Second</button>
        </div>
        <div id="private-search-group" role="group" style="
          width:309px;height:81px;padding:16px;background:white;border-top:1px solid rgb(220,220,220)
        ">
          <input id="search" placeholder="Search" style="
            width:277px;height:48px;padding:12px 16px;border:1px solid rgb(220,220,220);
            border-radius:24px;background:rgb(240,240,240)
          ">
        </div>
      </section>
    `, { pretendToBeVisual: true, url: 'https://example.com/private/path?secret=yes' })
    const document = dom.window.document
    document.getElementById('private-panel')!.getBoundingClientRect = () => rect(309, 577)
    document.getElementById('private-header')!.getBoundingClientRect = () => rect(309, 59)
    document.getElementById('private-label')!.getBoundingClientRect = () => rect(120, 18, 16, 20)
    document.getElementById('list')!.getBoundingClientRect = () => rect(309, 437, 0, 59)
    document.getElementById('first')!.getBoundingClientRect = () => rect(277, 48, 16, 75)
    document.getElementById('second')!.getBoundingClientRect = () => rect(277, 48, 16, 123)
    document.getElementById('private-search-group')!.getBoundingClientRect = () => rect(309, 81, 0, 496)
    document.getElementById('search')!.getBoundingClientRect = () => rect(277, 48, 16, 513)
    const parent = {
      logicalCompositeId: 'sha256:' + '0'.repeat(64),
      geometry: { height: 577 },
      children: [
        { kind: 'composite', placement: { x: 0, y: 59, width: 309, height: 437 } },
        { kind: 'composite', placement: { x: 0, y: 496, width: 309, height: 81 } }
      ]
    } as never
    const recorder = createStaticStructureDiagnosticRecorder()
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    recorder.record(document.getElementById('private-panel')!, parent)
    await recorder.finalize()

    expect(output).toHaveBeenCalledTimes(1)
    const trace = JSON.parse(String(output.mock.calls[0]![0]))
    expect(trace).toMatchObject({
      kind: 'static-structure-trace-v1',
      candidateId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      parent: { width: 309, height: 577 },
      uncoveredTopBand: { x: 0, y: 0, width: 309, height: 59 },
      staticText: expect.arrayContaining([expect.objectContaining({
        nodeId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        placement: { x: 16, y: 20, width: 120, height: 18 },
        textLengthBucket: '9-24',
        wrapper: expect.objectContaining({
          borderWidths: expect.objectContaining({ bottom: 1 })
        })
      })]),
      separators: expect.arrayContaining([expect.objectContaining({
        source: 'wrapper-border-bottom', thickness: 1, crossesTitleListBoundary: true
      })])
    })
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain('Short static label')
    expect(serialized).not.toContain('private-header')
    expect(serialized).not.toContain('example.com')
    output.mockRestore()
  })

  it('keeps global location privacy outside the parent without blocking a static title', async () => {
    const dom = new JSDOM(`
      <div>
        <span>based on your IP address</span>
        <section role="dialog" data-smart-scan-transient-structure="true" style="display:block;width:309px;height:577px;background:white;border-radius:16px">
          <div style="height:59px;border-bottom:1px solid rgb(220,220,220)"><span style="font-size:18px;line-height:18px">Safe static title</span></div>
          <div role="listbox" style="width:309px;height:437px"><button style="width:277px;height:48px">First</button><button style="width:277px;height:48px">Second</button></div>
          <div role="group" style="width:309px;height:81px;padding:16px;background:white;border-top:1px solid rgb(220,220,220)"><input placeholder="Search" style="width:277px;height:48px;padding:12px 16px;border:1px solid rgb(220,220,220);border-radius:24px;background:rgb(240,240,240)"></div>
        </section>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const panel = document.querySelector<HTMLElement>('section')!
    const header = panel.children.item(0) as HTMLElement
    const list = panel.children.item(1) as HTMLElement
    const group = panel.children.item(2) as HTMLElement
    const label = header.children.item(0) as HTMLElement
    const first = list.children.item(0) as HTMLElement
    const second = list.children.item(1) as HTMLElement
    const search = group.children.item(0) as HTMLElement
    panel.getBoundingClientRect = () => rect(309, 577)
    header.getBoundingClientRect = () => rect(309, 59)
    label.getBoundingClientRect = () => rect(120, 18, 24, 20)
    list.getBoundingClientRect = () => rect(309, 437, 0, 59)
    first.getBoundingClientRect = () => rect(277, 48, 16, 75)
    second.getBoundingClientRect = () => rect(277, 48, 16, 123)
    group.getBoundingClientRect = () => rect(309, 81, 0, 496)
    search.getBoundingClientRect = () => rect(277, 48, 16, 513)
    const parent = {
      logicalCompositeId: 'sha256:' + '0'.repeat(64),
      geometry: { height: 577 },
      children: [
        { kind: 'composite', placement: { x: 0, y: 59, width: 309, height: 437 } },
        { kind: 'composite', placement: { x: 0, y: 496, width: 309, height: 81 } }
      ]
    } as never
    const recorder = createStaticStructureDiagnosticRecorder()
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    recorder.record(panel, parent)
    await recorder.finalize()

    const trace = JSON.parse(String(output.mock.calls[0]![0]))
    expect(trace.staticText[0]).toMatchObject({
      contexts: { privateOrIdentity: true },
      privacyProvenance: {
        reasons: { locationCluster: true },
        sources: { locationCluster: { scope: 'outside-parent', depthBucket: '3-4' } }
      },
      strictSafeStaticUiCopyEligible: true
    })
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain('Safe static title')
    expect(serialized).not.toContain('based on your IP address')
    output.mockRestore()
  })

  it('keeps a header-local profile context inside the transient parent blocked', async () => {
    const dom = new JSDOM(`
      <section role="dialog" data-smart-scan-transient-structure="true" style="display:block;width:309px;height:577px;background:white">
        <div data-testid="profile-header" style="height:59px;border-bottom:1px solid rgb(220,220,220)"><span style="font-size:18px;line-height:18px">Safe static title</span></div>
        <div role="listbox" style="width:309px;height:437px"><button style="width:277px;height:48px">First</button><button style="width:277px;height:48px">Second</button></div>
        <div role="group" style="width:309px;height:81px"><input placeholder="Search" style="width:277px;height:48px"></div>
      </section>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const panel = document.querySelector<HTMLElement>('section')!
    const header = panel.children.item(0) as HTMLElement
    const list = panel.children.item(1) as HTMLElement
    const group = panel.children.item(2) as HTMLElement
    const label = header.children.item(0) as HTMLElement
    const first = list.children.item(0) as HTMLElement
    const second = list.children.item(1) as HTMLElement
    const search = group.children.item(0) as HTMLElement
    panel.getBoundingClientRect = () => rect(309, 577)
    header.getBoundingClientRect = () => rect(309, 59)
    label.getBoundingClientRect = () => rect(120, 18, 24, 20)
    list.getBoundingClientRect = () => rect(309, 437, 0, 59)
    first.getBoundingClientRect = () => rect(277, 48, 16, 75)
    second.getBoundingClientRect = () => rect(277, 48, 16, 123)
    group.getBoundingClientRect = () => rect(309, 81, 0, 496)
    search.getBoundingClientRect = () => rect(277, 48, 16, 513)
    const parent = {
      logicalCompositeId: 'sha256:' + '1'.repeat(64),
      geometry: { height: 577 },
      children: [
        { kind: 'composite', placement: { x: 0, y: 59, width: 309, height: 437 } },
        { kind: 'composite', placement: { x: 0, y: 496, width: 309, height: 81 } }
      ]
    } as never
    const recorder = createStaticStructureDiagnosticRecorder()
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    recorder.record(panel, parent)
    await recorder.finalize()

    const trace = JSON.parse(String(output.mock.calls[0]![0]))
    expect(trace.staticText[0]).toMatchObject({
      contexts: { privateOrIdentity: true },
      privacyProvenance: {
        reasons: { selectorAncestor: true },
        sources: { selectorAncestor: { scope: 'wrapper' } }
      },
      strictSafeStaticUiCopyEligible: false
    })
    expect(JSON.stringify(trace)).not.toContain('profile-header')
    output.mockRestore()
  })

  it('fails closed for unmatched, exceptional, and mixed-scope privacy evidence', () => {
    const dom = new JSDOM('<div id="outside"><section id="parent"><div id="header"></div></section></div>')
    const document = dom.window.document
    const parent = document.getElementById('parent')!
    const outside = document.getElementById('outside')!
    const header = document.getElementById('header')!
    const reasons = {
      selectorAncestor: false,
      opaquePath: false,
      entityCluster: false,
      locationCluster: true,
      exception: false
    }

    expect(staticPrivacyBlockedWithinParent({
      blocked: true,
      reasons,
      matches: {}
    }, parent)).toBe(true)
    expect(staticPrivacyBlockedWithinParent({
      blocked: true,
      reasons: { ...reasons, exception: true },
      matches: { locationCluster: [outside] }
    }, parent)).toBe(true)
    expect(staticPrivacyBlockedWithinParent({
      blocked: true,
      reasons: { ...reasons, selectorAncestor: true },
      matches: { locationCluster: [outside], selectorAncestor: [header] }
    }, parent)).toBe(true)
  })

  it('hands a built transient parent with an uncovered top band to the static diagnostic sidecar', async () => {
    const dom = new JSDOM(`
      <section id="panel" role="dialog" style="
        display:block;width:309px;height:577px;background:white;border-radius:16px
      ">
        <div id="header" style="height:59px;border-bottom:1px solid rgb(220,220,220)">
          <span id="label">Short static label</span>
        </div>
        <div id="list" role="listbox" data-smart-scan-transient-structure="true" style="width:309px;height:437px">
          <button id="first" style="width:277px;height:48px">First</button>
          <button id="second" style="width:277px;height:48px">Second</button>
        </div>
        <div id="search-group" role="group" style="
          width:309px;height:81px;padding:16px;background:white;border-top:1px solid rgb(220,220,220)
        ">
          <input id="search" placeholder="Search" style="
            width:277px;height:48px;padding:12px 16px;border:1px solid rgb(220,220,220);
            border-radius:24px;background:rgb(240,240,240)
          ">
        </div>
      </section>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('panel')!.getBoundingClientRect = () => rect(309, 577)
    document.getElementById('header')!.getBoundingClientRect = () => rect(309, 59)
    document.getElementById('label')!.getBoundingClientRect = () => rect(120, 18, 16, 20)
    document.getElementById('list')!.getBoundingClientRect = () => rect(309, 437, 0, 59)
    document.getElementById('first')!.getBoundingClientRect = () => rect(277, 48, 16, 75)
    document.getElementById('second')!.getBoundingClientRect = () => rect(277, 48, 16, 123)
    document.getElementById('search-group')!.getBoundingClientRect = () => rect(309, 81, 0, 496)
    document.getElementById('search')!.getBoundingClientRect = () => rect(277, 48, 16, 513)
    const handedOff: Array<{ element: HTMLElement; token: { geometry: { height: number } } }> = []
    const staticDiagnostics: StaticStructureDiagnosticRecorder = {
      record(element, token) {
        if (token.children.filter(child => child.kind === 'composite').length >= 2) {
          handedOff.push({ element, token })
        }
      },
      async finalize() {}
    }

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations, {
      staticDiagnostics
    })

    expect(composites).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'popover',
        geometry: expect.objectContaining({ height: 577 })
      })
    ]))
    expect(handedOff).toHaveLength(1)
    expect(handedOff[0]).toMatchObject({
      element: document.getElementById('panel'),
      token: { geometry: { height: 577 } }
    })
    expect(JSON.stringify(composites)).not.toContain('Short static label')
  })

  it('records a transient descendant panel when its nested list leaves it unbuildable', async () => {
    const dom = new JSDOM(`
      <section id="panel" style="
        position:absolute;width:320px;height:576px;background:white;border-radius:16px
      ">
        <div id="header" style="height:96px"></div>
        <div id="list" role="listbox" data-smart-scan-transient-structure="true" style="
          display:flex;flex-direction:column;width:320px;height:384px;overflow-y:auto
        ">
          <button id="first" style="width:304px;height:48px">First</button>
          <button id="second" style="width:304px;height:48px">Second</button>
        </div>
        <div id="footer" style="width:288px;height:40px"></div>
      </section>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('panel')!.getBoundingClientRect = () => rect(320, 576)
    document.getElementById('header')!.getBoundingClientRect = () => rect(320, 96)
    document.getElementById('list')!.getBoundingClientRect = () => rect(320, 384, 0, 96)
    document.getElementById('first')!.getBoundingClientRect = () => rect(304, 48, 8, 104)
    document.getElementById('second')!.getBoundingClientRect = () => rect(304, 48, 8, 152)
    document.getElementById('footer')!.getBoundingClientRect = () => rect(288, 40, 16, 520)
    const collected = await collectControlsWithObservations(document)
    const diagnostics = createCompositeDiagnosticRecorder(document)

    const composites = await collectControlComposites(document, collected.observations, {
      diagnostics
    })
    const rows = await diagnostics.finalize()

    expect(composites).toHaveLength(1)
    expect(composites[0]).toMatchObject({
      kind: 'list',
      geometry: { width: 320, height: 384 }
    })
    expect(rows).toContainEqual(expect.objectContaining({
      candidateId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      controlIds: expect.arrayContaining([
        collected.controls.find(control => control.family === 'button')!.id
      ]),
      reason: 'build-rejected',
      occurrences: 1
    }))
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain('First')
    expect(serialized).not.toContain('panel')
    expect(serialized).not.toContain('example.com')
  })

  it('records an anonymous reason when a control-owning holder candidate is rejected', async () => {
    const dom = new JSDOM(`
      <div id="private-holder" data-smart-scan-transient-owner="sha256:${'7'.repeat(64)}">
        <button id="action" style="width:240px;height:40px">Private action copy</button>
      </div>
      <div id="ordinary-holder">
        <button id="ordinary-action" style="width:240px;height:36px">Ordinary action copy</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/private/page?secret=yes' })
    const document = dom.window.document
    document.getElementById('private-holder')!.getBoundingClientRect = () => rect(256, 56)
    document.getElementById('action')!.getBoundingClientRect = () => rect(240, 40, 8, 8)
    document.getElementById('ordinary-holder')!.getBoundingClientRect = () => rect(256, 52, 0, 80)
    document.getElementById('ordinary-action')!.getBoundingClientRect = () => rect(240, 36, 8, 88)
    const collected = await collectControlsWithObservations(document)
    const diagnostics = createCompositeDiagnosticRecorder(document)

    expect(await collectControlComposites(document, collected.observations, {
      diagnostics
    })).toEqual([])
    const rows = await diagnostics.finalize()

    expect(rows).toContainEqual(expect.objectContaining({
      candidateId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      pageId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      controlIds: [collected.controls[0]!.id],
      reason: 'no-semantic-or-surface',
      occurrences: 1
    }))
    const ordinaryId = collected.observations.find(item =>
      item.ownership.interaction.id === 'ordinary-action'
    )!.token.id
    expect(rows.flatMap(row => row.controlIds)).not.toContain(ordinaryId)
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain('Private action copy')
    expect(serialized).not.toContain('private-holder')
    expect(serialized).not.toContain('/private/page')
    expect(serialized).not.toContain('secret=yes')
  })

  it('keeps portal composites separate through their anonymous transient owner', async () => {
    const collect = async (owner: string) => {
      const dom = new JSDOM(`
        <div role="menu" data-smart-scan-transient-owner="${owner}"
          style="display:flex;flex-direction:column;padding:8px;background:white">
          <button style="height:32px">First action</button>
          <button style="height:32px">Second action</button>
        </div>
      `, { pretendToBeVisual: true, url: 'https://example.com/current' })
      const document = dom.window.document
      document.querySelector<HTMLElement>('[role="menu"]')!.getBoundingClientRect =
        () => rect(240, 80)
      document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
        button.getBoundingClientRect = () => rect(224, 32, 8, 8 + index * 32)
      })
      const collected = await collectControlsWithObservations(document)
      return (await collectControlComposites(document, collected.observations))[0]!
    }

    const first = await collect(`sha256:${'1'.repeat(64)}`)
    const second = await collect(`sha256:${'2'.repeat(64)}`)

    expect(first.logicalCompositeId).not.toBe(second.logicalCompositeId)
    expect(JSON.stringify([first, second])).not.toContain('data-smart-scan-transient-owner')
  })

  it('uses a descendant transient owner to separate painted shells around portal menus', async () => {
    const collect = async (owner: string) => {
      const dom = new JSDOM(`
        <div id="shell" data-smart-scan-transient-owner="${owner}" style="
          display:block;position:absolute;width:240px;height:96px;
          background:white;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12)
        ">
          <div id="menu" role="menu" data-smart-scan-transient-owner="${owner}"
            style="display:flex;flex-direction:column;width:240px;height:96px;padding:8px">
            <button style="width:224px;height:40px">First action</button>
            <button style="width:224px;height:40px">Second action</button>
          </div>
        </div>
      `, { pretendToBeVisual: true, url: 'https://example.com/current' })
      const document = dom.window.document
      document.getElementById('shell')!.getBoundingClientRect = () => rect(240, 96)
      document.getElementById('menu')!.getBoundingClientRect = () => rect(240, 96)
      document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
        button.getBoundingClientRect = () => rect(224, 40, 8, 8 + index * 40)
      })
      const collected = await collectControlsWithObservations(document)
      return (await collectControlComposites(document, collected.observations))
        .find(composite => composite.kind === 'popover')!
    }

    const first = await collect(`sha256:${'1'.repeat(64)}`)
    const second = await collect(`sha256:${'2'.repeat(64)}`)

    expect(first.logicalCompositeId).not.toBe(second.logicalCompositeId)
    expect(JSON.stringify([first, second])).not.toContain('data-smart-scan-transient-owner')
  })

  it('keeps a bounded scrollable collection with more than twelve atomic rows', async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      `<div role="menuitem" tabindex="0" style="height:40px;padding:8px 12px">Row ${index + 1}</div>`
    ).join('')
    const dom = new JSDOM(`
      <div id="collection" role="menu" style="
        display:flex;flex-direction:column;width:320px;height:480px;
        overflow-y:auto;padding:8px;background:white;border-radius:12px
      ">${rows}</div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const collection = document.querySelector<HTMLElement>('#collection')!
    collection.getBoundingClientRect = () => rect(320, 480)
    Object.defineProperties(collection, {
      clientHeight: { configurable: true, value: 480 },
      scrollHeight: { configurable: true, value: 2416 }
    })
    document.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach((row, index) => {
      row.getBoundingClientRect = () => rect(304, 40, 8, 8 + index * 40)
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites).toHaveLength(1)
    expect(composites[0]).toMatchObject({
      kind: 'menu',
      geometry: { width: 320, height: 480 },
      layout: { direction: 'vertical', clipsContent: true }
    })
    expect(composites[0]?.children).toHaveLength(60)
  })

  it('captures one painted vertical menu with ordered atomic references', async () => {
    const dom = new JSDOM(`
      <div id="private-menu-id" role="menu" style="
        display:flex;flex-direction:column;gap:4px;padding:8px;
        border-radius:12px;background:rgb(250,250,250)
      ">
        <button style="height:40px">Create an image</button>
        <button style="height:40px">Write or edit</button>
        <button style="height:40px">Search the web</button>
      </div>
    `, { url: 'https://example.com/private-route', pretendToBeVisual: true })
    const menu = dom.window.document.querySelector<HTMLElement>('[role="menu"]')!
    menu.getBoundingClientRect = () => rect(240, 144)
    dom.window.document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => rect(224, 40, 8, 8 + index * 44)
    })

    const collected = await collectControlsWithObservations(dom.window.document)
    const composites = await collectControlComposites(
      dom.window.document,
      collected.observations
    )

    expect(composites).toHaveLength(1)
    expect(composites[0]).toMatchObject({
      kind: 'menu',
      geometry: {
        width: 240,
        height: 144,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 4,
        radius: 12
      },
      layout: { direction: 'vertical' },
      children: [
        { kind: 'control', placement: { x: 8, y: 8, width: 224, height: 40 } },
        { kind: 'control', placement: { x: 8, y: 52, width: 224, height: 40 } },
        { kind: 'control', placement: { x: 8, y: 96, width: 224, height: 40 } }
      ]
    })
    expect(JSON.stringify(composites)).not.toMatch(/private-menu-id|private-route/i)
  })

  it('keeps canonical DOM child order when viewport placement order differs', async () => {
    const dom = new JSDOM(`
      <div role="menu" style="display:flex;flex-direction:column;padding:8px;background:white">
        <button id="canonical-first" style="width:224px;height:32px">Canonical first</button>
        <button id="canonical-second" style="width:224px;height:32px">Canonical second</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    const first = document.querySelector<HTMLElement>('#canonical-first')!
    const second = document.querySelector<HTMLElement>('#canonical-second')!
    menu.getBoundingClientRect = () => rect(240, 80)
    // Simulate a scrolled/partial viewport where the later DOM row is painted above the first.
    first.getBoundingClientRect = () => rect(224, 32, 8, 40)
    second.getBoundingClientRect = () => rect(224, 32, 8, 8)

    const collected = await collectControlsWithObservations(document)
    const firstInstance = collected.observations.find(observation =>
      observation.ownership.interaction === first
    )?.token.instanceId
    const secondInstance = collected.observations.find(observation =>
      observation.ownership.interaction === second
    )?.token.instanceId
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites).toHaveLength(1)
    expect(composites[0]?.children.map(child =>
      child.kind === 'control' ? child.instanceId : null
    )).toEqual([firstInstance, secondInstance])
    expect(composites[0]?.children.map(child => child.placement?.y)).toEqual([40, 8])
  })

  it('keeps a child hover on the child instead of relabeling the whole composite', async () => {
    const dom = new JSDOM(`
      <div role="menu" style="display:flex;flex-direction:column;padding:8px;background:white">
        <button id="first" style="width:224px;height:32px">First action</button>
        <button id="second" style="width:224px;height:32px">Second action</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    const first = document.querySelector<HTMLElement>('#first')!
    const second = document.querySelector<HTMLElement>('#second')!
    menu.getBoundingClientRect = () => rect(240, 80)
    first.getBoundingClientRect = () => rect(224, 32, 8, 8)
    second.getBoundingClientRect = () => rect(224, 32, 8, 40)
    second.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites).toHaveLength(1)
    expect(composites[0]?.state).toBe('default')
    expect(composites[0]?.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'control', state: 'hover' })
    ]))
  })

  it('keeps an explicit composite state ahead of a child hover state', async () => {
    const dom = new JSDOM(`
      <div role="menu" aria-expanded="true"
        style="display:flex;flex-direction:column;padding:8px;background:white">
        <button id="first" style="width:224px;height:32px">First action</button>
        <button id="second" style="width:224px;height:32px">Second action</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('[role="menu"]')!.getBoundingClientRect =
      () => rect(240, 80)
    document.querySelector<HTMLElement>('#first')!.getBoundingClientRect =
      () => rect(224, 32, 8, 8)
    const second = document.querySelector<HTMLElement>('#second')!
    second.getBoundingClientRect = () => rect(224, 32, 8, 40)
    second.setAttribute(HOVER_TARGET_ATTRIBUTE, 'true')

    document.querySelector<HTMLElement>('[role="menu"]')!
      .setAttribute(HOVER_PROBE_ATTRIBUTE, 'true')

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites[0]?.state).toBe('expanded')
  })

  it('uses semantic vertical flow for a non-flex menu', async () => {
    const dom = new JSDOM(`
      <div role="menu" style="display:block;padding:8px;background:white">
        <button style="height:40px">First action</button>
        <button style="height:40px">Second action</button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    document.querySelector<HTMLElement>('[role="menu"]')!.getBoundingClientRect =
      () => rect(240, 104)
    document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => rect(224, 40, 8, 8 + index * 44)
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites[0]?.layout.direction).toBe('vertical')
  })

  it('uses unambiguous child geometry to correct CSS direction and normal alignment', async () => {
    const dom = new JSDOM(`
      <div id="stack" role="list" style="
        display:flex;flex-direction:row;align-items:normal;
        width:400px;height:113px;padding:8px;
        border-top:1px solid rgb(208,215,222);background:white
      ">
        <button id="first" style="width:180px;height:40px">First action</button>
        <button id="second" style="width:180px;height:40px">Second action</button>
      </div>
      <div id="row" role="list" style="
        display:flex;flex-direction:row;width:400px;height:56px;padding:8px;background:white
      ">
        <button id="left" style="width:180px;height:40px">Left action</button>
        <button id="right" style="width:180px;height:40px">Right action</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      stack: rect(400, 113),
      first: rect(180, 40, 8, 8),
      second: rect(180, 40, 8, 64),
      row: rect(400, 56, 0, 140),
      left: rect(180, 40, 8, 148),
      right: rect(180, 40, 212, 148)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const stack = composites.find(composite => composite.geometry.height === 113)
    const row = composites.find(composite => composite.geometry.height === 56)

    expect(stack?.layout).toMatchObject({ direction: 'vertical', align: 'stretch' })
    expect(row?.layout.direction).toBe('horizontal')
  })

  it('does not override CSS direction when child geometry wraps across both axes', async () => {
    const dom = new JSDOM(`
      <div id="wrapped" role="list" style="
        display:flex;flex-direction:row;flex-wrap:wrap;
        width:220px;height:96px;padding:8px;background:white
      ">
        <button id="one" style="width:96px;height:36px">One</button>
        <button id="two" style="width:96px;height:36px">Two</button>
        <button id="three" style="width:96px;height:36px">Three</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      wrapped: rect(220, 96),
      one: rect(96, 36, 8, 8),
      two: rect(96, 36, 116, 8),
      three: rect(96, 36, 8, 52)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites[0]?.layout).toMatchObject({ direction: 'horizontal', wrap: true })
  })

  it('rejects a repeated ultra-wide bare list with compact horizontal inset but keeps equivalent painted evidence', async () => {
    const dom = new JSDOM(`
      <div id="bare" role="list" style="
        display:flex;flex-direction:row;flex-wrap:wrap;width:100%;height:18px;
        padding:0 8px;border:0;background:transparent;overflow:visible
      ">
        <button id="bare-a" style="width:100px;height:18px;padding:0;border:0;background:transparent">Action</button>
        <button id="bare-b" style="width:100px;height:18px;padding:0;border:0;background:transparent">Action</button>
      </div>
      <div id="painted" role="list" style="
        display:flex;flex-direction:row;flex-wrap:wrap;width:100%;height:18px;
        padding:0;border:0;background:rgb(245,245,245);overflow:visible
      ">
        <button id="painted-a" style="width:100px;height:18px;padding:0;border:0;background:transparent">Action</button>
        <button id="painted-b" style="width:100px;height:18px;padding:0;border:0;background:transparent">Action</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      bare: rect(744, 18),
      'bare-a': rect(368, 18, 0, 0),
      'bare-b': rect(368, 18, 368, 0),
      painted: rect(744, 18, 0, 40),
      'painted-a': rect(368, 18, 0, 40),
      'painted-b': rect(368, 18, 368, 40)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites.filter(composite => composite.geometry.width === 744)).toHaveLength(1)
    expect(composites[0]?.appearance.background.a).toBeGreaterThan(0.05)
  })

  it('keeps a marked transient navigation as a bounded anonymous panel', async () => {
    const dom = new JSDOM(`
      <nav id="drawer" data-smart-scan-transient-structure="true" style="
        display:flex;flex-direction:column;width:320px;height:160px;
        padding:16px;gap:8px;background:white
      ">
        <a id="home" href="/home" style="display:flex;width:288px;height:56px;padding:8px">Home</a>
        <a id="projects" href="/projects" style="display:flex;width:288px;height:56px;padding:8px">Projects</a>
      </nav>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.querySelector<HTMLElement>('#drawer')!.getBoundingClientRect =
      () => rect(320, 160)
    document.querySelector<HTMLElement>('#home')!.getBoundingClientRect =
      () => rect(288, 56, 16, 16)
    document.querySelector<HTMLElement>('#projects')!.getBoundingClientRect =
      () => rect(288, 56, 16, 80)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(collected.controls).toHaveLength(2)
    expect(collected.controls.every(control => control.sampleText === undefined)).toBe(true)
    expect(composites).toHaveLength(1)
    expect(composites[0]).toMatchObject({
      kind: 'panel',
      geometry: {
        width: 320,
        height: 160,
        padding: { top: 16, right: 16, bottom: 16, left: 16 }
      },
      layout: { direction: 'vertical', align: 'stretch' }
    })
  })

  it('rejects a narrow semantic shell whose height is unbounded by the viewport', async () => {
    const dom = new JSDOM(`
      <div role="menu" style="display:block;background:white">
        <button style="height:32px">First action</button>
        <button style="height:32px">Second action</button>
        <button style="height:32px">Third action</button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    document.querySelector<HTMLElement>('[role="menu"]')!.getBoundingClientRect =
      () => rect(289, 148864)
    document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => rect(289, 32, 0, index * 32)
    })

    const collected = await collectControlsWithObservations(document)

    expect(await collectControlComposites(document, collected.observations)).toEqual([])
  })

  it('keeps a bounded nested group inside a popover without promoting nested actions', async () => {
    const dom = new JSDOM(`
      <div role="dialog" style="
        display:flex;flex-direction:column;gap:8px;padding:8px;
        border:1px solid rgb(220,220,220);border-radius:16px;background:white
      ">
        <div role="menu" style="display:flex;flex-direction:column;gap:4px">
          <div role="menuitem" tabindex="0" style="height:52px;padding:6px 8px">
            <span>Plus</span><span>More features</span><button>Upgrade</button>
          </div>
          <div role="menuitemradio" aria-checked="true" tabindex="0"
            style="height:52px;padding:6px 8px">
            <span>Default</span><span>Everyday tasks</span>
            <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>
          </div>
        </div>
        <button style="height:36px">Manage</button>
      </div>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    dialog.getBoundingClientRect = () => rect(280, 180)
    menu.getBoundingClientRect = () => rect(264, 108, 8, 8)
    document.querySelectorAll<HTMLElement>('[role^="menuitem"]').forEach((row, index) => {
      row.getBoundingClientRect = () => rect(264, 52, 8, 8 + index * 56)
    })
    document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => index === 0
        ? rect(72, 32, 190, 18)
        : rect(264, 36, 8, 132)
    })
    const icon = document.querySelector<SVGElement>('svg')!
    icon.getBoundingClientRect = () => rect(20, 20, 238, 78)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites.map(composite => composite.kind)).toEqual(['menu', 'popover'])
    expect(composites[0]?.children).toHaveLength(2)
    expect(composites[1]?.children).toEqual([
      expect.objectContaining({
        kind: 'composite',
        compositeId: composites[0]?.id,
        placement: { x: 8, y: 8, width: 264, height: 108 }
      }),
      expect.objectContaining({ kind: 'control' })
    ])
  })

  it('uses child geometry as safe-area evidence when wrappers own the visual inset', async () => {
    const dom = new JSDOM(`
      <div id="popover" role="dialog" style="
        display:flex;flex-direction:column;
        width:320px;height:220px;padding:0;
        border:1px solid rgb(208,215,222);border-radius:12px;background:white
      ">
        <div><button id="close"><svg id="close-icon" viewBox="0 0 16 16"><path d="M2 2l12 12"/></svg></button></div>
        <div><input id="filter" placeholder="Find an item..." style="height:32px;border:1px solid rgb(208,215,222)"/></div>
        <div id="tabs" role="tablist" style="display:flex">
          <button id="first" role="tab">First</button>
          <button id="second" role="tab">Second</button>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      popover: rect(320, 220),
      close: rect(32, 32, 272, 16),
      'close-icon': rect(16, 16, 280, 24),
      filter: rect(288, 32, 16, 64),
      tabs: rect(288, 32, 16, 172),
      first: rect(144, 32, 16, 172),
      second: rect(144, 32, 160, 172)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const popover = composites.find(composite => composite.kind === 'popover')

    expect(popover).toMatchObject({
      geometry: {
        width: 320,
        height: 220,
        padding: { top: 16, right: 16, bottom: 16, left: 16 }
      },
      layout: { direction: 'vertical' }
    })
  })

  it('builds a full composer from a structural textarea and a nested action row', async () => {
    const dom = new JSDOM(`
      <div id="composer" role="group" style="
        width:640px;height:240px;padding:16px;
        display:flex;flex-direction:column;gap:16px;
        border:1px solid rgb(208,215,222);border-radius:16px;background:white
      ">
        <textarea id="prompt" placeholder="Ask anything" style="
          width:608px;height:152px;padding:0;border:0;background:transparent
        "></textarea>
        <div id="actions" role="group" style="display:flex;gap:8px;height:40px">
          <button id="mode" style="width:112px;height:40px">Ask</button>
          <button id="add" style="width:40px;height:40px"><svg id="add-icon" viewBox="0 0 24 24"><path d="M12 4v16"/></svg></button>
          <button id="send" style="width:40px;height:40px"><svg id="send-icon" viewBox="0 0 24 24"><path d="M4 12h16"/></svg></button>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      composer: rect(640, 240),
      prompt: rect(608, 152, 16, 16),
      actions: rect(608, 40, 16, 184),
      mode: rect(112, 40, 16, 184),
      add: rect(40, 40, 136, 184),
      'add-icon': rect(20, 20, 146, 194),
      send: rect(40, 40, 584, 184),
      'send-icon': rect(20, 20, 594, 194)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const actionRow = composites.find(composite =>
      composite.kind === 'control-group' && composite.geometry.height === 40
    )
    const composer = composites.find(composite =>
      composite.kind === 'control-group' && composite.geometry.height === 240
    )

    expect(actionRow).toMatchObject({
      layout: { direction: 'horizontal' },
      children: [{ kind: 'control' }, { kind: 'control' }, { kind: 'control' }]
    })
    expect(composer).toMatchObject({
      geometry: {
        width: 640,
        height: 240,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        gap: 16
      },
      layout: { direction: 'vertical' },
      children: [
        { kind: 'control' },
        { kind: 'composite', compositeId: actionRow?.id }
      ]
    })
  })

  it('preserves a padded single-control footer beside a full-bleed nested list', async () => {
    const dom = new JSDOM(`
      <div id="shell" role="group" style="
        width:320px;height:240px;padding:0;
        display:flex;flex-direction:column;background:white
      ">
        <div id="list" role="list" style="
          width:320px;height:160px;padding:0;
          display:flex;flex-direction:column;background:white
        ">
          <button id="first" style="width:320px;height:80px">First option</button>
          <button id="second" style="width:320px;height:80px">Second option</button>
        </div>
        <div id="footer" style="
          width:320px;height:80px;padding:16px;
          display:block;background:white;
          border-top:1px solid rgb(208,215,222)
        ">
          <input id="filter" placeholder="Filter items" style="
            width:288px;height:48px;padding:12px 16px;border:0;border-radius:24px;
            background:rgb(240,240,240)
          ">
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      shell: rect(320, 240),
      list: rect(320, 160),
      first: rect(320, 80),
      second: rect(320, 80, 0, 80),
      footer: rect(320, 80, 0, 160),
      filter: rect(288, 48, 16, 176)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const list = composites.find(composite => composite.kind === 'list')
    const footer = composites.find(composite =>
      composite.kind === 'control-group' && composite.geometry.height === 80
    )
    const shell = composites.find(composite =>
      composite.kind === 'control-group' && composite.geometry.height === 240
    )

    expect(footer).toMatchObject({
      geometry: {
        width: 320,
        height: 80,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        borderWidth: 1,
        borderWidths: { top: 1, right: 0, bottom: 0, left: 0 }
      },
      children: [{ kind: 'control' }]
    })
    expect(shell?.children).toEqual([
      {
        kind: 'composite',
        compositeId: list?.id,
        placement: { x: 0, y: 0, width: 320, height: 160 }
      },
      {
        kind: 'composite',
        compositeId: footer?.id,
        placement: { x: 0, y: 160, width: 320, height: 80 }
      }
    ])
  })

  it('rejects a padding-only single-control wrapper without structural evidence', async () => {
    const dom = new JSDOM(`
      <div id="wrapper" style="display:flex;padding:16px">
        <input id="field" placeholder="Filter items" style="width:200px;height:40px">
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('wrapper')!.getBoundingClientRect = () => rect(232, 72)
    document.getElementById('field')!.getBoundingClientRect = () => rect(200, 40, 16, 16)

    const collected = await collectControlsWithObservations(document)
    expect(await collectControlComposites(document, collected.observations)).toEqual([])
  })

  it('rejects page-scale content shells that merely contain unrelated controls', async () => {
    const dom = new JSDOM(`
      <main role="main" style="display:flex;background:white">
        <section><button style="height:40px">First action</button></section>
        <article><button style="height:40px">Second action</button></article>
      </main>
    `, { url: 'https://example.com/', pretendToBeVisual: true })
    const document = dom.window.document
    document.querySelector<HTMLElement>('main')!.getBoundingClientRect =
      () => rect(1024, 768)
    document.querySelectorAll<HTMLElement>('section,article').forEach((element, index) => {
      element.getBoundingClientRect = () => rect(480, 720, index * 500, 0)
    })
    document.querySelectorAll<HTMLElement>('button').forEach((button, index) => {
      button.getBoundingClientRect = () => rect(160, 40, index * 500, 20)
    })

    const collected = await collectControlsWithObservations(document)
    expect(await collectControlComposites(document, collected.observations)).toEqual([])
  })

  it('keeps an edge-to-edge painted shell around one nested Composite', async () => {
    const collect = async (painted: boolean) => {
      const dom = new JSDOM(`
        <div id="shell" role="dialog" style="
          display:flex;width:240px;height:80px;padding:0;
          ${painted
            ? 'background:white;border:1px solid rgb(220,220,220);box-shadow:0 4px 12px rgba(0,0,0,.12)'
            : 'background:transparent;border:0;box-shadow:none'}
        ">
          <div id="menu" role="menu" style="
            display:flex;flex-direction:column;width:240px;height:80px;padding:0
          ">
            <button id="first" style="width:240px;height:40px">First action</button>
            <button id="second" style="width:240px;height:40px">Second action</button>
          </div>
        </div>
      `, { pretendToBeVisual: true })
      const document = dom.window.document
      document.getElementById('shell')!.getBoundingClientRect = () => rect(240, 80)
      document.getElementById('menu')!.getBoundingClientRect = () => rect(240, 80)
      document.getElementById('first')!.getBoundingClientRect = () => rect(240, 40)
      document.getElementById('second')!.getBoundingClientRect = () => rect(240, 40, 0, 40)
      const collected = await collectControlsWithObservations(document)
      return collectControlComposites(document, collected.observations)
    }

    const painted = await collect(true)
    const transparent = await collect(false)
    const menu = painted.find(composite => composite.kind === 'menu')
    const shell = painted.find(composite => composite.kind === 'popover')

    expect(shell).toMatchObject({
      geometry: { width: 240, height: 80 },
      children: [{
        kind: 'composite',
        compositeId: menu?.id,
        placement: { x: 0, y: 0, width: 240, height: 80 }
      }]
    })
    expect(transparent.map(composite => composite.kind)).toEqual(['menu'])
  })

  it('keeps a painted edge-to-edge shell around a singleton nested Composite', async () => {
    const dom = new JSDOM(`
      <div id="shell" role="dialog" style="
        display:flex;width:240px;height:64px;padding:0;
        background:white;border:1px solid rgb(220,220,220);
        box-shadow:0 4px 12px rgba(0,0,0,.12)
      ">
        <div id="menu" role="menu" style="
          display:flex;flex-direction:column;width:240px;height:64px;
          padding:12px;background:transparent
        ">
          <button id="action" style="width:216px;height:40px">Action</button>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('shell')!.getBoundingClientRect = () => rect(240, 64)
    document.getElementById('menu')!.getBoundingClientRect = () => rect(240, 64)
    document.getElementById('action')!.getBoundingClientRect = () => rect(216, 40, 12, 12)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const menu = composites.find(composite => composite.kind === 'menu')
    const shell = composites.find(composite => composite.kind === 'popover')

    expect(menu).toMatchObject({
      geometry: {
        width: 240,
        height: 64,
        padding: { top: 12, right: 12, bottom: 12, left: 12 }
      },
      children: [{ kind: 'control' }]
    })
    expect(shell).toMatchObject({
      geometry: { width: 240, height: 64 },
      children: [{
        kind: 'composite',
        compositeId: menu?.id,
        placement: { x: 0, y: 0, width: 240, height: 64 }
      }]
    })
  })

  it('keeps a painted shell around a three-level menu structure', async () => {
    const dom = new JSDOM(`
      <div id="shell" role="dialog" style="
        display:flex;width:320px;height:160px;padding:0;
        background:white;border:1px solid rgb(220,220,220);
        border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.16)
      ">
        <div id="menu" role="menu" style="
          display:flex;flex-direction:column;width:320px;height:160px;padding:0
        ">
          <div id="list" role="list" style="
            display:flex;flex-direction:column;width:320px;height:112px;padding:8px
          ">
            <button id="first" style="width:304px;height:48px">First action</button>
            <button id="second" style="width:304px;height:48px">Second action</button>
          </div>
          <button id="footer" style="width:320px;height:48px">Footer action</button>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    const boxes: Record<string, DOMRect> = {
      shell: rect(320, 160),
      menu: rect(320, 160),
      list: rect(320, 112),
      first: rect(304, 48, 8, 8),
      second: rect(304, 48, 8, 56),
      footer: rect(320, 48, 0, 112)
    }
    Object.entries(boxes).forEach(([id, box]) => {
      document.getElementById(id)!.getBoundingClientRect = () => box
    })

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const list = composites.find(composite => composite.kind === 'list')
    const menu = composites.find(composite => composite.kind === 'menu')
    const shell = composites.find(composite => composite.kind === 'popover')

    expect(list).toBeDefined()
    expect(menu?.children).toEqual(expect.arrayContaining([{
      kind: 'composite',
      compositeId: list?.id,
      placement: { x: 0, y: 0, width: 320, height: 112 }
    }]))
    expect(shell).toMatchObject({
      geometry: { width: 320, height: 160, radius: 12 },
      appearance: {
        background: { a: 1 },
        shadows: expect.arrayContaining([
          expect.objectContaining({ kind: 'outer' })
        ])
      },
      children: [{
        kind: 'composite',
        compositeId: menu?.id,
        placement: { x: 0, y: 0, width: 320, height: 160 }
      }]
    })
  })

  it('keeps a compact positioned block shell around a semantic menu', async () => {
    const dom = new JSDOM(`
      <div id="shell" style="
        display:block;position:absolute;width:240px;height:96px;padding:0;
        background:white;border:1px solid rgb(220,220,220);
        border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12)
      ">
        <div id="menu" role="menu" style="
          display:flex;flex-direction:column;width:240px;height:96px;padding:8px
        ">
          <button id="first" style="width:224px;height:40px">First action</button>
          <button id="second" style="width:224px;height:40px">Second action</button>
        </div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('shell')!.getBoundingClientRect = () => rect(240, 96)
    document.getElementById('menu')!.getBoundingClientRect = () => rect(240, 96)
    document.getElementById('first')!.getBoundingClientRect = () => rect(224, 40, 8, 8)
    document.getElementById('second')!.getBoundingClientRect = () => rect(224, 40, 8, 48)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const menu = composites.find(composite => composite.kind === 'menu')
    const shell = composites.find(composite => composite.kind === 'popover')

    expect(menu).toBeDefined()
    expect(shell).toMatchObject({
      geometry: { width: 240, height: 96, radius: 8 },
      appearance: {
        background: { a: 1 },
        shadows: expect.arrayContaining([
          expect.objectContaining({ kind: 'outer' })
        ])
      },
      children: [{
        kind: 'composite',
        compositeId: menu?.id,
        placement: { x: 0, y: 0, width: 240, height: 96 }
      }]
    })
  })

  it('rejects an arbitrary positioned painted block without a semantic composite child', async () => {
    const dom = new JSDOM(`
      <div id="shell" style="
        display:block;position:absolute;width:240px;height:96px;padding:8px;
        background:white;border:1px solid rgb(220,220,220);
        border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12)
      ">
        <button id="first" style="width:224px;height:40px">First action</button>
        <button id="second" style="width:224px;height:40px">Second action</button>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('shell')!.getBoundingClientRect = () => rect(240, 96)
    document.getElementById('first')!.getBoundingClientRect = () => rect(224, 40, 8, 8)
    document.getElementById('second')!.getBoundingClientRect = () => rect(224, 40, 8, 48)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites).toEqual([])
  })

  it('finds a real painted shell beyond six neutral wrapper levels', async () => {
    const dom = new JSDOM(`
      <div id="shell" role="dialog" style="
        display:flex;flex-direction:column;width:320px;height:96px;
        padding:8px;background:white;border:1px solid rgb(220,220,220);
        border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12)
      ">
        <div id="w1"><div id="w2"><div id="w3"><div id="w4">
          <div id="w5"><div id="w6"><div id="w7">
            <div id="inner" role="menu">
              <button id="first" style="width:304px;height:40px">First action</button>
              <button id="second" style="width:304px;height:40px">Second action</button>
            </div>
          </div></div></div>
        </div></div></div></div>
      </div>
    `, { pretendToBeVisual: true })
    const document = dom.window.document
    document.getElementById('shell')!.getBoundingClientRect = () => rect(320, 96)
    document.getElementById('inner')!.getBoundingClientRect = () => rect(304, 80, 8, 8)
    document.getElementById('first')!.getBoundingClientRect = () => rect(304, 40, 8, 8)
    document.getElementById('second')!.getBoundingClientRect = () => rect(304, 40, 8, 48)
    for (const id of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']) {
      document.getElementById(id)!.getBoundingClientRect = () => rect(304, 80, 8, 8)
    }

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites).toContainEqual(expect.objectContaining({
      geometry: expect.objectContaining({ width: 320, height: 96 }),
      appearance: expect.objectContaining({
        background: expect.objectContaining({ a: 1 })
      })
    }))
  })

  it('captures the exact marked transient shell beyond the bounded ancestor walk', async () => {
    const wrapperStart = Array.from({ length: 13 }, (_, index) =>
      `<div id="w${index + 1}">`
    ).join('')
    const wrapperEnd = '</div>'.repeat(13)
    const dom = new JSDOM(`
      <div id="shell" role="dialog" data-smart-scan-transient-structure="true" style="
        display:flex;flex-direction:column;width:320px;height:176px;
        padding:16px;background:white;border:1px solid rgb(220,220,220);
        border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.12)
      ">
        ${wrapperStart}
          <div id="content">
            <input id="filter" placeholder="Filter items" style="
              width:288px;height:32px;padding:5px 12px;
              border:1px solid rgb(180,180,180);border-radius:6px;background:white
            " />
            <button id="action" style="width:288px;height:48px">Primary action</button>
          </div>
        ${wrapperEnd}
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('shell')!.getBoundingClientRect = () => rect(320, 176)
    document.getElementById('content')!.getBoundingClientRect = () =>
      rect(288, 128, 16, 16)
    document.getElementById('filter')!.getBoundingClientRect = () =>
      rect(288, 32, 16, 16)
    document.getElementById('action')!.getBoundingClientRect = () =>
      rect(288, 48, 16, 96)
    for (let index = 1; index <= 13; index += 1) {
      document.getElementById(`w${index}`)!.getBoundingClientRect = () =>
        rect(288, 128, 16, 16)
    }

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const popover = composites.find(composite =>
      composite.kind === 'popover' && composite.geometry.width === 320
    )

    expect(popover).toMatchObject({
      geometry: { width: 320, height: 176, radius: 12 },
      appearance: {
        background: { a: 1 },
        shadows: expect.arrayContaining([
          expect.objectContaining({ kind: 'outer' })
        ])
      }
    })
  })

  it('keeps a complete transient popover when search layout and paint use separate shells', async () => {
    const dom = new JSDOM(`
      <div id="popover" role="dialog" data-smart-scan-transient-structure="true" style="
        display:flex;flex-direction:column;width:320px;height:176px;padding:16px;
        background:white;border:1px solid rgb(208,215,222);
        border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.12)
      ">
        <div id="search-paint" style="
          width:288px;height:32px;padding:0;
          background:white;border:1px solid rgb(140,149,159);border-radius:6px
        ">
          <div id="search-layout" style="
            display:flex;width:288px;height:32px;padding:0 0 0 8px;
            align-items:center;gap:8px;background:transparent
          ">
            <svg id="search-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v12H2Z"/>
            </svg>
            <input id="filter" placeholder="Filter items" style="
              width:256px;height:32px;padding:5px 12px;
              border:0;outline:0;background:transparent
            "/>
          </div>
        </div>
        <div id="information" style="width:288px;height:80px"></div>
        <button id="create" style="
          width:288px;height:32px;border:1px solid rgb(208,215,222);
          border-radius:6px;background:white
        ">Create item</button>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('popover')!.getBoundingClientRect = () => rect(320, 176)
    document.getElementById('search-paint')!.getBoundingClientRect = () =>
      rect(288, 32, 16, 16)
    document.getElementById('search-layout')!.getBoundingClientRect = () =>
      rect(288, 32, 16, 16)
    document.getElementById('search-icon')!.getBoundingClientRect = () =>
      rect(16, 16, 24, 24)
    document.getElementById('filter')!.getBoundingClientRect = () =>
      rect(256, 32, 48, 16)
    document.getElementById('information')!.getBoundingClientRect = () =>
      rect(288, 80, 16, 48)
    document.getElementById('create')!.getBoundingClientRect = () =>
      rect(288, 32, 16, 128)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const popover = composites.find(composite => composite.kind === 'popover')

    expect(collected.controls).toHaveLength(2)
    expect(collected.controls.find(control => control.family === 'input')).toMatchObject({
      geometry: { borderWidth: 1 },
      slots: { leading: { assetType: 'ui-icon', width: 16, height: 16 } },
      content: { kind: 'icon-leading' }
    })
    expect(popover).toMatchObject({
      geometry: { width: 320, height: 176, radius: 12 },
      appearance: {
        background: { a: 1 },
        shadows: expect.arrayContaining([
          expect.objectContaining({ kind: 'outer' })
        ])
      },
      children: [
        expect.objectContaining({
          kind: 'control',
          placement: { x: 16, y: 16, width: 288, height: 32 }
        }),
        expect.objectContaining({
          kind: 'control',
          placement: { x: 16, y: 128, width: 288, height: 32 }
        })
      ]
    })
  })

  it('keeps an exact compact popover and nested menu with two icon rows', async () => {
    const dom = new JSDOM(`
      <div id="popover" role="dialog" data-smart-scan-transient-structure="true" style="
        width:192px;height:80px;padding:0;background:white;border-radius:12px;
        box-shadow:0 6px 18px rgba(0,0,0,.12)
      ">
        <div id="menu" role="menu" style="
          display:flex;flex-direction:column;width:192px;height:80px;padding:8px
        ">
          <button id="first" role="menuitem" style="
            display:flex;width:176px;height:32px;padding:6px 8px;gap:8px;
            align-items:center;border:0;background:transparent
          ">
            <svg id="first-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v12H2Z"/>
            </svg>
            First action
          </button>
          <button id="second" role="menuitem" style="
            display:flex;width:176px;height:32px;padding:6px 8px;gap:8px;
            align-items:center;border:0;background:transparent
          ">
            <svg id="second-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 3h10v10H3Z"/>
            </svg>
            Second action
          </button>
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('popover')!.getBoundingClientRect = () => rect(192, 80)
    document.getElementById('menu')!.getBoundingClientRect = () => rect(192, 80)
    document.getElementById('first')!.getBoundingClientRect = () => rect(176, 32, 8, 8)
    document.getElementById('second')!.getBoundingClientRect = () => rect(176, 32, 8, 40)
    document.getElementById('first-icon')!.getBoundingClientRect = () => rect(16, 16, 16, 16)
    document.getElementById('second-icon')!.getBoundingClientRect = () => rect(16, 16, 16, 48)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)
    const menu = composites.find(composite => composite.kind === 'menu')
    const popover = composites.find(composite => composite.kind === 'popover')

    expect(collected.controls).toHaveLength(2)
    expect(collected.controls.every(control =>
      control.content.kind === 'icon-leading' &&
      control.slots.leading?.assetType === 'ui-icon'
    )).toBe(true)
    expect(menu).toMatchObject({
      kind: 'menu',
      geometry: {
        width: 192,
        height: 80,
        padding: { top: 8, right: 8, bottom: 8, left: 8 }
      },
      children: [
        expect.objectContaining({
          kind: 'control',
          placement: { x: 8, y: 8, width: 176, height: 32 }
        }),
        expect.objectContaining({
          kind: 'control',
          placement: { x: 8, y: 40, width: 176, height: 32 }
        })
      ]
    })
    expect(popover).toMatchObject({
      kind: 'popover',
      geometry: { width: 192, height: 80 },
      children: [expect.objectContaining({
        kind: 'composite',
        placement: { x: 0, y: 0, width: 192, height: 80 }
      })]
    })
  })

  it('captures an owner-marked transient holder outside the bounded ancestor walk', async () => {
    const owner = `sha256:${'4'.repeat(64)}`
    const wrapperStart = Array.from({ length: 13 }, (_, index) =>
      `<div id="owner-w${index + 1}">`
    ).join('')
    const wrapperEnd = '</div>'.repeat(13)
    const dom = new JSDOM(`
      <div id="holder" data-smart-scan-transient-owner="${owner}" style="
        display:block;position:absolute;width:320px;height:176px;padding:8px;
        background:white;border:1px solid rgb(220,220,220);
        border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.12)
      ">
        <div id="semantic" role="menu"
          data-smart-scan-transient-structure="true"
          data-smart-scan-transient-owner="${owner}"
          style="display:flex;flex-direction:column;width:304px;height:160px;padding:8px">
          ${wrapperStart}
            <div id="owner-content">
              <input id="owner-filter" placeholder="Filter items" style="
                width:288px;height:32px;padding:5px 12px;
                border:1px solid rgb(180,180,180);border-radius:6px;background:white
              " />
              <button id="owner-action" style="width:288px;height:48px">Primary action</button>
            </div>
          ${wrapperEnd}
        </div>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('holder')!.getBoundingClientRect = () => rect(320, 176)
    document.getElementById('semantic')!.getBoundingClientRect = () => rect(304, 160, 8, 8)
    document.getElementById('owner-content')!.getBoundingClientRect = () =>
      rect(288, 128, 16, 16)
    document.getElementById('owner-filter')!.getBoundingClientRect = () =>
      rect(288, 32, 16, 16)
    document.getElementById('owner-action')!.getBoundingClientRect = () =>
      rect(288, 48, 16, 96)
    for (let index = 1; index <= 13; index += 1) {
      document.getElementById(`owner-w${index}`)!.getBoundingClientRect = () =>
        rect(288, 128, 16, 16)
    }

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites).toContainEqual(expect.objectContaining({
      kind: 'popover',
      geometry: expect.objectContaining({ width: 320, height: 176, radius: 12 }),
      appearance: expect.objectContaining({
        background: expect.objectContaining({ a: 1 }),
        shadows: expect.arrayContaining([
          expect.objectContaining({ kind: 'outer' })
        ])
      })
    }))
  })

  it('keeps an already rendered transient file menu holder', async () => {
    const owner = `sha256:${'5'.repeat(64)}`
    const dom = new JSDOM(`
      <div id="file-menu" role="menu"
        data-smart-scan-transient-structure="true"
        data-smart-scan-transient-owner="${owner}"
        style="
          display:flex;flex-direction:column;width:320px;height:96px;padding:8px;
          background:white;border:1px solid rgb(220,220,220);
          border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.12)
        ">
        <button id="ordinary-row" style="width:304px;height:40px">New item</button>
        <label id="file-row" role="menuitem" style="width:304px;height:40px">
          Upload item
          <input id="file-input" type="file" hidden />
        </label>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('file-menu')!.getBoundingClientRect = () => rect(320, 96)
    document.getElementById('ordinary-row')!.getBoundingClientRect = () =>
      rect(304, 40, 8, 8)
    document.getElementById('file-row')!.getBoundingClientRect = () =>
      rect(304, 40, 8, 48)

    const collected = await collectControlsWithObservations(document)
    const composites = await collectControlComposites(document, collected.observations)

    expect(composites).toContainEqual(expect.objectContaining({
      kind: 'menu',
      geometry: expect.objectContaining({ width: 320, height: 96, radius: 12 }),
      children: [
        expect.objectContaining({ kind: 'control' }),
        expect.objectContaining({ kind: 'control' })
      ]
    }))
  })

  it('still rejects an unmarked container with a native file target', async () => {
    const dom = new JSDOM(`
      <div id="file-menu" role="menu" style="
        display:flex;flex-direction:column;width:320px;height:96px;padding:8px;
        background:white;border:1px solid rgb(220,220,220)
      ">
        <button id="ordinary-row" style="width:304px;height:40px">New item</button>
        <label id="file-row" role="menuitem" style="width:304px;height:40px">
          Upload item
          <input type="file" hidden />
        </label>
      </div>
    `, { pretendToBeVisual: true, url: 'https://example.com/' })
    const document = dom.window.document
    document.getElementById('file-menu')!.getBoundingClientRect = () => rect(320, 96)
    document.getElementById('ordinary-row')!.getBoundingClientRect = () =>
      rect(304, 40, 8, 8)
    document.getElementById('file-row')!.getBoundingClientRect = () =>
      rect(304, 40, 8, 48)

    const collected = await collectControlsWithObservations(document)

    expect(await collectControlComposites(document, collected.observations)).toEqual([])
  })
})
