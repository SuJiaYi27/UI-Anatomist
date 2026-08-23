export type OwnershipPort = {
  getPluginData(key: string): string
  setPluginData(key: string, value: string): void
  getSharedPluginData?(namespace: string, key: string): string
  setSharedPluginData?(namespace: string, key: string, value: string): void
}

export function readOwnership(
  port: Pick<OwnershipPort, 'getPluginData' | 'getSharedPluginData'>,
  namespace: string,
  key: string
): string {
  let privateValue = ''
  try {
    privateValue = port.getPluginData(key)
  } catch {
    // Direct Figma execution cannot access private plugin data.
  }
  return privateValue || port.getSharedPluginData?.(namespace, key) || ''
}

export function writeOwnership(
  port: Pick<OwnershipPort, 'setPluginData' | 'setSharedPluginData'>,
  namespace: string,
  key: string,
  value: string
): void {
  try {
    port.setPluginData(key, value)
  } catch {
    // Shared ownership remains available to direct Figma execution.
  }
  port.setSharedPluginData?.(namespace, key, value)
}
