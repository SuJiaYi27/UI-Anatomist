import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../../src/figma/ui.html', import.meta.url), 'utf8')

describe('Figma importer UI redesign', () => {
  it('uses the production Chinese and JSON typefaces from the Figma handoff', () => {
    expect(html).toMatch(/--font-chinese:\s*"PingFang SC"/)
    expect(html).toMatch(/--font-mono:\s*"Roboto Mono"/)
    expect(html).toMatch(/textarea::placeholder\s*{[^}]*font:[^;}]*var\(--font-chinese\)/s)
    expect(html).toMatch(/#status\s*{[^}]*font-family:\s*var\(--font-chinese\)/s)
  })

  it('exposes every interactive Figma state without changing import messages', () => {
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    const { document } = dom.window
    const input = document.getElementById('json') as HTMLTextAreaElement
    const button = document.getElementById('import') as HTMLButtonElement
    const status = document.getElementById('status') as HTMLDivElement

    ;(dom.window as unknown as { postMessage: () => void }).postMessage = () => undefined

    expect(document.body.dataset.uiStatus).toBe('empty')

    input.value = '{"schemaVersion":"1.11.0"}'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(document.body.dataset.uiStatus).toBe('populated')
    expect(button.disabled).toBe(false)

    input.focus()
    expect(document.body.dataset.uiStatus).toBe('focus')
    input.blur()
    expect(document.body.dataset.uiStatus).toBe('populated')

    button.click()
    expect(document.body.dataset.uiStatus).toBe('importing')
    expect(status.textContent).toBe('正在导入…')

    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { pluginMessage: { type: 'IMPORT_RESULT', message: '已导入真实结果' } }
      })
    )
    expect(document.body.dataset.uiStatus).toBe('success')
    expect(status.textContent).toBe('已导入真实结果')

    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { pluginMessage: { type: 'IMPORT_ERROR', message: '保留运行时错误原文' } }
      })
    )
    expect(document.body.dataset.uiStatus).toBe('error')
    expect(status.textContent).toBe('保留运行时错误原文')
    expect(status.className).toBe('error')

    dom.window.close()
  })
})
