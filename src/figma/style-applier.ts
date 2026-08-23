import type { AvailableFontName } from './font-resolver'
import type { ImportPlanEntry } from './import-plan'
import { readOwnership, writeOwnership } from './ownership'

export const OWNERSHIP_KEY = 'smartScanTypographyOwnership'
export const TYPOGRAPHY_SHARED_NAMESPACE = 'smart.scan.typography'

type LineHeight = { unit: 'AUTO' } | { unit: 'PIXELS'; value: number }
type LetterSpacing = { unit: 'PIXELS'; value: number }

export type TextStylePort = {
  id: string
  name: string
  description: string
  fontName: AvailableFontName
  fontSize: number
  lineHeight: LineHeight
  letterSpacing: LetterSpacing
  setPluginData(key: string, value: string): void
  getPluginData(key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  remove(): void
}

export type TextStyleRepository = {
  loadFont(fontName: AvailableFontName): Promise<void>
  createTextStyle(): TextStylePort
  getTextStyleById(id: string): Promise<TextStylePort | null>
}

export type AppliedStyle = {
  entry: ImportPlanEntry
  style: TextStylePort
}

export type ApplyResult = {
  created: TextStylePort[]
  updated: TextStylePort[]
  applied: AppliedStyle[]
  missingFonts: string[]
  conflicts: string[]
}

type StyleSnapshot = Omit<TextStylePort, 'id' | 'setPluginData' | 'getPluginData' | 'remove'> & {
  ownershipId: string
}

function snapshot(style: TextStylePort): StyleSnapshot {
  return {
    name: style.name,
    description: style.description,
    fontName: style.fontName,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    ownershipId: readOwnership(style, TYPOGRAPHY_SHARED_NAMESPACE, OWNERSHIP_KEY)
  }
}

function restore(style: TextStylePort, previous: StyleSnapshot): void {
  style.name = previous.name
  style.description = previous.description
  style.fontName = previous.fontName
  style.fontSize = previous.fontSize
  style.lineHeight = previous.lineHeight
  style.letterSpacing = previous.letterSpacing
  writeOwnership(
    style,
    TYPOGRAPHY_SHARED_NAMESPACE,
    OWNERSHIP_KEY,
    previous.ownershipId
  )
}

function configureStyle(style: TextStylePort, entry: ImportPlanEntry): void {
  if (!entry.fontName) throw new Error(`字体不可用：${entry.source.fontFamilyStack.join(', ')}`)
  style.name = entry.targetName
  style.description = [
    `UI-Anatomist · ${entry.source.role}`,
    `${entry.source.fontSizePx}px / ${entry.source.fontWeight}`,
    `来源字体栈：${entry.source.fontFamilyStack.join(', ')}`
  ].join('\n')
  style.fontName = entry.fontName
  style.fontSize = entry.source.fontSizePx
  style.lineHeight = entry.source.lineHeightPx === null
    ? { unit: 'AUTO' }
    : { unit: 'PIXELS', value: entry.source.lineHeightPx }
  style.letterSpacing = { unit: 'PIXELS', value: entry.source.letterSpacingPx }
  writeOwnership(style, TYPOGRAPHY_SHARED_NAMESPACE, OWNERSHIP_KEY, entry.ownershipId)
}

export async function applyImportPlan(
  entries: ImportPlanEntry[],
  repository: TextStyleRepository
): Promise<ApplyResult> {
  const result: ApplyResult = {
    created: [],
    updated: [],
    applied: [],
    missingFonts: [],
    conflicts: []
  }

  for (const entry of entries) {
    if (entry.action === 'skip_missing_font') {
      result.missingFonts.push(entry.source.fontFamilyStack[0])
      continue
    }
    if (entry.action === 'skip_conflict') {
      result.conflicts.push(entry.targetName)
      continue
    }
    if (!entry.fontName) continue

    await repository.loadFont(entry.fontName)
    if (entry.action === 'create') {
      const style = repository.createTextStyle()
      try {
        configureStyle(style, entry)
      } catch (error) {
        style.remove()
        throw error
      }
      result.created.push(style)
      result.applied.push({ entry, style })
      continue
    }

    if (!entry.existingStyleId) continue
    const style = await repository.getTextStyleById(entry.existingStyleId)
    if (!style) continue
    const previous = snapshot(style)
    try {
      configureStyle(style, entry)
    } catch (error) {
      restore(style, previous)
      throw error
    }
    result.updated.push(style)
    result.applied.push({ entry, style })
  }

  result.missingFonts = [...new Set(result.missingFonts)]
  result.conflicts = [...new Set(result.conflicts)]
  return result
}
