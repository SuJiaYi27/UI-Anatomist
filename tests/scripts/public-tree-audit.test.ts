import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { auditPublicTree } from '../../scripts/audit-public-tree.mjs'

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'public-tree-audit-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

describe('auditPublicTree', () => {
  it('accepts an anonymous public tree', async () => {
    const root = tree({
      'README.md': '# Example',
      'tests/fixtures/scan.json': JSON.stringify({
        source: { origin: 'https://example.test' }
      })
    })
    await expect(auditPublicTree(root)).resolves.toEqual([])
  })

  it('rejects internal paths, local paths, secrets, and real-site fixture origins', async () => {
    const localPath = ['', 'Users', 'example', 'private'].join('/')
    const fakeCredential = `sk-${'1'.repeat(24)}`
    const root = tree({
      'AGENTS.md': 'internal',
      'src/example.ts': `const path = '${localPath}'\nconst key = '${fakeCredential}'`,
      'tests/fixtures/scan.json': JSON.stringify({
        source: { origin: 'https://private.example.com' }
      })
    })
    const findings = await auditPublicTree(root)
    expect(findings.map(item => item.kind)).toEqual(expect.arrayContaining([
      'forbidden-path', 'local-path', 'credential-pattern', 'external-fixture-origin'
    ]))
  })

  it('allows explicit draft placeholders only in staging mode', async () => {
    const placeholder = `[[${'PRODUCT_NAME'}]]`
    const root = tree({ 'README.md': `# ${placeholder}` })
    await expect(auditPublicTree(root)).resolves.toEqual([
      expect.objectContaining({ kind: 'unresolved-placeholder' })
    ])
    await expect(auditPublicTree(root, { allowPlaceholders: true })).resolves.toEqual([])
  })

  it('uses the current directory when the CLI receives flags but no root path', () => {
    const placeholder = `[[${'PRODUCT_NAME'}]]`
    const root = tree({ 'README.md': `# ${placeholder}` })
    const script = fileURLToPath(new URL('../../scripts/audit-public-tree.mjs', import.meta.url))
    const result = spawnSync(process.execPath, [script, '--allow-placeholders'], {
      cwd: root,
      encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Public tree audit passed.')
  })
})
