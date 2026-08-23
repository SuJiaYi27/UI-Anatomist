import type {
  CompositeKind,
  CompositeState,
  ControlContentKind,
  ControlFamily,
  ControlIntent,
  ControlState
} from '../shared/schema'
import type {
  ControlPresentationForeground,
  ControlPresentationSize,
  ControlPresentationSurface
} from './control-presentation'

const families: Record<ControlFamily, string> = {
  button: 'Button',
  input: 'Input',
  textarea: 'Textarea',
  select: 'Select',
  toggle: 'Toggle',
  checkbox: 'Checkbox',
  radio: 'Radio'
}

const intents: Record<ControlIntent, string> = {
  primary: '主要',
  secondary: '次要',
  tertiary: '低强调',
  danger: '危险',
  neutral: '中性',
  other: '其他'
}

const surfaces: Record<ControlPresentationSurface, string> = {
  ghost: '透明底',
  outline: '描边',
  soft: '柔和底',
  'solid-light': '浅色实底',
  'solid-dark': '深色实底',
  accent: '强调色'
}

const sizes: Record<ControlPresentationSize, string> = {
  xxs: '极小',
  xs: '超小',
  sm: '小',
  md: '中',
  lg: '大',
  xl: '超大'
}

const foregrounds: Record<ControlPresentationForeground, string> = {
  dark: '深色字',
  muted: '弱化字',
  light: '浅色字',
  accent: '强调字'
}

const contents: Record<ControlContentKind, string> = {
  'text-only': '仅文字',
  'icon-only': '仅图标',
  'icon-leading': '前置图标',
  'icon-trailing': '后置图标',
  'icon-both': '双侧图标',
  'compound-row': '复合菜单项',
  'compound-input': '复合输入框',
  empty: '空内容'
}

const states: Record<ControlState, string> = {
  default: '默认',
  hover: '悬浮',
  focus: '聚焦',
  pressed: '按下',
  selected: '选中',
  expanded: '展开',
  disabled: '禁用'
}

const compositeKinds: Record<CompositeKind, string> = {
  menu: '菜单',
  list: '列表',
  toolbar: '工具栏',
  'control-group': '控件组',
  panel: '面板',
  popover: '浮层'
}

const compositeStates: Record<CompositeState, string> = {
  default: '默认',
  hover: '悬浮',
  focus: '聚焦',
  pressed: '按下',
  selected: '选中',
  expanded: '展开',
  disabled: '禁用'
}

export const controlFamilyHeading = (value: ControlFamily): string => families[value]
export const localizeControlIntent = (value: ControlIntent): string => intents[value]
export const localizeControlSurface = (
  value: ControlPresentationSurface
): string => surfaces[value]
export const localizeControlSize = (value: ControlPresentationSize): string => sizes[value]
export const localizeControlForeground = (
  value: ControlPresentationForeground
): string => foregrounds[value]
export const localizeControlContent = (value: ControlContentKind): string => contents[value]
export const localizeControlState = (value: ControlState): string => states[value]
export const localizeCompositeKind = (value: CompositeKind): string =>
  compositeKinds[value]
export const localizeCompositeState = (value: CompositeState): string =>
  compositeStates[value]
export const localizeCompositeDirection = (
  value: 'horizontal' | 'vertical'
): string => value === 'vertical' ? '纵向' : '横向'
export const localizeWidthBehavior = (
  value: 'hug' | 'fill'
): string => value === 'fill' ? '填充宽度' : '内容宽度'
