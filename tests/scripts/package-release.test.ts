import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createReleasePackage } from '../../scripts/package-release.mjs'

describe('createReleasePackage', () => {
  it('packages matching Chrome and Figma builds with licenses and a checksum', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-source-'))
    const outDir = mkdtempSync(join(tmpdir(), 'release-output-'))
    mkdirSync(join(root, 'dist/chrome'), { recursive: true })
    mkdirSync(join(root, 'dist/figma'), { recursive: true })
    writeFileSync(join(root, 'dist/chrome/manifest.json'), '{}')
    writeFileSync(join(root, 'dist/figma/manifest.json'), '{}')
    writeFileSync(join(root, 'LICENSE'), 'license')
    writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'notices')

    const result = await createReleasePackage({
      root,
      outDir,
      slug: 'example-product',
      version: 'v0.1.0-beta.1'
    })

    expect(existsSync(join(result.packageDirectory, 'chrome/manifest.json'))).toBe(true)
    expect(existsSync(join(result.packageDirectory, 'figma/manifest.json'))).toBe(true)
    expect(existsSync(result.zipPath)).toBe(true)
    expect(readFileSync(result.checksumPath, 'utf8')).toMatch(
      /^[0-9a-f]{64}  example-product-v0\.1\.0-beta\.1\.zip\n$/
    )
  })
})
