import { describe, expect, it } from 'vitest'
import { sanitizeRoute, siteLabelFromOrigin } from '../../src/chrome/privacy'

describe('privacy helpers', () => {
  it('drops query, hash, UUIDs, and long numeric IDs', () => {
    expect(sanitizeRoute('https://chatgpt.com/c/69e50072-16e8-83ea-b0b7-ff0c31df1019?x=private#part')).toBe('https://chatgpt.com/c/:id')
    expect(sanitizeRoute('https://example.com/projects/12345')).toBe('https://example.com/projects/:id')
  })

  it('derives the site label only from the origin', () => {
    expect(siteLabelFromOrigin('https://app.example.com/private-project')).toBe('app.example.com')
  })
})

