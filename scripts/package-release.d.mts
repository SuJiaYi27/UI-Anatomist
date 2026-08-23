export type ReleasePackageOptions = {
  root: string
  outDir: string
  slug: string
  version: string
}

export type ReleasePackageResult = {
  packageDirectory: string
  zipPath: string
  checksumPath: string
  checksum: string
}

export function createReleasePackage(
  options: ReleasePackageOptions
): Promise<ReleasePackageResult>
