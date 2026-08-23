import { describe, expect, it } from 'vitest'

import {
  controlFamilyHeading,
  localizeControlContent,
  localizeControlForeground,
  localizeControlIntent,
  localizeControlSize,
  localizeControlState,
  localizeControlSurface
} from '../../src/figma/control-caption-localization'

describe('control caption localization', () => {
  it('keeps top-level control family headings in English', () => {
    expect(controlFamilyHeading('button')).toBe('Button')
    expect(controlFamilyHeading('input')).toBe('Input')
    expect(controlFamilyHeading('textarea')).toBe('Textarea')
  })

  it('translates every designer-facing descriptor into Chinese', () => {
    expect(localizeControlIntent('primary')).toBe('主要')
    expect(localizeControlIntent('tertiary')).toBe('低强调')
    expect(localizeControlSurface('solid-dark')).toBe('深色实底')
    expect(localizeControlSurface('ghost')).toBe('透明底')
    expect(localizeControlSize('xxs')).toBe('极小')
    expect(localizeControlSize('sm')).toBe('小')
    expect(localizeControlForeground('muted')).toBe('弱化字')
    expect(localizeControlContent('icon-only')).toBe('仅图标')
    expect(localizeControlContent('text-only')).toBe('仅文字')
    expect(localizeControlState('pressed')).toBe('按下')
    expect(localizeControlState('focus')).toBe('聚焦')
    expect(localizeControlState('expanded')).toBe('展开')
  })
})
