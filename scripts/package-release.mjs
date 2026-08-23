import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const INSTALLATION_TEXT = `Install both plugins from this same versioned package.

Chrome:
1. Open chrome://extensions and enable Developer mode.
2. Select Load unpacked and choose the chrome folder.

Figma:
1. Open Figma Desktop.
2. Use Plugins > Development > Import plugin from manifest.
3. Select figma/manifest.json.

Use the project only on websites you own or are authorized to analyze.
Review exported JSON before sharing it.
See docs/installation.md in the source repository for full instructions.
`

async function requireFile(path) {
  try {
    await access(path)
  } catch {
    throw new Error(`Required Release input is missing: ${path}`)
  }
}

export async function createReleasePackage({ root, outDir, slug, version }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Release slug must use lowercase letters, numbers, and hyphens')
  }
  if (!/^v\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version)) {
    throw new Error('Release version must be a v-prefixed semantic version')
  }

  const sourceRoot = resolve(root)
  const outputRoot = resolve(outDir)
  const folderName = `${slug}-${version}`
  const packageDirectory = join(outputRoot, folderName)
  const zipPath = join(outputRoot, `${folderName}.zip`)
  const checksumPath = join(outputRoot, 'SHA256SUMS.txt')

  for (const required of [
    'dist/chrome/manifest.json',
    'dist/figma/manifest.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  ]) await requireFile(join(sourceRoot, required))

  await mkdir(outputRoot, { recursive: true })
  await rm(packageDirectory, { recursive: true, force: true })
  await rm(zipPath, { force: true })
  await cp(join(sourceRoot, 'dist/chrome'), join(packageDirectory, 'chrome'), {
    recursive: true
  })
  await cp(join(sourceRoot, 'dist/figma'), join(packageDirectory, 'figma'), {
    recursive: true
  })
  await cp(join(sourceRoot, 'LICENSE'), join(packageDirectory, 'LICENSE'))
  await cp(
    join(sourceRoot, 'THIRD_PARTY_NOTICES.md'),
    join(packageDirectory, 'THIRD_PARTY_NOTICES.md')
  )
  await writeFile(join(packageDirectory, 'INSTALLATION.txt'), INSTALLATION_TEXT)

  const zip = spawnSync('zip', ['-qr', zipPath, folderName], {
    cwd: outputRoot,
    encoding: 'utf8'
  })
  if (zip.status !== 0) {
    throw new Error(`zip failed: ${zip.stderr || zip.stdout || 'unknown error'}`)
  }
  const checksum = createHash('sha256').update(await readFile(zipPath)).digest('hex')
  await writeFile(checksumPath, `${checksum}  ${basename(zipPath)}\n`)

  return { packageDirectory, zipPath, checksumPath, checksum }
}

async function main() {
  const [slug, version = 'v0.1.0-beta.1', outDir = 'release-artifacts'] =
    process.argv.slice(2)
  if (!slug) {
    console.error('Usage: node scripts/package-release.mjs <slug> [version] [out-dir]')
    process.exitCode = 2
    return
  }
  const result = await createReleasePackage({
    root: process.cwd(),
    outDir,
    slug,
    version
  })
  console.log(`Created ${result.zipPath}`)
  console.log(`SHA-256 ${result.checksum}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
