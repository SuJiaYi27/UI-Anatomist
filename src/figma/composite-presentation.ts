import type { CompositeToken, ControlToken } from '../shared/schema'
import { isRenderableControlPresentation } from './control-presentation'

type CompositeEvidenceStats = {
  totalLeaves: number
  designerLeaves: number
  structuralDesignerLeaves: number
}

function hasConfirmedUiGraphic(token: ControlToken): boolean {
  const slots = [
    token.slots.leading,
    token.slots.trailing,
    ...(token.slotGroups?.leading ?? []),
    ...(token.slotGroups?.trailing ?? [])
  ]
  return slots.some(slot =>
    slot?.assetType === 'ui-icon' && Boolean(slot.vectorSvg)
  )
}

function controlBindingKey(input: {
  id: string
  instanceId?: string
  state: string
}): string {
  return `${input.id}|${input.instanceId ?? input.id}|${input.state}`
}

function visibleShell(token: CompositeToken): boolean {
  const widths = token.geometry.borderWidths
    ? Object.values(token.geometry.borderWidths)
    : [token.geometry.borderWidth]
  return token.appearance.background.a > 0 ||
    (widths.some(width => width > 0) && token.appearance.border.a > 0) ||
    (token.appearance.outlineWidth > 0 && token.appearance.outline.a > 0) ||
    token.appearance.shadows.some(layer => layer.color.a > 0)
}

function completeShell(token: CompositeToken): boolean {
  const widths = token.geometry.borderWidths
    ? Object.values(token.geometry.borderWidths)
    : Array.from({ length: 4 }, () => token.geometry.borderWidth)
  return token.appearance.background.a > 0 ||
    (widths.every(width => width > 0) && token.appearance.border.a > 0) ||
    (token.appearance.outlineWidth > 0 && token.appearance.outline.a > 0) ||
    token.appearance.shadows.some(layer =>
      layer.kind === 'outer' && layer.color.a > 0
    )
}

function placedMainAxisCoverage(
  token: CompositeToken,
  compositesById: Map<string, CompositeToken>
): number {
  const vertical = token.layout.direction === 'vertical'
  const axisSize = vertical ? token.geometry.height : token.geometry.width
  const startInset = vertical
    ? token.geometry.padding.top
    : token.geometry.padding.left
  const endInset = vertical
    ? token.geometry.padding.bottom
    : token.geometry.padding.right
  const available = Math.max(1, axisSize - startInset - endInset)
  const intervals: Array<{ start: number; end: number }> = []
  const collect = (
    source: CompositeToken,
    offsetX: number,
    offsetY: number,
    scaleX: number,
    scaleY: number,
    visiting: Set<string>
  ): void => {
    if (visiting.has(source.id)) return
    const nextVisiting = new Set(visiting)
    nextVisiting.add(source.id)
    for (const child of source.children) {
      const placement = child.placement
      if (!placement) continue
      const x = offsetX + placement.x * scaleX
      const y = offsetY + placement.y * scaleY
      const width = placement.width * scaleX
      const height = placement.height * scaleY
      if (child.kind === 'control') {
        const rawStart = vertical ? y : x
        const rawSize = vertical ? height : width
        const start = Math.max(startInset, rawStart)
        const end = Math.min(axisSize - endInset, rawStart + rawSize)
        if (end > start) intervals.push({ start, end })
        continue
      }
      const nested = compositesById.get(child.compositeId)
      if (!nested) continue
      collect(
        nested,
        x,
        y,
        scaleX * placement.width / Math.max(1, nested.geometry.width),
        scaleY * placement.height / Math.max(1, nested.geometry.height),
        nextVisiting
      )
    }
  }
  collect(token, 0, 0, 1, 1, new Set())
  intervals.sort((left, right) => left.start - right.start)
  let covered = 0
  let currentStart = -Infinity
  let currentEnd = -Infinity
  for (const interval of intervals) {
    if (interval.start > currentEnd) {
      if (Number.isFinite(currentStart)) covered += currentEnd - currentStart
      currentStart = interval.start
      currentEnd = interval.end
    } else {
      currentEnd = Math.max(currentEnd, interval.end)
    }
  }
  if (Number.isFinite(currentStart)) covered += currentEnd - currentStart
  return covered / available
}

