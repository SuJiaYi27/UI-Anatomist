export type PublicTreeFinding = {
  path: string
  kind: string
  message: string
}

export function auditPublicTree(
  root: string,
  options?: { allowPlaceholders?: boolean }
): Promise<PublicTreeFinding[]>
