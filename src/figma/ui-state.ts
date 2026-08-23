export type ImportResultSummary = {
  typographyCreated: number
  typographyUpdated: number
  typographyRemoved: number
  radiusCreated: number
  radiusUpdated: number
  radiusRemoved: number
  shadowCreated: number
  shadowUpdated: number
  shadowRemoved: number
  colorCreated: number
  colorUpdated: number
  colorRemoved: number
  spacingCreated: number
  spacingUpdated: number
  spacingRemoved: number
  controlCreated: number
  controlUpdated: number
  controlRemoved: number
  compositeCreated?: number
  compositeUpdated?: number
  compositeRemoved?: number
  iconCreated?: number
  iconUpdated?: number
  iconRemoved?: number
  missingFonts: string[]
  typographyConflicts: string[]
  radiusConflicts: string[]
  shadowConflicts: string[]
  colorConflicts: string[]
  spacingConflicts: string[]
  controlConflicts: string[]
  compositeConflicts?: string[]
  iconConflicts?: string[]
  percentageRadii: number
  staleCleanupSkipped: boolean
}

export function importButtonEnabled(value: string): boolean {
  return value.trim().length > 0
}

export function resultMessage(result: ImportResultSummary): string {
  const typography = result.typographyCreated + result.typographyUpdated
  const radii = result.radiusCreated + result.radiusUpdated
  const shadows = result.shadowCreated + result.shadowUpdated
  const colors = result.colorCreated + result.colorUpdated
  const spacing = result.spacingCreated + result.spacingUpdated
  const controls = result.controlCreated + result.controlUpdated
  const composites = (result.compositeCreated ?? 0) + (result.compositeUpdated ?? 0)
  const compositeSummary = result.compositeCreated === undefined &&
    result.compositeUpdated === undefined
    ? ''
    : `、${composites} 个复合组件`
  const icons = (result.iconCreated ?? 0) + (result.iconUpdated ?? 0)
  const iconSummary = result.iconCreated === undefined && result.iconUpdated === undefined
    ? ''
    : `、${icons} 个图标组件集`
  const conflicts = result.typographyConflicts.length + result.radiusConflicts.length +
    result.shadowConflicts.length + result.colorConflicts.length +
    result.spacingConflicts.length + result.controlConflicts.length +
    (result.compositeConflicts?.length ?? 0) +
    (result.iconConflicts?.length ?? 0)
  let message = `已导入 ${typography} 个文字样式、${radii} 个圆角变量、${shadows} 个阴影样式、${colors} 个颜色变量、${spacing} 个间距变量、${controls} 个交互控件${compositeSummary}${iconSummary}`
  if (result.percentageRadii > 0) {
    message += `；${result.percentageRadii} 个百分比圆角已保留在画板中`
  }
  if (
    result.typographyRemoved > 0 || result.radiusRemoved > 0 ||
    result.shadowRemoved > 0 || result.colorRemoved > 0 || result.spacingRemoved > 0 ||
    result.controlRemoved > 0 || (result.compositeRemoved ?? 0) > 0 ||
    (result.iconRemoved ?? 0) > 0
  ) {
    const iconRemovedSummary = result.iconRemoved === undefined
      ? ''
      : `、${result.iconRemoved} 个旧图标组件集`
    const compositeRemovedSummary = result.compositeRemoved === undefined
      ? ''
      : `、${result.compositeRemoved} 个旧复合组件`
    message += `；已替换 ${result.typographyRemoved} 个旧文字样式、${result.radiusRemoved} 个旧圆角变量、${result.shadowRemoved} 个旧阴影样式、${result.colorRemoved} 个旧颜色变量、${result.spacingRemoved} 个旧间距变量、${result.controlRemoved} 个旧交互控件${compositeRemovedSummary}${iconRemovedSummary}`
  }
  if (result.staleCleanupSkipped) {
    message += '；扫描存在未完成页面，本次未清理旧资产'
  }
  if (result.missingFonts.length > 0) {
    message += `；缺少字体：${result.missingFonts.join('、')}`
  }
  if (conflicts > 0) {
    message += `；${conflicts} 个同名用户资产未被覆盖`
  }
  if (result.missingFonts.length > 0 || conflicts > 0 || result.staleCleanupSkipped) {
    return `${message}。其他样式未受影响。`
  }
  return `${message}；设计系统画板已生成。`
}
