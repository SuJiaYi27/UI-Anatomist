import { createImportPlan } from './import-plan'
import {
  buildTypographyBoard,
  TYPOGRAPHY_BOARD_OWNERSHIP_KEY
} from './board-builder'
import {
  applyImportPlan,
  OWNERSHIP_KEY,
  TYPOGRAPHY_SHARED_NAMESPACE,
  type TextStylePort
} from './style-applier'
import { createRadiusImportPlan } from './radius-import-plan'
import {
  buildRadiusBoard,
  RADIUS_BOARD_OWNERSHIP_KEY
} from './radius-board-builder'
import {
  applyRadiusImportPlan,
  RADIUS_COLLECTION_OWNERSHIP_KEY,
  RADIUS_SHARED_NAMESPACE,
  RADIUS_VARIABLE_OWNERSHIP_KEY,
  type RadiusCollectionPort,
  type RadiusVariablePort
} from './radius-variable-applier'
import { resultMessage } from './ui-state'
import { beginImportTransaction, type ImportTransaction } from './import-transaction'
import { createStaleAssetPlan, removeStaleAssets } from './stale-assets'
import { createShadowImportPlan } from './shadow-import-plan'
import {
  applyShadowImportPlan,
  SHADOW_OWNERSHIP_KEY,
  SHADOW_SHARED_NAMESPACE,
  type EffectStylePort
} from './shadow-style-applier'
import {
  buildShadowBoard,
  SHADOW_BOARD_OWNERSHIP_KEY
} from './shadow-board-builder'
import { createColorImportPlan } from './color-import-plan'
import {
  applyColorImportPlan,
  COLOR_COLLECTION_OWNERSHIP_KEY,
  COLOR_VARIABLE_OWNERSHIP_KEY,
  readColorOwnership,
  type ColorCollectionPort,
  type ColorVariablePort
} from './color-variable-applier'
import {
  buildColorBoards,
  COLOR_BOARD_OWNERSHIP_KEY
} from './color-board-builder'
import { createSpacingImportPlan } from './spacing-import-plan'
import {
  applySpacingImportPlan,
  SPACING_COLLECTION_OWNERSHIP_KEY,
  SPACING_SHARED_NAMESPACE,
  SPACING_VARIABLE_OWNERSHIP_KEY,
  type SpacingCollectionPort,
  type SpacingVariablePort
} from './spacing-variable-applier'
import {
  buildSpacingBoard,
  SPACING_BOARD_OWNERSHIP_KEY
} from './spacing-board-builder'
import { createControlImportPlan } from './control-import-plan'
import {
  applyControlImportPlan,
  CONTROL_GROUP_OWNERSHIP_KEY,
  CONTROL_NODE_OWNERSHIP_KEY,
  readControlOwnership,
  reflowAppliedControlComponentSets,
  type ControlComponentPort,
  type ControlComponentSetPort,
  type ControlFramePort,
  type ControlIconInstancePort,
  type ControlNodePort,
  type ControlRectanglePort,
  type ControlTextPort
} from './control-component-applier'
import { createCompositeImportPlan } from './composite-import-plan'
import {
  applyCompositeImportPlan,
  COMPOSITE_GROUP_OWNERSHIP_KEY,
  COMPOSITE_NODE_OWNERSHIP_KEY,
  readCompositeOwnership,
  reflowAppliedCompositeComponentSets,
  type CompositeComponentPort,
  type CompositeComponentSetPort,
  type CompositeInstancePort
} from './composite-component-applier'
import {
  buildControlBoard,
  CONTROL_BOARD_OWNERSHIP_KEY
} from './control-board-builder'
import {
  buildControlMasterBoard,
  CONTROL_MASTER_BOARD_OWNERSHIP_KEY
} from './control-master-board-builder'
import { createIconImportPlan } from './icon-import-plan'
import {
  applyIconVariablePlan,
  createIconVariablePlan,
  ICON_COLLECTION_OWNERSHIP_KEY,
  ICON_VARIABLE_OWNERSHIP_KEY,
  readIconOwnership,
  type IconCollectionPort,
  type IconVariablePort
} from './icon-variable-applier'
import {
  applyIconImportPlan,
  iconSvgKey,
  ICON_NODE_OWNERSHIP_KEY,
  type IconComponentPort,
  type IconComponentSetPort,
  type IconFramePort,
  type IconRectanglePort,
  type IconVectorPort
} from './icon-component-applier'
import {
  buildIconBoard,
  ICON_BOARD_OWNERSHIP_KEY,
  removeOwnedIconBoard
} from './icon-board-builder'
import {
  buildIconMasterBoard,
  ICON_MASTER_BOARD_OWNERSHIP_KEY,
  removeOwnedIconMasterBoard
} from './icon-master-board-builder'
import {
  finalizeBoardsSafeAreaSettled,
  fitBoardToContentSettled,
  layoutBoardRows,
  type ResizableBoard
} from './board-safety'
import { planBoardClusterAnchor } from './board-cluster-position'
import {
  canReuseIconComponentInControl,
  iconThemeForForeground
} from './icon-theme-match'
import { readOwnership } from './ownership'
import { supportsFigmaBoardCapability } from './schema-board-capabilities'

