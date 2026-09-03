import { describe, expect, it } from 'vitest'
import { money } from './api'

describe('money formatter', () => {
  it('formats KWD using three fractional digits', () => {
    const value = money(12.5, 'KWD')
    expect(value).toContain('12.500')
  })
  it('falls back safely for an invalid currency', () => {
    expect(money(10, 'NOTREAL')).toContain('10.00')
  })
})
