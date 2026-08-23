import type { ColorValue, ControlToken } from '../shared/schema'
import { controlContentKind } from './control-presentation'

const LIGHT_PREVIEW: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.97, g: 0.97, b: 0.975 }
}

const DARK_PREVIEW: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.08, g: 0.08, b: 0.08 }
}

function linearChannel(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(color: { r: number; g: number; b: number }): number {
  return 0.2126 * linearChannel(color.r) +
    0.7152 * linearChannel(color.g) +
    0.0722 * linearChannel(color.b)
}

function contrastRatio(
  color: ColorValue,
  background: SolidPaint
): number {
  const alpha = Math.max(0, Math.min(1, color.a))
  const composited = {
    r: color.r * alpha + background.color.r * (1 - alpha),
    g: color.g * alpha + background.color.g * (1 - alpha),
    b: color.b * alpha + background.color.b * (1 - alpha)
  }
  const foregroundLuminance = luminance(composited)
  const backgroundLuminance = luminance(background.color)
  return (
    Math.max(foregroundLuminance, backgroundLuminance) + 0.05
  ) / (
    Math.min(foregroundLuminance, backgroundLuminance) + 0.05
  )
}

function representativePaint(token: ControlToken): ColorValue {
  if (token.appearance.foreground.a > 0.05) {
    return token.appearance.foreground
  }
  if (
    token.geometry.borderWidth > 0 &&
    token.appearance.border.a > 0.05
  ) return token.appearance.border
  return token.appearance.outline
}

export function controlNeedsDarkPreview(token: ControlToken): boolean {
  if (token.appearance.background.a >= 0.75) return false
  const paint = representativePaint(token)
  if (paint.a <= 0.05) return false
  return contrastRatio(paint, DARK_PREVIEW) >
    contrastRatio(paint, LIGHT_PREVIEW)
}

export function controlPreviewSurfacePaint(
  tokens: ControlToken[]
): SolidPaint | null {
  return tokens.some(controlNeedsDarkPreview)
    ? DARK_PREVIEW
    : null
}

export function controlPreviewNote(
  token: ControlToken,
  fontAvailable: boolean
): string | null {
  const content = controlContentKind(token)
  if (content === 'icon-only' || content === 'empty') return null
  if (!fontAvailable) {
    return `缺少字体：${token.typography.fontFamilyStack[0] ?? 'unknown'}`
  }
  if (token.appearance.foreground.a <= 0.05) {
    return '前景透明，仅保留结构'
  }
  return null
}