function hasEnclosingBoundary(token: CompositeToken): boolean {
  const widths = token.geometry.borderWidths
    ? Object.values(token.geometry.borderWidths)
    : Array.from({ length: 4 }, () => token.geometry.borderWidth)
  return (widths.every(width => width > 0) && token.appearance.border.a > 0) ||
    (token.appearance.outlineWidth > 0 && token.appearance.outline.a > 0) ||
    token.appearance.shadows.some(layer => layer.color.a > 0)
}

function estimatedTextWidth(
  value: string,
  typography: ControlToken['typography']
): number {
  const characters = Array.from(value)
  const glyphWidth = characters.reduce((sum, character) => {
    const codePoint = character.codePointAt(0) ?? 0
    const scale = character.trim() === ''
      ? 0.33
      : codePoint >= 0x2e80
        ? 1
        : ",.;:!'`|ijlI1()[]".includes(character)
          ? 0.35
          : 'MW@%#'.includes(character) ? 0.8 : 0.58
    return sum + typography.fontSizePx * scale
  }, 0)
  return glyphWidth + Math.max(0, characters.length - 1) *
    typography.letterSpacingPx
}

function estimatedControlWidth(control: ControlToken): number {
  if (control.geometry.minWidth !== null) return control.geometry.minWidth
  const contentWidths: number[] = []
  const leading = [
    ...(control.slots.leading ? [control.slots.leading] : []),
    ...(control.slotGroups?.leading ?? [])
  ]
  const trailing = [
    ...(control.slots.trailing ? [control.slots.trailing] : []),
    ...(control.slotGroups?.trailing ?? [])
  ]
  contentWidths.push(...leading.map(slot => slot.width))
  if (control.sampleText) {
    contentWidths.push(estimatedTextWidth(
      control.sampleText.value,
      control.typography
    ))
  }
  if (control.supportingText && control.supportingStyle) {
    contentWidths.push(estimatedTextWidth(
      control.supportingText.value,
      control.supportingStyle.typography
    ))
  }
  contentWidths.push(...trailing.map(slot => slot.width))
  if (contentWidths.length === 0) return control.geometry.height
  const padding = control.geometry.padding
  const estimated = padding.left + padding.right +
    contentWidths.reduce((sum, width) => sum + width, 0) +
    control.geometry.gap * Math.max(0, contentWidths.length - 1)
  return Math.max(control.geometry.height, estimated)
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  if (ordered.length % 2 === 1) return ordered[middle] ?? 0
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
}

type AxisItem = { start: number; size: number }

function unexplainedAxisGap(
  values: AxisItem[],
  axisSize: number,
  declaredStart: number,
  declaredEnd: number,
  declaredGap: number,
  justify: CompositeToken['layout']['justify'],
  clipsContent: boolean,
  partialWrapLine = false
): boolean {
  if (values.length === 0) return false
  const measured = [...values].sort((left, right) => left.start - right.start)
  const typicalSize = median(measured.map(item => item.size))
  const missingItemThreshold = Math.max(8, typicalSize * 0.75)
  const gaps = measured.slice(1).map((current, index) => {
    const previous = measured[index]!
    return current.start - (previous.start + previous.size)
  })
  const leadingResidual = measured[0]!.start - declaredStart
  const last = measured[measured.length - 1]!
  const trailingResidual = axisSize - last.start - last.size - declaredEnd
  const isLarge = (value: number): boolean =>
    value > 2 && value >= missingItemThreshold

  if (justify === 'space-between' && measured.length > 1) {
    const available = axisSize - declaredStart - declaredEnd
    const expectedGap = (
      available - measured.reduce((sum, item) => sum + item.size, 0)
    ) / (measured.length - 1)
    return isLarge(leadingResidual) || isLarge(trailingResidual) || gaps.some(gap =>
      Math.abs(gap - expectedGap) > 2 &&
      Math.abs(gap - expectedGap) >= missingItemThreshold
    )
  }

  if (gaps.some(gap =>
    gap > declaredGap + 2 &&
    gap - declaredGap >= missingItemThreshold
  )) return true

  if (justify === 'start') {
    return isLarge(leadingResidual) || (
      !clipsContent && !partialWrapLine && isLarge(trailingResidual)
    )
  }
  if (justify === 'end') {
    return isLarge(trailingResidual) || (
      !clipsContent && !partialWrapLine && isLarge(leadingResidual)
    )
  }
  if (justify === 'center') {
    const imbalance = Math.abs(leadingResidual - trailingResidual)
    return imbalance > 2 && imbalance >= missingItemThreshold
  }
  return false
}

