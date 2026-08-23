export type ProductScopeFinding = {
  path: string
  kind: string
}

export function compareProductScope(
  candidateRoot: string,
  publicRoot: string
): Promise<ProductScopeFinding[]>
