import { cp, mkdir, rm } from 'node:fs/promises'
import { build } from 'esbuild'

const output = new URL('../dist/chrome/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

await Promise.all([
  build({ entryPoints: ['src/chrome/background/service-worker.ts'], bundle: true, format: 'esm', target: 'chrome120', outfile: 'dist/chrome/service-worker.js' }),
  build({ entryPoints: ['src/chrome/content/index.ts'], bundle: true, format: 'iife', target: 'chrome120', outfile: 'dist/chrome/content-scan.js' }),
  build({ entryPoints: ['src/chrome/popup/popup.ts'], bundle: true, format: 'esm', target: 'chrome120', outfile: 'dist/chrome/popup.js' })
])

await Promise.all([
  cp('src/chrome/manifest.json', 'dist/chrome/manifest.json'),
  cp('src/chrome/popup/index.html', 'dist/chrome/popup.html'),
  cp('src/chrome/popup/popup.css', 'dist/chrome/popup.css')
])

