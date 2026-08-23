import type { ControlSampleText } from '../../shared/schema'
import {
  stableControlInstanceId,
  stableControlLogicalId,
  stableControlTemplateId,
  stableIconId,
  type ControlSignature
} from '../../shared/stable-id'

function structuralSegment(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute('role')?.trim().toLowerCase()
  const semantic = role ? `${tag}[role=${role}]` : tag
  const siblings = element.parentElement
    ? Array.from(element.parentElement.children).filter(sibling => {
        const siblingRole = sibling.getAttribute('role')?.trim().toLowerCase()
        return sibling.tagName.toLowerCase() === tag && siblingRole === role
      })
    : [element]
  return `${semantic}:${Math.max(0, siblings.indexOf(element))}`
}

function structuralControlLocator(element: HTMLElement): string {
  const segments: string[] = []
  let current: Element | null = element
  for (let depth = 0; current && depth < 12; depth += 1) {
    segments.push(structuralSegment(current))
    if (current === element.ownerDocument.body) break
    current = current.parentElement
  }
  return segments.reverse().join('>')
}

export async function anonymousControlLogicalId(
  document: Document,
  element: HTMLElement
): Promise<string> {
  return stableControlLogicalId({
    pageScope: `${document.location.origin}${document.location.pathname}`,
    structuralLocator: structuralControlLocator(element)
  })
}

export async function anonymousDiagnosticPageId(
  document: Document
): Promise<string> {
  return stableControlLogicalId({
    pageScope: `${document.location.origin}${document.location.pathname}`,
    structuralLocator: 'page'
  })
}

async function confirmedSlotIconId(
  slot: ControlSignature['slots']['leading']
): Promise<string | null> {
  if (slot?.assetType !== 'ui-icon' || !slot.vectorSvg) return null
  return stableIconId({ vectorSvg: slot.vectorSvg })
}

export async function controlIdentities(input: {
  document: Document
  element: HTMLElement
  signature: ControlSignature
  sampleText: ControlSampleText | null
  supportingText: ControlSampleText | null
}): Promise<{
  templateId: string
  logicalControlId: string
  instanceId: string
}> {
  const templateId = await stableControlTemplateId(input.signature)
  const logicalControlId = await anonymousControlLogicalId(
    input.document,
    input.element
  )
  const instanceId = await stableControlInstanceId({
    templateId,
    logicalControlId,
    sampleText: input.sampleText?.value ?? null,
    supportingText: input.supportingText?.value ?? null,
    leadingIconId: await confirmedSlotIconId(input.signature.slots.leading),
    trailingIconId: await confirmedSlotIconId(input.signature.slots.trailing)
  })
  return { templateId, logicalControlId, instanceId }
}