function hasUnexplainedWrappedGap(
  token: CompositeToken,
  placements: Array<NonNullable<CompositeToken['children'][number]['placement']>>
): boolean {
  const vertical = token.layout.direction === 'vertical'
  const mainItem = (item: typeof placements[number]): AxisItem => ({
    start: vertical ? item.y : item.x,
    size: vertical ? item.height : item.width
  })
  const crossStart = (item: typeof placements[number]) =>
    vertical ? item.x : item.y
  const crossSize = (item: typeof placements[number]) =>
    vertical ? item.width : item.height
  const lines: Array<{
    start: number
    end: number
    items: typeof placements
  }> = []
  for (const placement of [...placements].sort((left, right) =>
    crossStart(left) - crossStart(right) || mainItem(left).start - mainItem(right).start
  )) {
    const start = crossStart(placement)
    const end = start + crossSize(placement)
    const line = lines.find(candidate =>
      start < candidate.end - 1 && end > candidate.start + 1
    )
    if (line) {
      line.start = Math.min(line.start, start)
      line.end = Math.max(line.end, end)
      line.items.push(placement)
    } else {
      lines.push({ start, end, items: [placement] })
    }
  }
  const mainAxisSize = vertical ? token.geometry.height : token.geometry.width
  const mainStart = vertical ? token.geometry.padding.top : token.geometry.padding.left
  const mainEnd = vertical ? token.geometry.padding.bottom : token.geometry.padding.right
  if (lines.some((line, index) => unexplainedAxisGap(
    line.items.map(mainItem),
    mainAxisSize,
    mainStart,
    mainEnd,
    token.geometry.gap,
    token.layout.justify,
    token.layout.clipsContent ?? false,
    index === lines.length - 1
  ))) return true

  return unexplainedAxisGap(
    lines.map(line => ({ start: line.start, size: line.end - line.start })),
    vertical ? token.geometry.width : token.geometry.height,
    vertical ? token.geometry.padding.left : token.geometry.padding.top,
    vertical ? token.geometry.padding.right : token.geometry.padding.bottom,
    token.geometry.gap,
    'start',
    false
  )
}

function hasUnexplainedLargeGap(token: CompositeToken): boolean {
  const placements = token.children.map(child => child.placement)
  if (placements.some(value => !value) || placements.length < 2) return false
  const measured = placements as Array<NonNullable<typeof placements[number]>>
  if (token.layout.wrap) return hasUnexplainedWrappedGap(token, measured)
  const vertical = token.layout.direction === 'vertical'
  return unexplainedAxisGap(
    measured.map(item => ({
      start: vertical ? item.y : item.x,
      size: vertical ? item.height : item.width
    })),
    vertical ? token.geometry.height : token.geometry.width,
    vertical ? token.geometry.padding.top : token.geometry.padding.left,
    vertical ? token.geometry.padding.bottom : token.geometry.padding.right,
    token.geometry.gap,
    token.layout.justify,
    token.layout.clipsContent ?? false
  )
}

function isEdgeAnchoredSectionPopover(token: CompositeToken): boolean {
  if (
    token.kind !== 'popover' ||
    token.layout.clipsContent !== true ||
    !completeShell(token) ||
    token.children.length < 3 ||
    token.children.some(child => !child.placement)
  ) return false
  const vertical = token.layout.direction === 'vertical'
  const placements = token.children.map(child => child.placement!)
  const starts = placements.map(placement =>
    vertical ? placement.y : placement.x
  )
  if (new Set(starts.map(value => value.toFixed(1))).size < 3) return false
  const ends = placements.map(placement =>
    vertical
      ? placement.y + placement.height
      : placement.x + placement.width
  )
  const axisSize = vertical ? token.geometry.height : token.geometry.width
  const startInset = vertical
    ? token.geometry.padding.top
    : token.geometry.padding.left
  const endInset = vertical
    ? token.geometry.padding.bottom
    : token.geometry.padding.right
  return Math.min(...starts) <= startInset + 2 &&
    Math.max(...ends) >= axisSize - endInset - 2
}

