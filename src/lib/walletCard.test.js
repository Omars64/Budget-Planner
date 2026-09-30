import { expect, it } from 'vitest'
import { walletCardStyle } from './walletCard'

it('keeps dark and custom light cards readable and rejects invalid colors', () => {
  expect(walletCardStyle('#183d36')['--wallet-card-ink']).toBe('#ffffff')
  expect(walletCardStyle('#ffffff')['--wallet-card-ink']).toBe('#172c38')
  expect(walletCardStyle('#999999')['--wallet-card-ink']).toBe('#172c38')
  expect(walletCardStyle('invalid')['--wallet-card-color']).toBe('#3158aa')
})
