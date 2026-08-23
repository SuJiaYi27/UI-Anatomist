import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXACT_BUILD_FILES = new Set([
  'scripts/build-chrome.mjs',
  'scripts/build-figma.mjs'
])

function normalize(root, target) {
  return relative(root, target).split(sep).join('/')
}

async function productFiles(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) files.push(normalize(root, target))
    }
  }
  try {
    await visit(resolve(root, 'src'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  for (const path of EXACT_BUILD_FILES) {
    try {
      await readFile(resolve(root, path))
      files.push(path)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return new Set(files)
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function buildScripts(root) {
  try {
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
    return Object.fromEntries(Object.entries(packageJson.scripts ?? {}).filter(([name]) =>
      /^(?:build|typecheck|verify)(?::|$)/.test(name)
    ))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export async function compareProductScope(candidateRoot, publicRoot) {
  const candidate = resolve(candidateRoot)
  const publicTree = resolve(publicRoot)
  const candidateFiles = await productFiles(candidate)
  const publicFiles = await productFiles(publicTree)
  const findings = []

  for (const path of [...candidateFiles].sort()) {
    if (!publicFiles.has(path)) {
      findings.push({ path, kind: 'missing-product-file' })
      continue
    }
    if (await digest(resolve(candidate, path)) !== await digest(resolve(publicTree, path))) {
      findings.push({ path, kind: 'changed-product-file' })
    }
  }
  for (const path of [...publicFiles].sort()) {
    if (!candidateFiles.has(path)) {
      findings.push({ path, kind: 'unexpected-product-file' })
    }
  }

  const candidateScripts = await buildScripts(candidate)
  const publicScripts = await buildScripts(publicTree)
  for (const [name, command] of Object.entries(candidateScripts)) {
    if (publicScripts[name] !== command) {
      findings.push({ path: `package.json#scripts.${name}`, kind: 'changed-build-entry' })
    }
  }
  return findings
}

async function main() {
  const [candidateRoot, publicRoot = process.cwd()] = process.argv.slice(2)
  if (!candidateRoot) {
    console.error('Usage: node scripts/compare-private-candidate.mjs <candidate> [public-tree]')
    process.exitCode = 2
    return
  }
  const findings = await compareProductScope(candidateRoot, publicRoot)
  if (findings.length === 0) {
    console.log('Product source and build entries match the frozen candidate.')
    return
  }
  for (const item of findings) console.error(`${item.kind}: ${item.path}`)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