function singletonShellMatches(
  token: CompositeToken,
  control: ControlToken
): boolean {
  if (token.children.length !== 1 || !isRenderableControlPresentation(control)) {
    return false
  }
  const padding = token.geometry.padding
  if (
    padding.left + padding.right <= 0 ||
    padding.top + padding.bottom <= 0 ||
    !visibleShell(token)
  ) return false
  const placement = token.children[0]?.placement
  if (placement) {
    return Math.abs(placement.x - padding.left) <= 2 &&
      Math.abs(placement.y - padding.top) <= 2 &&
      Math.abs(token.geometry.width - placement.x - placement.width - padding.right) <= 2 &&
      Math.abs(token.geometry.height - placement.y - placement.height - padding.bottom) <= 2
  }
  const width = control.geometry.minWidth ?? control.geometry.height
  return Math.abs(
    token.geometry.width - width - padding.left - padding.right
  ) <= 2 && Math.abs(
    token.geometry.height - control.geometry.height - padding.top - padding.bottom
  ) <= 2
}

export function designerFacingCompositeIds(
  composites: CompositeToken[],
  controls: ControlToken[]
): Set<string> {
  const controlsByBinding = new Map(controls.map(token => [
    controlBindingKey(token),
    token
  ]))
  const controlsById = new Map<string, ControlToken[]>()
  for (const token of controls) {
    const values = controlsById.get(token.id) ?? []
    values.push(token)
    controlsById.set(token.id, values)
  }
  const compositesById = new Map(composites.map(token => [token.id, token]))
  const statsById = new Map<string, CompositeEvidenceStats>()
  const visiting = new Set<string>()
  const resolveControl = (child: Extract<CompositeToken['children'][number], {
    kind: 'control'
  }>): ControlToken | undefined => controlsByBinding.get(controlBindingKey({
    id: child.controlId,
    instanceId: child.instanceId,
    state: child.state
  })) ?? (controlsById.get(child.controlId) ?? []).find(token =>
    token.state === child.state
  ) ?? (controlsById.get(child.controlId) ?? [])[0]

  type NaturalSize = { width: number; height: number; iconOnly: boolean }
  const naturalCompositeSize = (
    token: CompositeToken,
    visitingNatural = new Set<string>()
  ): NaturalSize | null => {
    if (visitingNatural.has(token.id)) return null
    if (token.children.some(child => child.placement)) {
      return {
        width: token.geometry.width,
        height: token.geometry.height,
        iconOnly: false
      }
    }
    const nextVisiting = new Set(visitingNatural)
    nextVisiting.add(token.id)
    const sizes = token.children.map(child => {
      if (child.kind === 'control') {
        const control = resolveControl(child)
        return control
          ? {
              width: estimatedControlWidth(control),
              height: control.geometry.height,
              iconOnly: control.content?.kind === 'icon-only'
            }
          : null
      }
      const nested = compositesById.get(child.compositeId)
      return nested ? naturalCompositeSize(nested, nextVisiting) : null
    })
    if (sizes.some(size => !size) || sizes.length === 0) return null
    const measured = sizes as NaturalSize[]
    const padding = token.geometry.padding
    const horizontal = token.layout.direction === 'horizontal'
    return {
      width: horizontal
        ? measured.reduce((sum, size) => sum + size.width, 0) +
          padding.left + padding.right +
          token.geometry.gap * (measured.length - 1)
        : Math.max(...measured.map(size => size.width)) +
          padding.left + padding.right,
      height: horizontal
        ? Math.max(...measured.map(size => size.height)) +
          padding.top + padding.bottom
        : measured.reduce((sum, size) => sum + size.height, 0) +
          padding.top + padding.bottom +
          token.geometry.gap * (measured.length - 1),
      iconOnly: measured.every(size => size.iconOnly)
    }
  }

  const legacyGeometryIsImplausible = (token: CompositeToken): boolean => {
    if (token.children.some(child => child.placement)) return false
    const natural = naturalCompositeSize(token)
    if (!natural || token.children.length < 2) return false
    const horizontal = token.layout.direction === 'horizontal'
    const mainSize = horizontal ? token.geometry.width : token.geometry.height
    const crossSize = horizontal ? token.geometry.height : token.geometry.width
    const naturalMain = horizontal ? natural.width : natural.height
    const naturalCross = horizontal ? natural.height : natural.width
    if (crossSize + 16 < naturalCross) return true
    if (
      !horizontal &&
      token.layout.justify !== 'space-between' &&
      !token.layout.wrap &&
      mainSize > naturalMain + Math.max(96, naturalMain * 0.75)
    ) return true
    return horizontal &&
      natural.iconOnly &&
      !hasEnclosingBoundary(token) &&
      mainSize > Math.max(naturalMain * 4, naturalMain + 128)
  }

  const stats = (token: CompositeToken): CompositeEvidenceStats => {
    const existing = statsById.get(token.id)
    if (existing) return existing
    if (visiting.has(token.id)) {
      return { totalLeaves: 0, designerLeaves: 0, structuralDesignerLeaves: 0 }
    }
    visiting.add(token.id)
    const result = token.children.reduce<CompositeEvidenceStats>((sum, child) => {
      if (child.kind === 'control') {
        const control = resolveControl(child)
        const designer = Boolean(
          control && isRenderableControlPresentation(control)
        )
        return {
          totalLeaves: sum.totalLeaves + 1,
          designerLeaves: sum.designerLeaves + Number(designer),
          structuralDesignerLeaves: sum.structuralDesignerLeaves + Number(
            Boolean(designer || (control && hasConfirmedUiGraphic(control)))
          )
        }
      }
      const nested = compositesById.get(child.compositeId)
      const nestedStats = nested
        ? stats(nested)
        : { totalLeaves: 0, designerLeaves: 0, structuralDesignerLeaves: 0 }
      return {
        totalLeaves: sum.totalLeaves + nestedStats.totalLeaves,
        designerLeaves: sum.designerLeaves + nestedStats.designerLeaves,
        structuralDesignerLeaves: sum.structuralDesignerLeaves +
          nestedStats.structuralDesignerLeaves
      }
    }, { totalLeaves: 0, designerLeaves: 0, structuralDesignerLeaves: 0 })
    visiting.delete(token.id)
    statsById.set(token.id, result)
    return result
  }

  const result = new Set<string>()
  for (const token of composites) {
    const evidence = stats(token)
    const directControl = token.children.length === 1 &&
      token.children[0]?.kind === 'control'
      ? resolveControl(token.children[0])
      : undefined
    const singleton = Boolean(
      directControl && singletonShellMatches(token, directControl)
    )
    const parentReferences = composites.filter(parent =>
      parent.id !== token.id && parent.children.some(child =>
        child.kind === 'composite' && child.compositeId === token.id
      )
    )
    const hasIndependentStateContribution = Boolean(token.logicalCompositeId) &&
      composites.some(candidate =>
        candidate.id !== token.id &&
        candidate.logicalCompositeId === token.logicalCompositeId &&
        candidate.state !== token.state
      )
    // A parent edge says that this shell must survive as internal structure;
    // it does not turn the shell into a reusable asset. State/sample captures
    // can legitimately create several parent tokens for one logical parent,
    // so parent-reference cardinality is not presentation evidence.
    const isInternalSingletonShell = singleton &&
      parentReferences.length > 0 &&
      !hasIndependentStateContribution
    const placementCoverage = placedMainAxisCoverage(token, compositesById)
    const hasMeasuredChild = token.children.some(child => child.placement)
    const hasUnplacedChild = token.children.some(child => !child.placement)
    const partiallyMeasured = hasMeasuredChild && hasUnplacedChild
    const evidenceRich = evidence.designerLeaves >= 2 &&
      evidence.totalLeaves > 0 &&
      evidence.designerLeaves / evidence.totalLeaves >= 0.5 &&
      (!partiallyMeasured || placementCoverage >= 0.6)
    const shellBacked = (
      token.kind === 'popover' || token.kind === 'panel'
    ) && completeShell(token) &&
      evidence.structuralDesignerLeaves >= 3 &&
      placementCoverage >= 0.6
    const sectionGapsAreAnchored = evidenceRich &&
      isEdgeAnchoredSectionPopover(token)
    const reusable = (
      (
        evidenceRich && (
          token.kind === 'control-group' || completeShell(token)
        )
      ) || shellBacked
    ) &&
      (!hasUnexplainedLargeGap(token) || sectionGapsAreAnchored) &&
      !legacyGeometryIsImplausible(token)
    if ((singleton && !isInternalSingletonShell) || reusable) result.add(token.id)
  }
  return result
}
