import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

import { importButtonEnabled, resultMessage } from '../../src/figma/ui-state'

describe('Figma plugin UI state', () => {
  it('requires pasted JSON before enabling Import JSON', () => {
    expect(importButtonEnabled('  ')).toBe(false)
    expect(importButtonEnabled('{"schemaVersion":"1.0.0"}')).toBe(true)
  })

  it('reports typography, radius variables, percentages, and missing fonts without a JSON preview', () => {
    expect(resultMessage({
      typographyCreated: 7,
      typographyUpdated: 1,
      typographyRemoved: 0,
      radiusCreated: 4,
      radiusUpdated: 1,
      radiusRemoved: 0,
      shadowCreated: 2,
      shadowUpdated: 1,
      shadowRemoved: 0,
      colorCreated: 6,
      colorUpdated: 2,
      colorRemoved: 0,
      spacingCreated: 3,
      spacingUpdated: 1,
      spacingRemoved: 0,
      controlCreated: 2,
      controlUpdated: 1,
      controlRemoved: 0,
      missingFonts: ['PingFang SC'],
      typographyConflicts: [],
      radiusConflicts: [],
      shadowConflicts: [],
      colorConflicts: [],
      spacingConflicts: [],
      controlConflicts: [],
      percentageRadii: 1,
      staleCleanupSkipped: false
    })).toBe('已导入 8 个文字样式、5 个圆角变量、3 个阴影样式、8 个颜色变量、4 个间距变量、3 个交互控件；1 个百分比圆角已保留在画板中；缺少字体：PingFang SC。其他样式未受影响。')
  })

  it('reports protected user-style conflicts even when fonts are also missing', () => {
    expect(resultMessage({
      typographyCreated: 2,
      typographyUpdated: 0,
      typographyRemoved: 0,
      radiusCreated: 0,
      radiusUpdated: 0,
      radiusRemoved: 0,
      shadowCreated: 0,
      shadowUpdated: 0,
      shadowRemoved: 0,
      colorCreated: 0,
      colorUpdated: 0,
      colorRemoved: 0,
      spacingCreated: 0,
      spacingUpdated: 0,
      spacingRemoved: 0,
      controlCreated: 0,
      controlUpdated: 0,
      controlRemoved: 0,
      missingFonts: ['Missing Sans'],
      typographyConflicts: ['UI-Anatomist/example.com/body-regular'],
      radiusConflicts: ['Radius/8'],
      shadowConflicts: ['UI-Anatomist/example.com/user-shadow'],
      colorConflicts: ['Primitive/neutral/neutral-0'],
      spacingConflicts: [],
      controlConflicts: ['Control/Button/Primary/Md'],
      percentageRadii: 0,
      staleCleanupSkipped: false
    })).toContain('5 个同名用户资产未被覆盖')
  })

  it('reports plugin-owned assets replaced by the latest scan', () => {
    expect(resultMessage({
      typographyCreated: 1,
      typographyUpdated: 2,
      typographyRemoved: 3,
      radiusCreated: 0,
      radiusUpdated: 4,
      radiusRemoved: 1,
      shadowCreated: 2,
      shadowUpdated: 1,
      shadowRemoved: 2,
      colorCreated: 5,
      colorUpdated: 4,
      colorRemoved: 3,
      spacingCreated: 1,
      spacingUpdated: 2,
      spacingRemoved: 1,
      controlCreated: 2,
      controlUpdated: 3,
      controlRemoved: 2,
      missingFonts: [],
      typographyConflicts: [],
      radiusConflicts: [],
      shadowConflicts: [],
      colorConflicts: [],
      spacingConflicts: [],
      controlConflicts: [],
      percentageRadii: 0,
      staleCleanupSkipped: false
    })).toBe('已导入 3 个文字样式、4 个圆角变量、3 个阴影样式、9 个颜色变量、3 个间距变量、5 个交互控件；已替换 3 个旧文字样式、1 个旧圆角变量、2 个旧阴影样式、3 个旧颜色变量、1 个旧间距变量、2 个旧交互控件；设计系统画板已生成。')
  })

  it('explains that incomplete scans never delete prior UI-Anatomist assets', () => {
    expect(resultMessage({
      typographyCreated: 1,
      typographyUpdated: 0,
      typographyRemoved: 0,
      radiusCreated: 1,
      radiusUpdated: 0,
      radiusRemoved: 0,
      shadowCreated: 1,
      shadowUpdated: 0,
      shadowRemoved: 0,
      colorCreated: 1,
      colorUpdated: 0,
      colorRemoved: 0,
      spacingCreated: 1,
      spacingUpdated: 0,
      spacingRemoved: 0,
      controlCreated: 1,
      controlUpdated: 0,
      controlRemoved: 0,
      missingFonts: [],
      typographyConflicts: [],
      radiusConflicts: [],
      shadowConflicts: [],
      colorConflicts: [],
      spacingConflicts: [],
      controlConflicts: [],
      percentageRadii: 0,
      staleCleanupSkipped: true
    })).toContain('扫描存在未完成页面，本次未清理旧资产')
  })

  it('keeps the importer generic while retaining the direct paste/import interaction', () => {
    const html = readFileSync(new URL('../../src/figma/ui.html', import.meta.url), 'utf8')
    expect(html).toContain('<h1>UI-Anatomist</h1>')
    expect(html).toContain('Import JSON')
    expect(html).not.toContain('UI-Anatomist Typography</h1>')
  })

  it('keeps the source manifest non-importable so Figma only caches the built plugin', () => {
    expect(existsSync(new URL('../../src/figma/manifest.json', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../../src/figma/manifest.source.json', import.meta.url))).toBe(true)
  })
})
