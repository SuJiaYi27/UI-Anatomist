import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('UI-Anatomist public branding', () => {
  it('uses the approved product and repository identity in public metadata', () => {
    const packageJson = JSON.parse(read('package.json')) as { name: string }
    const chromeManifest = JSON.parse(read('src/chrome/manifest.json')) as {
      name: string
    }
    const figmaManifest = JSON.parse(read('src/figma/manifest.source.json')) as {
      name: string
      id: string
    }
    const readme = read('README.md')

    expect(packageJson.name).toBe('ui-anatomist')
    expect(chromeManifest.name).toBe('UI-Anatomist')
    expect(figmaManifest).toMatchObject({
      name: 'UI-Anatomist',
      id: 'smart-scan-typography-importer-local'
    })
    expect(readme).toContain('# UI-Anatomist')
    expect(readme).toContain('assets/anatomist-poster-light.jpg')
    expect(readme).not.toContain('src="assets/logo.png"')
    expect(readme).toContain(
      'Analyze rendered web UIs and rebuild observable design-system assets as editable Figma assets.'
    )
    expect(readme).toContain('https://github.com/SuJiaYi27/UI-Anatomist')
  })

  it('removes the old display name while retaining internal compatibility identifiers', () => {
    const publicSurfaces = [
      'src/chrome/manifest.json',
      'src/chrome/popup/index.html',
      'src/chrome/popup/popup.ts',
      'src/chrome/background/page-session.ts',
      'src/chrome/background/scan-site.ts',
      'src/chrome/background/scan-workflow.ts',
      'src/chrome/background/chrome-adapter.ts',
      'src/chrome/interaction-restore-error.ts',
      'src/figma/ui.html',
      'src/figma/import-plan.ts',
      'src/figma/code.ts',
      'src/figma/color-import-plan.ts',
      'src/figma/color-variable-applier.ts',
      'src/figma/control-board-builder.ts',
      'src/figma/control-component-applier.ts',
      'src/figma/control-master-board-builder.ts',
      'src/figma/icon-master-board-builder.ts',
      'src/figma/icon-variable-applier.ts',
      'src/figma/radius-board-builder.ts',
      'src/figma/radius-import-plan.ts',
      'src/figma/radius-variable-applier.ts',
      'src/figma/shadow-board-builder.ts',
      'src/figma/shadow-import-plan.ts',
      'src/figma/shadow-style-applier.ts',
      'src/figma/spacing-board-builder.ts',
      'src/figma/spacing-import-plan.ts',
      'src/figma/spacing-variable-applier.ts',
      'src/figma/style-applier.ts'
    ].map(read).join('\n')

    expect(publicSurfaces).not.toContain('Smart Scan')
    expect(publicSurfaces).not.toContain('--smart-scan-')
    expect(read('src/chrome/popup/popup.ts')).toContain('ui-anatomist-${')
    expect(read('src/chrome/background/page-session.ts'))
      .toContain('data-smart-scan-overlay')
  })

  it('keeps complete English and Simplified Chinese README entry points', () => {
    const english = read('README.md')
    const chinese = read('README.zh-CN.md')

    expect(english).toContain('English | [简体中文](README.zh-CN.md)')
    expect(chinese).toContain('[English](README.md) | 简体中文')

    for (const value of [
      'https://github.com/SuJiaYi27/UI-Anatomist/releases/tag/v0.1.0-beta.1',
      'https://github.com/SuJiaYi27/UI-Anatomist/issues',
      'https://github.com/SuJiaYi27/UI-Anatomist/discussions',
      'Copyright 2026 Su JiaYi.'
    ]) {
      expect(english).toContain(value)
      expect(chinese).toContain(value)
    }

    for (const heading of [
      '## Showcase',
      '## Core capabilities',
      '## Known limitations',
      '## Quick start',
      '## Privacy & safety',
      '## Documentation',
      '## Community & contributions',
      '## Roadmap',
      '## Development',
      '## License'
    ]) expect(english).toContain(heading)

    for (const heading of [
      '## 产品展示',
      '## 核心功能',
      '## 已知限制',
      '## 快速开始',
      '## 隐私与安全',
      '## 文档',
      '## 社区与贡献',
      '## 下一阶段计划',
      '## 开发说明',
      '## 开源许可证'
    ]) expect(chinese).toContain(heading)

    expect(english).not.toContain('earlier **Smart Scan**')
    expect(chinese).not.toContain('Smart Scan')
  })
})
