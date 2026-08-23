import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const FORBIDDEN_PATHS = [
  /^AGENTS\.md$/,
  /^docs\/(?:recovery|superpowers|ui-handoff)(?:\/|$)/,
  /^validation\/(?:scans|diagnostics)(?:\/|$)/
]

const FORBIDDEN_EXTENSIONS = new Set(['.env', '.log', '.map', '.zip'])
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage'])

function normalizedRelative(root, target) {
  return relative(root, target).split(sep).join('/')
}

async function filesUnder(root) {
  const result = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue
      const target = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) result.push(target)
    }
  }
  await visit(root)
  return result.sort()
}

function finding(path, kind, message) {
  return { path, kind, message }
}

function textFindings(path, text, allowPlaceholders) {
  const result = []
  if (/\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(text) || /\.codex\//.test(text)) {
    result.push(finding(path, 'local-path', 'Developer-local path detected'))
  }
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
    /\bsk-[A-Za-z0-9_-]{20,}\b/.test(text) ||
    /\b(?:ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/.test(text) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(text) ||
    /\b(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*['"][^'"]{12,}['"]/i.test(text)
  ) {
    result.push(finding(path, 'credential-pattern', 'Credential-like value detected'))
  }
  if (/https:\/\/api\.openai\.com\//i.test(text)) {
    result.push(finding(path, 'external-api-endpoint', 'OpenAI API endpoint detected'))
  }
  if (!allowPlaceholders && /\[\[[A-Z0-9_]+\]\]/.test(text)) {
    result.push(finding(path, 'unresolved-placeholder', 'Draft placeholder remains'))
  }
  return result
}

function fixtureOriginFindings(path, text) {
  if (!/^tests\/fixtures\/.*\.json$/i.test(path)) return []
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return [finding(path, 'invalid-json-fixture', 'Fixture is not valid JSON')]
  }
  const origin = value?.source?.origin
  if (typeof origin === 'string' && origin !== 'https://example.test') {
    return [finding(
      path,
      'external-fixture-origin',
      'Public JSON fixture must use https://example.test'
    )]
  }
  return []
}

export async function auditPublicTree(root, options = {}) {
  const absoluteRoot = resolve(root)
  const findings = []
  for (const target of await filesUnder(absoluteRoot)) {
    const path = normalizedRelative(absoluteRoot, target)
    if (FORBIDDEN_PATHS.some(pattern => pattern.test(path))) {
      findings.push(finding(path, 'forbidden-path', 'Internal or restricted path detected'))
      continue
    }
    if (FORBIDDEN_EXTENSIONS.has(extname(path).toLowerCase())) {
      findings.push(finding(path, 'forbidden-artifact', 'Generated or private artifact detected'))
      continue
    }
    if ((await stat(target)).size > 10 * 1024 * 1024) {
      findings.push(finding(path, 'oversized-file', 'File exceeds the public-tree review limit'))
      continue
    }
    const buffer = await readFile(target)
    if (buffer.includes(0)) continue
    const text = buffer.toString('utf8')
    findings.push(...textFindings(path, text, options.allowPlaceholders === true))
    findings.push(...fixtureOriginFindings(path, text))
  }
  return findings
}

async function main() {
  const allowPlaceholders = process.argv.includes('--allow-placeholders')
  const rootArgument = process.argv.slice(2)
    .find(argument => !argument.startsWith('-'))
  const root = rootArgument ?? process.cwd()
  const findings = await auditPublicTree(root, { allowPlaceholders })
  if (findings.length === 0) {
    console.log('Public tree audit passed.')
    return
  }
  for (const item of findings) {
    console.error(`${item.kind}: ${item.path} — ${item.message}`)
  }
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
