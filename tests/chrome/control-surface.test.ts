import { describe, expect, it } from 'vitest'
import { exactControlRadii } from '../../src/chrome/content/control-surface'

describe('exactControlRadii', () => {
  it('parses scientific-notation px values from computed styles', () => {
    const style = {
      borderRadius: '1.67772e+07px',
      borderTopLeftRadius: '1.67772e+07px',
      borderTopRightRadius: '1.67772e+07px',
      borderBottomRightRadius: '1.67772e+07px',
      borderBottomLeftRadius: '1.67772e+07px'
    } as CSSStyleDeclaration

    expect(exactControlRadii(style, 36, 36)).toEqual({
      topLeft: 18,
      topRight: 18,
      bottomRight: 18,
      bottomLeft: 18
    })
  })
})
