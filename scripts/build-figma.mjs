import { cp, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

await mkdir('dist/figma', { recursive: true })
await build({
  entryPoints: ['src/figma/code.ts'],
  bundle: true,
  outfile: 'dist/figma/code.js',
  platform: 'browser',
  target: 'es2017',
  format: 'iife',
  minify: false
})
await Promise.all([
  cp('src/figma/ui.html', 'dist/figma/ui.html'),
  cp('src/figma/manifest.source.json', 'dist/figma/manifest.json')
])