function boardBelongsToOrigin(node: FrameNode, origin: string): boolean {
  return [
    readOwnership(node, TYPOGRAPHY_SHARED_NAMESPACE, TYPOGRAPHY_BOARD_OWNERSHIP_KEY),
    readOwnership(node, RADIUS_SHARED_NAMESPACE, RADIUS_BOARD_OWNERSHIP_KEY),
    readOwnership(node, SHADOW_SHARED_NAMESPACE, SHADOW_BOARD_OWNERSHIP_KEY),
    readOwnership(node, SPACING_SHARED_NAMESPACE, SPACING_BOARD_OWNERSHIP_KEY),
    readColorOwnership(node, COLOR_BOARD_OWNERSHIP_KEY),
    readControlOwnership(node, CONTROL_BOARD_OWNERSHIP_KEY),
    readControlOwnership(node, CONTROL_MASTER_BOARD_OWNERSHIP_KEY),
    readIconOwnership(node, ICON_BOARD_OWNERSHIP_KEY),
    readIconOwnership(node, ICON_MASTER_BOARD_OWNERSHIP_KEY)
  ].includes(origin)
}

function backupComponentChildren(
  component: ComponentNode,
  name: string
): FrameNode {
  const backup = figma.createFrame()
  const children = [...component.children]
  try {
    backup.name = name
    backup.visible = false
    for (const child of children) backup.appendChild(child)
    return backup
  } catch (error) {
    for (const child of children) {
      try { component.appendChild(child) } catch { /* preserve every recoverable child */ }
    }
    if (backup.children.length === 0) {
      try { backup.remove() } catch { /* retain rollback evidence if Figma refuses */ }
    }
    throw error
  }
}

figma.showUI(__html__, { width: 360, height: 420, themeColors: true })

