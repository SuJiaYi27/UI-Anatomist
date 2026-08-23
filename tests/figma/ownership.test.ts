import { describe, expect, it } from 'vitest'
import {
  readOwnership,
  writeOwnership,
  type OwnershipPort
} from '../../src/figma/ownership'

function directOnlyPort(): OwnershipPort & {
  shared: Map<string, string>
} {
  const shared = new Map<string, string>()
  return {
    shared,
    getPluginData() {
      throw new Error('not implemented')
    },
    setPluginData() {
      throw new Error('not implemented')
    },
    getSharedPluginData(namespace, key) {
      return shared.get(`${namespace}:${key}`) ?? ''
    },
    setSharedPluginData(namespace, key, value) {
      shared.set(`${namespace}:${key}`, value)
    }
  }
}

describe('shared ownership compatibility', () => {
  it('reads ownership from shared plugin data when private plugin data is unavailable', () => {
    const port = directOnlyPort()
    port.shared.set('smart.scan.typography:owner', 'https://example.com')

    expect(readOwnership(port, 'smart.scan.typography', 'owner'))
      .toBe('https://example.com')
  })

  it('writes shared ownership even when private plugin data is unavailable', () => {
    const port = directOnlyPort()

    writeOwnership(
      port,
      'smart.scan.typography',
      'owner',
      'https://example.com'
    )

    expect(port.shared.get('smart.scan.typography:owner'))
      .toBe('https://example.com')
  })
})
