import { expect, it, vi } from 'vitest'
import { parseVoiceTransaction } from './voiceInput'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}))

it('parses an expense voice command into existing transaction fields', () => {
  const result = parseVoiceTransaction('Spent 2.750 on breakfast from Cash today at 8:05 AM', {
    wallets: [{ id: 4, name: 'Cash' }],
    categories: [{ id: 8, name: 'Food', kind: 'expense' }],
  })
  expect(result).toMatchObject({ type: 'expense', amount: 2.75, description: 'breakfast', wallet_id: 4 })
  expect(result.date).toMatch(/T08:05$/)
})

it('maps transfer voice commands to both wallets', () => {
  expect(parseVoiceTransaction('Transfer 10 from Cash to Savings', { wallets: [{ id: 1, name: 'Cash' }, { id: 2, name: 'Savings' }] })).toMatchObject({
    type: 'transfer', amount: 10, wallet_id: 1, transfer_wallet_id: 2,
  })
})

it('understands natural phrases and spoken amounts', () => {
  expect(parseVoiceTransaction('Could you log around two point seven five zero dinars for breakfast from my Cash wallet', {
    wallets: [{ id: 4, name: 'Cash' }],
  })).toMatchObject({ type: 'expense', amount: 2.75, description: 'breakfast', wallet_id: 4 })
})

it('accepts conversational amount wording', () => {
  expect(parseVoiceTransaction('The amount was around two point five for a taxi from Cash', {
    wallets: [{ id: 4, name: 'Cash' }],
  })).toMatchObject({ amount: 2.5, description: 'taxi', wallet_id: 4 })
})