figma.ui.onmessage = async (message: { type?: string; json?: string }) => {
  if (message.type !== 'IMPORT_JSON' || typeof message.json !== 'string') return

  let transaction: ImportTransaction | null = null
  try {
    transaction = beginImportTransaction(message.json, {
      commitUndo: () => figma.commitUndo(),
      triggerUndo: () => figma.triggerUndo()
    })
    const data = transaction.data
    const existingSourceBoards = figma.currentPage.children.filter(node =>
      node.type === 'FRAME' &&
      boardBelongsToOrigin(node, data.source.origin)
    ) as FrameNode[]
    const existingBoardClusterAnchor = existingSourceBoards.length > 0
      ? {
          x: Math.min(...existingSourceBoards.map(board => board.x)),
          y: Math.min(...existingSourceBoards.map(board => board.y))
        }
      : null

    const available = (await figma.listAvailableFontsAsync()).map(font => font.fontName)
    const existing = (await figma.getLocalTextStylesAsync()).map(style => ({
      id: style.id,
      name: style.name,
      ownershipId:
        readOwnership(style, TYPOGRAPHY_SHARED_NAMESPACE, OWNERSHIP_KEY) || null
    }))
    const existingEffects = (await figma.getLocalEffectStylesAsync()).map(style => ({
      id: style.id,
      name: style.name,
      ownershipId:
        readOwnership(style, SHADOW_SHARED_NAMESPACE, SHADOW_OWNERSHIP_KEY) || null
    }))
    const existingControlNodes = figma.currentPage.findAll(node =>
      node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
    ).map(node => ({
      id: node.id,
      type: node.type as 'COMPONENT' | 'COMPONENT_SET',
      name: node.name,
      ownershipId: readControlOwnership(node, CONTROL_NODE_OWNERSHIP_KEY) || null,
      groupOwnershipId: readControlOwnership(node, CONTROL_GROUP_OWNERSHIP_KEY) || null
    }))
    const existingCompositeNodes = figma.currentPage.findAll(node =>
      node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
    ).map(node => ({
      id: node.id,
      type: node.type as 'COMPONENT' | 'COMPONENT_SET',
      name: node.name,
      ownershipId:
        readCompositeOwnership(node, COMPOSITE_NODE_OWNERSHIP_KEY) || null,
      groupOwnershipId:
        readCompositeOwnership(node, COMPOSITE_GROUP_OWNERSHIP_KEY) || null
    }))
    const existingIconNodes = figma.currentPage.findAll(node =>
      node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
    ).map(node => ({
      id: node.id,
      type: node.type as 'COMPONENT' | 'COMPONENT_SET',
      name: node.name,
      ownershipId: readIconOwnership(node, ICON_NODE_OWNERSHIP_KEY) || null
    }))
    const plan = createImportPlan(data, available, existing)
    const applied = await applyImportPlan(plan.entries, {
      loadFont: fontName => figma.loadFontAsync(fontName),
      createTextStyle: () => figma.createTextStyle() as TextStylePort,
      getTextStyleById: async id => {
        const style = await figma.getStyleByIdAsync(id)
        return style?.type === 'TEXT' ? style as TextStylePort : null
      }
    })

    const collections = await figma.variables.getLocalVariableCollectionsAsync()
    const variables = await figma.variables.getLocalVariablesAsync()
    const radiusPlan = createRadiusImportPlan(
      data,
      collections.map(collection => ({
        id: collection.id,
        name: collection.name,
        defaultModeId: collection.defaultModeId,
        ownershipOrigin:
          readOwnership(
            collection,
            RADIUS_SHARED_NAMESPACE,
            RADIUS_COLLECTION_OWNERSHIP_KEY
          ) || null
      })),
      variables.map(variable => ({
        id: variable.id,
        name: variable.name,
        collectionId: variable.variableCollectionId,
        resolvedType: variable.resolvedType,
        ownershipId:
          readOwnership(
            variable,
            RADIUS_SHARED_NAMESPACE,
            RADIUS_VARIABLE_OWNERSHIP_KEY
          ) || null
      }))
    )
    const colorPlan = createColorImportPlan(
      data,
      collections.map(collection => ({
        id: collection.id,
        name: collection.name,
        defaultModeId: collection.defaultModeId,
        ownershipOrigin: readColorOwnership(collection, COLOR_COLLECTION_OWNERSHIP_KEY) || null
      })),
      variables.map(variable => ({
        id: variable.id,
        name: variable.name,
        collectionId: variable.variableCollectionId,
        resolvedType: variable.resolvedType,
        ownershipId: readColorOwnership(variable, COLOR_VARIABLE_OWNERSHIP_KEY) || null
      }))
    )
    const spacingPlan = createSpacingImportPlan(
      data,
      collections.map(collection => ({
        id: collection.id,
        name: collection.name,
        defaultModeId: collection.defaultModeId,
        ownershipOrigin:
          readOwnership(
            collection,
            SPACING_SHARED_NAMESPACE,
            SPACING_COLLECTION_OWNERSHIP_KEY
          ) || null
      })),
      variables.map(variable => ({
        id: variable.id,
        name: variable.name,
        collectionId: variable.variableCollectionId,
        resolvedType: variable.resolvedType,
        ownershipId:
          readOwnership(
            variable,
            SPACING_SHARED_NAMESPACE,
            SPACING_VARIABLE_OWNERSHIP_KEY
          ) || null
      }))
    )
    const controlPlan = createControlImportPlan(data, existingControlNodes, available)
    const compositePlan = createCompositeImportPlan(
      data,
      controlPlan,
      existingCompositeNodes,
      available
    )
    const iconPlan = createIconImportPlan(data, existingIconNodes)
    const iconVariablePlan = createIconVariablePlan(
      data,
      collections.map(collection => ({
        id: collection.id,
        name: collection.name,
        defaultModeId: collection.defaultModeId,
        modes: collection.modes,
        ownershipOrigin: readIconOwnership(collection, ICON_COLLECTION_OWNERSHIP_KEY) || null
      })),
      variables.map(variable => ({
        id: variable.id,
        name: variable.name,
        collectionId: variable.variableCollectionId,
        resolvedType: variable.resolvedType,
        ownershipId: readIconOwnership(variable, ICON_VARIABLE_OWNERSHIP_KEY) || null
      }))
    )
    const staleAssetPlan = createStaleAssetPlan(
      data,
      existing.map(style => ({ id: style.id, ownershipId: style.ownershipId })),
      variables.map(variable => ({
        id: variable.id,
        ownershipId:
          readOwnership(
            variable,
            RADIUS_SHARED_NAMESPACE,
            RADIUS_VARIABLE_OWNERSHIP_KEY
          ) || null
      })),
      existingEffects.map(style => ({ id: style.id, ownershipId: style.ownershipId })),
      variables.map(variable => ({
        id: variable.id,
        ownershipId: readColorOwnership(variable, COLOR_VARIABLE_OWNERSHIP_KEY) || null
      })),
      variables.map(variable => ({
        id: variable.id,
        ownershipId:
          readOwnership(
            variable,
            SPACING_SHARED_NAMESPACE,
            SPACING_VARIABLE_OWNERSHIP_KEY
          ) || null
      })),
      existingControlNodes.map(node => ({
        id: node.id,
        ownershipId: node.ownershipId ?? node.groupOwnershipId
      })),
      variables.map(variable => ({
        id: variable.id,
        ownershipId: readIconOwnership(variable, ICON_VARIABLE_OWNERSHIP_KEY) || null
      })),
      existingIconNodes.map(node => ({
        id: node.id,
        ownershipId: node.ownershipId
      })),
      existingCompositeNodes.map(node => ({
        id: node.id,
        ownershipId: node.ownershipId ?? node.groupOwnershipId
      }))
    )
    const collectionById = new Map(collections.map(collection => [collection.id, collection]))
    const radiusApplied = await applyRadiusImportPlan(radiusPlan, {
      createCollection: name => {
        const collection = figma.variables.createVariableCollection(name)
        collectionById.set(collection.id, collection)
        return collection as unknown as RadiusCollectionPort
      },
      createVariable: (name, collectionId, resolvedType) => {
        const collection = collectionById.get(collectionId)
        if (!collection) throw new Error('无法找到 UI-Anatomist 圆角变量集合。')
        return figma.variables.createVariable(name, collection, resolvedType) as unknown as RadiusVariablePort
      },
      getVariableById: async id =>
        await figma.variables.getVariableByIdAsync(id) as unknown as RadiusVariablePort | null
    })

    const shadowPlan = createShadowImportPlan(data, existingEffects)
    const shadowApplied = await applyShadowImportPlan(shadowPlan.entries, {
      createEffectStyle: () => figma.createEffectStyle() as unknown as EffectStylePort,
      getEffectStyleById: async id => {
        const style = await figma.getStyleByIdAsync(id)
        return style?.type === 'EFFECT' ? style as unknown as EffectStylePort : null
      }
    })
    const colorApplied = await applyColorImportPlan(colorPlan, {
      createCollection: name => {
        const collection = figma.variables.createVariableCollection(name)
        collectionById.set(collection.id, collection)
        return collection as unknown as ColorCollectionPort
      },
      createVariable: (name, collectionId, resolvedType) => {
        const collection = collectionById.get(collectionId)
        if (!collection) throw new Error('无法找到 UI-Anatomist 颜色变量集合。')
        return figma.variables.createVariable(
          name,
          collection,
          resolvedType
        ) as unknown as ColorVariablePort
      },
      getVariableById: async id =>
        await figma.variables.getVariableByIdAsync(id) as unknown as ColorVariablePort | null
    })
    const spacingApplied = await applySpacingImportPlan(spacingPlan, {
      createCollection: name => {
        const collection = figma.variables.createVariableCollection(name)
        collectionById.set(collection.id, collection)
        return collection as unknown as SpacingCollectionPort
      },
      createVariable: (name, collectionId, resolvedType) => {
        const collection = collectionById.get(collectionId)
        if (!collection) throw new Error('无法找到 UI-Anatomist 间距变量集合。')
        return figma.variables.createVariable(
          name,
          collection,
          resolvedType
        ) as unknown as SpacingVariablePort
      },
      getVariableById: async id =>
        await figma.variables.getVariableByIdAsync(id) as unknown as
          SpacingVariablePort | null
    })
    const iconVariablesApplied = await applyIconVariablePlan(iconVariablePlan, {
      createCollection: name => {
        const collection = figma.variables.createVariableCollection(name)
        collectionById.set(collection.id, collection)
        return collection as unknown as IconCollectionPort
      },
      createVariable: (name, collectionId, resolvedType) => {
        const collection = collectionById.get(collectionId)
        if (!collection) throw new Error('无法找到 UI-Anatomist Icon Colors 变量集合。')
        return figma.variables.createVariable(
          name,
          collection,
          resolvedType
        ) as unknown as IconVariablePort
      },
      getVariableById: async id =>
        await figma.variables.getVariableByIdAsync(id) as unknown as
          IconVariablePort | null
    })
    const iconPrimary = iconVariablesApplied.applied
      .find(item => item.entry.role === 'primary')?.variable ?? null
    const iconDefaultById = new Map(
      iconVariablesApplied.applied
        .filter(item =>
          item.entry.role === 'default-background' &&
          item.entry.iconId
        )
        .map(item => [item.entry.iconId!, item.variable])
    )
    const iconHoverById = new Map(
      iconVariablesApplied.applied
        .filter(item =>
          item.entry.role === 'hover-background' &&
          item.entry.iconId
        )
        .map(item => [item.entry.iconId!, item.variable])
    )
    const iconAccentById = new Map(
      iconVariablesApplied.applied
        .filter(item => item.entry.role === 'accent' && item.entry.iconId)
        .map(item => [item.entry.iconId!, item.variable])
    )
    const iconApplied = await applyIconImportPlan(iconPlan, {
      createComponent: () =>
        figma.createComponent() as unknown as IconComponentPort,
      createRectangle: () =>
        figma.createRectangle() as unknown as IconRectanglePort,
      createNodeFromSvg: svg =>
        figma.createNodeFromSvg(svg) as unknown as IconFramePort,
      flatten: nodes =>
        figma.flatten(nodes as unknown as SceneNode[]) as unknown as IconVectorPort,
      combineAsVariants: components =>
        figma.combineAsVariants(
          components as unknown as ComponentNode[],
          figma.currentPage
        ) as unknown as IconComponentSetPort,
      getNodeById: async id => {
        const node = await figma.getNodeByIdAsync(id)
        return node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
          ? node as unknown as IconComponentPort | IconComponentSetPort
          : null
      },
      bindVectorColor: (vector, variable) => {
        const resolved = iconVariablesApplied.applied
          .find(item => item.variable.id === variable.id)?.variable
        if (!resolved) return
        const figmaVariable = resolved as unknown as Variable
        const node = vector as unknown as VectorNode
        const fallbackPaint: SolidPaint = {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0 }
        }
        const fillPaints = Array.isArray(node.fills)
          ? node.fills
          : [fallbackPaint]
        const strokePaints = Array.isArray(node.strokes)
          ? node.strokes
          : [fallbackPaint]
        node.fills = fillPaints.map(paint =>
          paint.type === 'SOLID'
            ? figma.variables.setBoundVariableForPaint(paint, 'color', figmaVariable)
            : paint
        )
        node.strokes = strokePaints.map(paint =>
          paint.type === 'SOLID'
            ? figma.variables.setBoundVariableForPaint(paint, 'color', figmaVariable)
            : paint
        )
      },
      bindRectangleColor: (rectangle, variable) => {
        const resolved = iconVariablesApplied.applied
          .find(item => item.variable.id === variable.id)?.variable
        if (!resolved) return
        const paint: SolidPaint = {
          type: 'SOLID',
          color: { r: 1, g: 1, b: 1 }
        }
        ;(rectangle as unknown as RectangleNode).fills = [
          figma.variables.setBoundVariableForPaint(
            paint,
            'color',
            resolved as unknown as Variable
          )
        ]
      }
    }, {
      primary: iconPrimary,
      defaultBackgroundByIconId: iconDefaultById,
      hoverBackgroundByIconId: iconHoverById,
      accentByIconId: iconAccentById
    })
    const iconCollectionId =
      iconVariablesApplied.collection?.id ??
      iconVariablePlan.collection.existingCollectionId
    const iconCollection = iconCollectionId
      ? collectionById.get(iconCollectionId)
      : undefined
    const defaultIconBySvg = new Map(
      iconApplied.applied.map(item => [
        iconSvgKey(item.entry.source.vectorSvg),
        {
          component: (
            item.components.find(component => component.name === 'State=Glyph') ??
            item.components[0]
          ) as unknown as ComponentNode,
          source: item.entry.source
        }
      ])
    )
    const createSharedIconInstance = (
      svg: string,
      foreground: import('../shared/schema').ColorValue
    ): ControlIconInstancePort | null => {
      const match = defaultIconBySvg.get(iconSvgKey(svg))
      const theme = match && canReuseIconComponentInControl(match.source)
        ? iconThemeForForeground(match.source, foreground)
        : null
      const modeId = theme
        ? iconVariablesApplied.modeIds[theme]
        : null
      if (!match || !modeId || !iconCollection) return null
      const instance = match.component.createInstance()
      try {
        instance.setExplicitVariableModeForCollection(
          iconCollection,
          modeId
        )
        return instance as unknown as ControlIconInstancePort
      } catch (error) {
        try { instance.remove() } catch { /* retain the original mode error */ }
        throw error
      }
    }
    const controlApplied = await applyControlImportPlan(controlPlan, {
      createComponent: () =>
        figma.createComponent() as unknown as ControlComponentPort,
      createText: () => figma.createText() as unknown as ControlTextPort,
      createRectangle: () =>
        figma.createRectangle() as unknown as ControlRectanglePort,
      createFrame: () =>
        figma.createFrame() as unknown as ControlFramePort,
      createNodeFromSvg: svg =>
        figma.createNodeFromSvg(svg) as unknown as ControlFramePort,
      createIconInstance: createSharedIconInstance,
      prepareForVariantCombine: components => {
        for (const component of components as unknown as ComponentNode[]) {
          if (component.parent !== figma.currentPage) {
            figma.currentPage.appendChild(component)
          }
        }
      },
      combineAsVariants: components =>
        figma.combineAsVariants(
          components as unknown as ComponentNode[],
          figma.currentPage
        ) as unknown as ControlComponentSetPort,
      appendToComponentSet: (set, component) => {
        (set as unknown as ComponentSetNode)
          .appendChild(component as unknown as ComponentNode)
      },
      clearChildren: component => {
        for (const child of [...(component as unknown as ComponentNode).children]) {
          child.remove()
        }
      },
      backupChildren: component => {
        return backupComponentChildren(
          component as unknown as ComponentNode,
          'UI-Anatomist / Control rollback backup'
        )
      },
      restoreChildren: (component, value) => {
        const backup = value as FrameNode
        for (const child of [...(component as unknown as ComponentNode).children]) {
          child.remove()
        }
        for (const child of [...backup.children]) {
          (component as unknown as ComponentNode).appendChild(child)
        }
      },
      discardChildrenBackup: value => {
        (value as FrameNode).remove()
      },
      backupPlacement: component => {
        const node = component as unknown as ComponentNode
        return { parent: node.parent, x: node.x, y: node.y }
      },
      restorePlacement: (component, value) => {
        const node = component as unknown as ComponentNode
        const placement = value as {
          parent: (BaseNode & ChildrenMixin) | null
          x: number
          y: number
        }
        placement.parent?.appendChild(node)
        node.x = placement.x
        node.y = placement.y
      },
      getNodeById: async id => {
        const node = await figma.getNodeByIdAsync(id)
        return node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
          ? node as unknown as ControlNodePort
          : null
      },
      loadFont: fontName => figma.loadFontAsync(fontName)
    })

    const compositeApplied = await applyCompositeImportPlan(
      compositePlan,
      controlApplied.applied,
      {
        createComponent: () =>
          figma.createComponent() as unknown as CompositeComponentPort,
        createInstance: component =>
          (component as unknown as ComponentNode).createInstance() as unknown as
            CompositeInstancePort,
        createFrame: () =>
          figma.createFrame() as unknown as ControlFramePort,
        createText: () =>
          figma.createText() as unknown as ControlTextPort,
        loadFont: fontName => figma.loadFontAsync(fontName),
        createIconInstance: createSharedIconInstance,
        overrideText: async (instance, nodeName, value) => {
          const text = (instance as unknown as InstanceNode).findOne(node =>
            node.type === 'TEXT' && node.name === nodeName
          )
          if (text?.type !== 'TEXT') return
          if (text.fontName !== figma.mixed) {
            await figma.loadFontAsync(text.fontName)
          }
          text.characters = value
        },
        overrideIcon: (instance, nodeName, slot, foreground) => {
          if (!slot.vectorSvg) return
          const target = (instance as unknown as InstanceNode).findOne(node =>
            node.type === 'INSTANCE' && node.name === nodeName
          )
          const match = defaultIconBySvg.get(iconSvgKey(slot.vectorSvg))
          const theme = match && canReuseIconComponentInControl(match.source)
            ? iconThemeForForeground(match.source, foreground)
            : null
          const modeId = theme ? iconVariablesApplied.modeIds[theme] : null
          if (target?.type !== 'INSTANCE' || !match) return
          target.swapComponent(match.component)
          if (modeId && iconCollection) {
            target.setExplicitVariableModeForCollection(iconCollection, modeId)
          }
        },
        combineAsVariants: components =>
          figma.combineAsVariants(
            components as unknown as ComponentNode[],
            figma.currentPage
          ) as unknown as CompositeComponentSetPort,
        appendToComponentSet: (set, component) => {
          (set as unknown as ComponentSetNode)
            .appendChild(component as unknown as ComponentNode)
        },
        clearChildren: component => {
          for (const child of [...(component as unknown as ComponentNode).children]) {
            child.remove()
          }
        },
        backupChildren: component => {
          return backupComponentChildren(
            component as unknown as ComponentNode,
            'UI-Anatomist / Composite rollback backup'
          )
        },
        restoreChildren: (component, value) => {
          const backup = value as FrameNode
          for (const child of [...(component as unknown as ComponentNode).children]) {
            child.remove()
          }
          for (const child of [...backup.children]) {
            (component as unknown as ComponentNode).appendChild(child)
          }
        },
        discardChildrenBackup: value => {
          (value as FrameNode).remove()
        },
        backupPlacement: component => {
          const node = component as unknown as ComponentNode
          return { parent: node.parent, x: node.x, y: node.y }
        },
        restorePlacement: (component, value) => {
          const node = component as unknown as ComponentNode
          const placement = value as {
            parent: (BaseNode & ChildrenMixin) | null
            x: number
            y: number
          }
          placement.parent?.appendChild(node)
          node.x = placement.x
          node.y = placement.y
        },
        getNodeById: async id => {
          const node = await figma.getNodeByIdAsync(id)
          return node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
            ? node as unknown as CompositeComponentPort | CompositeComponentSetPort
            : null
        }
      }
    )

    const removed = await removeStaleAssets(staleAssetPlan, data.source.origin, {
      getTextStyleById: async id => {
        const style = await figma.getStyleByIdAsync(id)
        return style?.type === 'TEXT' ? style : null
      },
      getRadiusVariableById: id => figma.variables.getVariableByIdAsync(id),
      getEffectStyleById: async id => {
        const style = await figma.getStyleByIdAsync(id)
        return style?.type === 'EFFECT' ? style : null
      },
      getColorVariableById: id => figma.variables.getVariableByIdAsync(id),
      getSpacingVariableById: id => figma.variables.getVariableByIdAsync(id),
      getControlNodeById: async id => {
        const node = await figma.getNodeByIdAsync(id)
        return node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
          ? node
          : null
      },
      getCompositeNodeById: async id => {
        const node = await figma.getNodeByIdAsync(id)
        return node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
          ? node
          : null
      },
      getIconVariableById: id => figma.variables.getVariableByIdAsync(id),
      getIconNodeById: async id => {
        const node = await figma.getNodeByIdAsync(id)
        return node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
          ? node
          : null
      }
    })
    reflowAppliedControlComponentSets(controlApplied.applied)
    reflowAppliedCompositeComponentSets(compositeApplied.applied)

    const typographyBoard = await buildTypographyBoard(applied.applied, available, data.source.origin)
    const radiusBoard = await buildRadiusBoard(data.borderRadii, radiusApplied.applied, available, data.source.origin)
    const shadowBoard = await buildShadowBoard(
      data.shadows,
      shadowApplied.applied,
      available,
      data.source.origin
    )
    const supportsColorBoards = supportsFigmaBoardCapability(
      data.schemaVersion,
      'colors'
    )
    const supportsSpacingBoard = supportsFigmaBoardCapability(
      data.schemaVersion,
      'spacing'
    )
    const supportsControlBoards = supportsFigmaBoardCapability(
      data.schemaVersion,
      'controls'
    )
    const supportsIconBoards = supportsFigmaBoardCapability(
      data.schemaVersion,
      'icons'
    )
    const colorBoards = supportsColorBoards
      ? await buildColorBoards(
          data.colors,
          colorApplied.applied,
          available,
          data.source.origin
        )
      : null
    const spacingBoard = supportsSpacingBoard
      ? await buildSpacingBoard(
          data.spacing,
          spacingApplied.applied,
          available,
          data.source.origin
        )
      : null
    const controlBoard = supportsControlBoards
      ? await buildControlBoard(
          controlApplied.applied,
          available,
          data.source.origin,
          data.controls.length,
          compositeApplied.applied
        )
      : null
    const controlMasterBoard = controlBoard
      ? await buildControlMasterBoard(
        controlApplied.applied,
        available,
        data.source.origin,
        controlBoard,
        compositeApplied.applied
      )
      : null
    const iconBoard = supportsIconBoards
      ? iconApplied.applied.length > 0
        ? await buildIconBoard(
            iconApplied.applied,
            available,
            data.source.origin,
            iconCollection
              ? {
                  collection: iconCollection,
                  light: iconVariablesApplied.modeIds.light,
                  dark: iconVariablesApplied.modeIds.dark
                }
              : undefined
          )
        : (removeOwnedIconBoard(data.source.origin), null)
      : null
    const iconMasterBoard = supportsIconBoards
      ? iconApplied.applied.length > 0
        ? await buildIconMasterBoard(
            iconApplied.applied,
            available,
            data.source.origin
          )
        : (removeOwnedIconMasterBoard(data.source.origin), null)
      : null
    const generatedBoards = [
      typographyBoard,
      radiusBoard,
      shadowBoard,
      colorBoards?.primitive ?? null,
      colorBoards?.semantic ?? null,
      colorBoards?.interactive ?? null,
      spacingBoard,
      controlBoard,
      controlMasterBoard,
      iconBoard,
      iconMasterBoard
    ].filter((board): board is FrameNode => board !== null)
    const canonicalBoardSizes = new Map(generatedBoards.map(board => [
      board.id,
      { width: board.width, height: board.height }
    ]))
    // The teacher Shadows specimen intentionally displays effect overflow
    // outside each 80×60 sample while keeping the canonical 1513×213 board.
    // Its geometric content already has exact 40px padding, so do not let
    // Figma's visual effect bounds expand the board and destroy that layout.
    const boardFitTargets = generatedBoards
      .filter(board => board !== shadowBoard)
      .map(board => {
        const minimum = canonicalBoardSizes.get(board.id)
        return {
          board: board as unknown as ResizableBoard,
          options: {
            left: 40,
            top: 40,
            right: 40,
            bottom: 40,
            minWidth: minimum?.width,
            minHeight: minimum?.height
          }
        }
      })
    for (const target of boardFitTargets) {
      await fitBoardToContentSettled(target.board, target.options)
    }
    await finalizeBoardsSafeAreaSettled(boardFitTargets)
    const boardLayoutItems = [
      ...(typographyBoard ? [{ board: typographyBoard, row: 0, order: 0 }] : []),
      ...(radiusBoard ? [{ board: radiusBoard, row: 0, order: 1 }] : []),
      ...(shadowBoard ? [{ board: shadowBoard, row: 1, order: 0 }] : []),
      ...(colorBoards?.primitive
        ? [{ board: colorBoards.primitive, row: 2, order: 0 }]
        : []),
      ...(colorBoards?.semantic
        ? [{ board: colorBoards.semantic, row: 3, order: 0 }]
        : []),
      ...(colorBoards?.interactive
        ? [{ board: colorBoards.interactive, row: 3, order: 1 }]
        : []),
      ...(spacingBoard ? [{ board: spacingBoard, row: 4, order: 0 }] : []),
      ...(controlBoard ? [{ board: controlBoard, row: 5, order: 0 }] : []),
      ...(controlMasterBoard
        ? [{ board: controlMasterBoard, row: 5, order: 1 }]
        : []),
      ...(iconBoard ? [{ board: iconBoard, row: 6, order: 0 }] : []),
      ...(iconMasterBoard
        ? [{ board: iconMasterBoard, row: 6, order: 1 }]
        : [])
    ]
    const otherSourceBoardObstacles = figma.currentPage.children.filter(node =>
      node.type === 'FRAME' &&
      node.name.startsWith('UI-Anatomist /') &&
      !generatedBoards.includes(node) &&
      !boardBelongsToOrigin(node, data.source.origin)
    ) as FrameNode[]
    const clusterAnchor = planBoardClusterAnchor(
      boardLayoutItems.map(item => ({
        width: item.board.width,
        height: item.board.height,
        row: item.row,
        order: item.order
      })),
      otherSourceBoardObstacles.map(board => ({
        x: board.x,
        y: board.y,
        width: board.width,
        height: board.height
      })),
      existingBoardClusterAnchor,
      { startX: 100, startY: 100, gap: 80 }
    )
    layoutBoardRows(boardLayoutItems, {
      startX: clusterAnchor.x,
      startY: clusterAnchor.y,
      gap: 80
    })
    transaction.commit()
    const summary = {
      typographyCreated: applied.created.length,
      typographyUpdated: applied.updated.length,
      typographyRemoved: removed.typographyRemoved,
      radiusCreated: radiusApplied.created.length,
      radiusUpdated: radiusApplied.updated.length,
      radiusRemoved: removed.radiusRemoved,
      shadowCreated: shadowApplied.created.length,
      shadowUpdated: shadowApplied.updated.length,
      shadowRemoved: removed.shadowRemoved,
      colorCreated: colorApplied.created.length,
      colorUpdated: colorApplied.updated.length,
      colorRemoved: removed.colorRemoved,
      spacingCreated: spacingApplied.created.length,
      spacingUpdated: spacingApplied.updated.length,
      spacingRemoved: removed.spacingRemoved,
      controlCreated: controlApplied.created.length,
      controlUpdated: controlApplied.updated.length,
      controlRemoved: removed.controlRemoved,
      compositeCreated: compositeApplied.created.length,
      compositeUpdated: compositeApplied.updated.length,
      compositeRemoved: removed.compositeRemoved ?? 0,
      iconCreated: iconApplied.created.length,
      iconUpdated: iconApplied.updated.length,
      iconRemoved: removed.iconRemoved ?? 0,
      missingFonts: [...new Set([
        ...applied.missingFonts,
        ...controlApplied.missingFonts,
        ...compositeApplied.missingFonts
      ])],
      typographyConflicts: applied.conflicts,
      radiusConflicts: radiusApplied.conflicts,
      shadowConflicts: shadowApplied.conflicts,
      colorConflicts: colorApplied.conflicts,
      spacingConflicts: spacingApplied.conflicts,
      controlConflicts: controlApplied.conflicts,
      compositeConflicts: compositeApplied.conflicts,
      iconConflicts: [
        ...iconVariablesApplied.conflicts,
        ...iconApplied.conflicts
      ],
      percentageRadii: radiusApplied.skippedPercent.length,
      staleCleanupSkipped: data.traversal.failures > 0
    }
    figma.ui.postMessage({
      type: 'IMPORT_RESULT',
      result: summary,
      boardIds: {
        typography: typographyBoard?.id ?? null,
        borderRadii: radiusBoard?.id ?? null,
        shadows: shadowBoard.id,
        colorPrimitives: colorBoards?.primitive.id ?? null,
        semanticColors: colorBoards?.semantic.id ?? null,
        interactiveColors: colorBoards?.interactive.id ?? null,
        spacing: spacingBoard?.id ?? null,
        interactiveControls: controlBoard?.id ?? null,
        controlMasters: controlMasterBoard?.id ?? null,
        icons: iconBoard?.id ?? null,
        iconMasters: iconMasterBoard?.id ?? null
      },
      message: resultMessage(summary)
    })
  } catch (error) {
    try { transaction?.rollback() } catch { /* Figma has no active plugin batch */ }
    figma.ui.postMessage({
      type: 'IMPORT_ERROR',
      message: error instanceof Error ? error.message : '导入失败，请检查 JSON。'
    })
  }
}
