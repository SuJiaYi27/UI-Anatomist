import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  clearCandidateMarkers,
  discoverCandidates,
  nativeFilePickerRisk
} from '../../src/chrome/content/discover'

function documentFor(body: string): Document {
  return new JSDOM(body, { url: 'https://example.com/projects/demo' }).window.document
}

describe('discoverCandidates P3 interaction contract', () => {
  it('actively discovers supported ARIA structure entrances', () => {
    const document = documentFor(`
      <button aria-expanded="false">Search</button>
      <button aria-haspopup="menu">Profile</button>
      <button aria-haspopup="listbox">Choose model</button>
      <div role="tab" aria-selected="false">Details</div>
    `)

    expect(discoverCandidates(document, { mark: false }).map(candidate => [
      candidate.kind,
      candidate.risk,
      candidate.target
    ])).toEqual([
      ['disclosure', 'safe', 'reversible-click'],
      ['disclosure', 'safe', 'reversible-click'],
      ['disclosure', 'safe', 'reversible-click'],
      ['tab', 'safe', 'reversible-click']
    ])
  })

  it('keeps the Add file parent menu explorable', () => {
    const document = documentFor(`
      <button aria-haspopup="menu">Add file</button>
      <button aria-haspopup="true">Add files and more</button>
    `)

    expect(discoverCandidates(document, { mark: false }).map(candidate => [
      candidate.label,
      candidate.risk
    ])).toEqual([
      ['Add file', 'safe'],
      ['Add files and more', 'safe']
    ])
  })

  it('discovers the first summary of a native details element as a reversible structure entrance', () => {
    const document = documentFor(`
      <details>
        <summary>More options</summary>
        <div role="menu">Menu content</div>
      </details>
    `)

    expect(discoverCandidates(document, { mark: false }).map(candidate => [
      candidate.kind,
      candidate.risk,
      candidate.target
    ])).toEqual([
      ['disclosure', 'safe', 'reversible-click']
    ])
  })

  it('hard-blocks direct and explicitly associated native file pickers', () => {
    const document = documentFor(`
      <input id="direct" type="file" role="button" aria-haspopup="menu">
      <button id="descendant" aria-haspopup="menu"><input type="file" hidden></button>
      <input id="label-target" type="file" hidden>
      <label for="label-target"><span id="label-control" role="button">Choose</span></label>
      <input id="controlled-target" type="file" hidden>
      <button id="controlled" aria-haspopup="menu" aria-controls="controlled-target">Add file</button>
    `)

    expect(['direct', 'descendant', 'label-control', 'controlled'].map(id =>
      nativeFilePickerRisk(document.getElementById(id) as HTMLElement, document)
    )).toEqual([
      'direct-input',
      'direct-input',
      'associated-input',
      'associated-input'
    ])
    expect(discoverCandidates(document, { mark: false })).toEqual([])
  })

  it('does not discover native submit, reset, or image form actions', () => {
    const document = documentFor(`
      <form>
        <button aria-haspopup="menu">Submit menu</button>
        <button type="reset" aria-haspopup="menu">Reset menu</button>
        <input type="image" aria-haspopup="menu" alt="Image submit">
      </form>
    `)

    expect(discoverCandidates(document, { mark: false })).toEqual([])
  })

  it('keeps explicit dangerous ordinary actions out of safe interaction', () => {
    const document = documentFor(`
      <button>Save</button>
      <button>Delete</button>
      <button>Purchase</button>
      <button>Sign out</button>
      <button>Authorize</button>
      <button>Install</button>
    `)

    expect(discoverCandidates(document, { mark: false }).map(candidate => [
      candidate.label,
      candidate.risk
    ])).toEqual([
      ['Save', 'blocked'],
      ['Delete', 'blocked'],
      ['Purchase', 'blocked'],
      ['Sign out', 'blocked'],
      ['Authorize', 'blocked'],
      ['Install', 'blocked']
    ])
  })

  it('queues only classified same-origin read navigation', () => {
    const document = documentFor(`
      <nav>
        <a href="/projects">Projects</a>
        <a href="https://other.example/docs">Docs</a>
      </nav>
    `)

    expect(discoverCandidates(document, { mark: false }).map(candidate => [
      candidate.label,
      candidate.target,
      candidate.risk
    ])).toEqual([
      ['Projects', 'navigate', 'safe'],
      ['Docs', 'navigate', 'uncertain']
    ])
  })

  it('does not interact with disabled or visually hidden controls', () => {
    const document = documentFor(`
      <button disabled aria-haspopup="menu">Disabled menu</button>
      <div hidden><button aria-haspopup="menu">Hidden menu</button></div>
      <div aria-hidden="true"><button aria-expanded="false">Hidden search</button></div>
      <button aria-haspopup="menu">Visible menu</button>
    `)

    expect(discoverCandidates(document, { mark: false }).map(candidate => candidate.label))
      .toEqual(['Visible menu'])
  })

  it('clears temporary candidate markers after discovery', () => {
    const document = documentFor('<button aria-expanded="false">Search</button>')
    discoverCandidates(document)
    expect(document.querySelectorAll('[data-smart-scan-key]')).toHaveLength(1)

    clearCandidateMarkers(document)
    expect(document.querySelectorAll('[data-smart-scan-key]')).toHaveLength(0)
  })
})
