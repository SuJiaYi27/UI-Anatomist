import type { AppliedIcon } from './icon-component-applier'

/**
 * Chooses the invariant icon identity for catalog specimens. Interaction
 * surfaces remain available on the underlying asset, but are not a catalog
 * preview fallback.
 */
export function iconIdentityPreviewComponent(item: AppliedIcon): ComponentNode {
  const { entry, components } = item
  if (entry.assetKind === 'component-set') {
    const glyphIndex = entry.states.indexOf('Glyph')
    if (
      item.asset.type !== 'COMPONENT_SET' ||
      item.componentSet === null ||
      glyphIndex < 0 ||
      components.length !== entry.states.length
    ) {
      throw new Error('Icon Component Set 缺少一致的 Glyph identity variant。')
    }
    const glyph = components[glyphIndex]
    if (!glyph || typeof (glyph as ComponentNode).createInstance !== 'function') {
      throw new Error('Icon Component Set 缺少可实例化的 Glyph identity variant。')
    }
    return glyph as unknown as ComponentNode
  }

  const component = components[0]
  if (
    entry.states.length !== 1 ||
    components.length !== 1 ||
    !component ||
    typeof (component as ComponentNode).createInstance !== 'function'
  ) {
    throw new Error('Glyph-only Icon Component 缺少唯一可实例化 identity。')
  }
  return component as unknown as ComponentNode
}
