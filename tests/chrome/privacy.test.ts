import { describe, expect, it } from 'vitest'
import { sanitizeRoute, siteLabelFromOrigin } from '../../src/chrome/privacy'

describe('privacy helpers', () => {
  it('drops query, hash, UUIDs, and long numeric IDs', () => {
    expect(sanitizeRoute('https://chatgpt.com/c/00000000-0000-4000-8000-000000000000?x=private#part')).toBe('https://chatgpt.com/c/:id')
    expect(sanitizeRoute('https://example.com/projects/12345')).toBe('https://example.com/projects/:id')
  })

  it('derives the site label only from the origin', () => {
    expect(siteLabelFromOrigin('https://app.example.com/private-project')).toBe('app.example.com')
  })
})

