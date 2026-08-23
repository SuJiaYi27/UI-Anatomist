import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { compareProductScope } from '../../scripts/compare-private-candidate.mjs'

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'candidate-diff-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

describe('compareProductScope', () => {
  it('accepts documentation and metadata differences when product files match', async () => {
    const candidate = tree({
      'src/main.ts': 'export const value = 1',
      'scripts/build-chrome.mjs': 'build()',
      'package.json': '{"name":"private"}'
    })
    const publicTree = tree({
      'src/main.ts': 'export const value = 1',
      'scripts/build-chrome.mjs': 'build()',
      'package.json': '{"name":"public"}',
      'README.md': '# Public'
    })
    await expect(compareProductScope(candidate, publicTree)).resolves.toEqual([])
  })

  it('reports missing, changed, and unexpected product files', async () => {
    const candidate = tree({
      'src/main.ts': 'export const value = 1',
      'src/missing.ts': 'export const missing = true',
      'scripts/build-chrome.mjs': 'build()'
    })
    const publicTree = tree({
      'src/main.ts': 'export const value = 2',
      'src/extra.ts': 'export const extra = true',
      'scripts/build-chrome.mjs': 'build()'
    })
    const findings = await compareProductScope(candidate, publicTree)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/main.ts', kind: 'changed-product-file' }),
      expect.objectContaining({ path: 'src/missing.ts', kind: 'missing-product-file' }),
      expect.objectContaining({ path: 'src/extra.ts', kind: 'unexpected-product-file' })
    ]))
  })
})
