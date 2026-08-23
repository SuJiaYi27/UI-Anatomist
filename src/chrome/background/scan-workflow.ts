import type { ChromeAdapterOptions } from './chrome-adapter'
import type { ScanAdapter } from './scan-site'
import { scanSite } from './scan-site'
import { buildScanExport } from './export'

type WorkflowInput = {
  tabId: number
  url: string
  locale: string
  platform: string
}

type WorkflowDependencies = {
  createAdapter(options: ChromeAdapterOptions): ScanAdapter
  storageSet(value: Record<string, unknown>): Promise<void>
}

type ScanProgress = {
  completed: number
  maximum: number
}

export async function runScanWorkflow(
  input: WorkflowInput,
  dependencies: WorkflowDependencies
): Promise<{
  ok: true
  typography: number
  borderRadii: number
  shadows: number
  colors: { primitives: number; semantic: number; interactive: number }
  spacing: number
  controls: number
  composites: number
  icons: number
}> {
  const rootUrl = `${new URL(input.url).origin}/`
  const baseAdapter = dependencies.createAdapter({
    tabId: input.tabId,
    originalUrl: input.url
  })
  const refreshHeartbeat = (progress?: ScanProgress) => dependencies.storageSet({
    scanStatus: 'scanning',
    scanHeartbeatAt: Date.now(),
    ...(progress ? { scanProgress: progress } : {})
  })
  const adapter: ScanAdapter = {
    ...baseAdapter,
    async open(url) {
      await refreshHeartbeat()
      return baseAdapter.open(url)
    },
    async reportProgress(tabId, progress) {
      await refreshHeartbeat(progress)
      await baseAdapter.reportProgress?.(tabId, progress)
    }
  }
  const result = await scanSite(adapter, {
    currentUrl: input.url,
    startUrl: rootUrl,
    maxDepth: 2,
    maxPages: 8
  })
  if (
    result.traversal.visitedStates === 0 &&
    result.traversal.failures > 0
  ) {
    throw new Error('UI-Anatomist could not inspect any page')
  }
  const payload = buildScanExport({
    startUrl: rootUrl,
    locale: input.locale,
    platform: input.platform,
    result
  })
  const json = JSON.stringify(payload, null, 2)
  await dependencies.storageSet({
    scanStatus: 'ready',
    scanJson: json,
    scanError: '',
    scanErrorCode: '',
    scanErrorReason: '',
    scanHeartbeatAt: 0,
    scanProgress: null
  })
  return {
    ok: true,
    typography: payload.typography.length,
    borderRadii: payload.borderRadii.length,
    shadows: payload.shadows.length,
    colors: {
      primitives: payload.colors.primitives.length,
      semantic: payload.colors.semantic.length,
      interactive: payload.colors.interactive.length
    },
    spacing: payload.spacing.length,
    controls: payload.controls.length,
    composites: payload.composites.length,
    icons: payload.icons.length
  }
}
